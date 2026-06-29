const express = require('express');
const redis = require('redis');
const client = require('prom-client');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

// --- ESTRATÉGIA DE LOGGING (WINSTON) ---
// Em produção, logs estruturados em JSON são essenciais para observabilidade centralizada.
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

const app = express();
const port = process.env.PORT || 3000;

// FEATURE FLAG: Permite desabilitar o uso do Redis sem deploy de código.
const ENABLE_CACHE = (process.env.ENABLE_CACHE || 'true').toLowerCase() === 'true';

// --- CONEXÃO REDIS (FAIL-FAST) ---
// socket.connectTimeout=1000: Se a conexão demorar > 1s, o cliente falha.
// Isso evita o travamento da aplicação (Event Loop) por causa de dependências lentas.
const cache = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
  socket: { connectTimeout: 1000 }
});
cache.on('error', (err) => logger.error("Falha no Cliente Redis", { error: err.message }));
cache.connect();

// --- MÉTRICAS (PROMETHEUS) ---
// collectDefaultMetrics expõe CPU, memória e event-loop lag (sinais de SATURAÇÃO).
client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Volume total de requisições recebidas',
  labelNames: ['method', 'endpoint', 'status']
});
const inflight = new client.Gauge({
  name: 'http_inflight_requests',
  help: 'Requisições em andamento (saturação)'
});
const breakerGauge = new client.Gauge({
  name: 'circuit_breaker_open',
  help: '1 quando o circuit breaker está aberto'
});

// --- CIRCUIT BREAKER (máquina de estados: closed -> open -> half_open) ---
// Após N falhas consecutivas o breaker abre e PARA de bater no Redis (evita cascata);
// depois do cooldown libera 1 tentativa de teste (half_open).
class CircuitBreaker {
  constructor(failMax = 3, resetTimeoutMs = 15000) {
    this.failMax = failMax;
    this.resetTimeoutMs = resetTimeoutMs;
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = 0;
  }
  allow() {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
        this.state = 'half_open';
        return true;
      }
      return false;
    }
    return true;
  }
  recordSuccess() {
    this.failures = 0;
    this.state = 'closed';
    breakerGauge.set(0);
  }
  recordFailure() {
    this.failures += 1;
    if (this.state === 'half_open' || this.failures >= this.failMax) {
      this.state = 'open';
      this.openedAt = Date.now();
      breakerGauge.set(1);
    }
  }
}
const breaker = new CircuitBreaker();

// Busca no cache com circuit breaker + fallback. Retorna { data, source }.
async function getWithBreaker(key, generate) {
  if (!ENABLE_CACHE) return { data: generate(), source: 'disabled' };
  if (!breaker.allow()) return { data: generate(), source: 'fallback' };
  try {
    const cached = await cache.get(key);
    if (cached) {
      breaker.recordSuccess();
      return { data: JSON.parse(cached), source: 'cache' };
    }
    const data = generate();
    await cache.setEx(key, 60, JSON.stringify(data));
    breaker.recordSuccess();
    return { data, source: 'app' };
  } catch (err) {
    breaker.recordFailure();
    logger.warn("Redis indisponível, Circuit Breaker/Fallback", { error: err.message });
    return { data: generate(), source: 'fallback' };
  }
}

// --- MIDDLEWARES (CORRELATION ID, SATURAÇÃO & PERFORMANCE) ---
app.use((req, res, next) => {
  // Gera ID único se não vier de um Ingress/Gateway anterior.
  req.id = req.headers['x-request-id'] || uuidv4();
  req.startTime = Date.now();

  // Hardening de Segurança (Headers básicos)
  res.setHeader('X-Request-ID', req.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  inflight.inc();
  // Ao finalizar a resposta, logamos os dados de performance (Golden Signals).
  res.on('finish', () => {
    inflight.dec();
    logger.info("Request processada", {
      request_id: req.id,
      path: req.path,
      status: res.statusCode,
      latency_ms: Date.now() - req.startTime
    });
  });
  next();
});

// --- ROTA MESSAGE (CIRCUIT BREAKER + FALLBACK) ---
app.get('/message', async (req, res) => {
  const generate = () => ({ app: 'node', data: "Resposta nível SRE Enterprise", timestamp: new Date() });
  const { data, source } = await getWithBreaker('node:msg', generate);
  httpRequestCounter.inc({ method: 'GET', endpoint: '/message', status: 200 });
  res.json({ ...data, source, request_id: req.id });
});

app.get('/time', async (req, res) => {
  const generate = () => ({ app: 'node', data: new Date().toISOString(), timestamp: new Date() });
  const { data, source } = await getWithBreaker('node:time', generate);
  httpRequestCounter.inc({ method: 'GET', endpoint: '/time', status: 200 });
  res.json({ ...data, source, request_id: req.id });
});

// --- MONITORAMENTO (LIVENESS VS READINESS) ---
app.get('/health', (req, res) => res.json({ status: 'alive' }));

app.get('/ready', async (req, res) => {
  try {
    await cache.ping();
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// --- GRACEFUL SHUTDOWN ---
const server = app.listen(port, () => logger.info(`NodeApp iniciado na porta ${port}`));

process.on('SIGTERM', () => {
  logger.info("Sinal SIGTERM recebido. Fechando servidor Node...");
  server.close(() => {
    logger.info("Servidor encerrado com sucesso.");
    process.exit(0);
  });
});
