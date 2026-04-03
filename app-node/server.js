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
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total', 
  help: 'Volume total de requisições recebidas', 
  labelNames: ['method', 'endpoint', 'status']
});

// --- MIDDLEWARES (CORRELATION ID & PERFORMANCE) ---
app.use((req, res, next) => {
  // Gera ID único se não vier de um Ingress/Gateway anterior.
  req.id = req.headers['x-request-id'] || uuidv4();
  req.startTime = Date.now();
  
  // Hardening de Segurança (Headers básicos)
  res.setHeader('X-Request-ID', req.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Ao finalizar a resposta, logamos os dados de performance (Golden Signals).
  res.on('finish', () => {
    logger.info("Request processada", {
      request_id: req.id,
      path: req.path,
      status: res.statusCode,
      latency_ms: Date.now() - req.startTime
    });
  });
  next();
});

// --- ROTA MESSAGE COM LÓGICA DE FALLBACK ---
app.get('/message', async (req, res) => {
  let source = 'app';
  let data = { app: 'node', data: "Resposta nível SRE Enterprise", timestamp: new Date() };

  if (ENABLE_CACHE) {
    try {
      // Tenta buscar no Redis. Se falhar, o 'catch' garante o fallback.
      const cached = await cache.get('node:msg');
      if (cached) {
        data = JSON.parse(cached);
        source = 'cache';
      } else {
        // Salva no cache por 60s (Trade-off: economia de recursos vs atualização).
        await cache.setEx('node:msg', 60, JSON.stringify(data));
      }
    } catch (err) {
      // CIRCUIT BREAKER MANUAL: O banco falhou, mas servimos o dado da origem.
      source = 'fallback';
      logger.warn("Redis indisponível, servindo via Fallback", { request_id: req.id });
    }
  }

  httpRequestCounter.inc({ method: 'GET', endpoint: '/message', status: 200 });
  res.json({ ...data, source, request_id: req.id });
});

app.get('/time', async (req, res) => {
    let source = 'app';
    let data = { app: 'node', data: new Date().toISOString(), timestamp: new Date() };
  
    if (ENABLE_CACHE) {
      try {
        const cached = await cache.get('node:time');
        if (cached) {
          data = JSON.parse(cached);
          source = 'cache';
        } else {
          await cache.setEx('node:time', 60, JSON.stringify(data));
        }
      } catch (err) {
        source = 'fallback';
      }
    }
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
