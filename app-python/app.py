import os
import time
import json
import uuid
import logging
import signal
import sys
import redis
from flask import Flask, jsonify, request, g
from datetime import datetime
from pythonjsonlogger import jsonlogger
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# --- ESTRATÉGIA DE LOGGING (JSON) ---
# Em ambientes de alta escala (Enterprise, Big Techs), logs de texto são difíceis de parsear.
# Usamos JSON para que ferramentas como ELK ou Loki consigam indexar os campos automaticamente.
logger = logging.getLogger()
logHandler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter('%(timestamp)s %(level)s %(name)s %(message)s %(request_id)s')
logHandler.setFormatter(formatter)
logger.addHandler(logHandler)
logger.setLevel(logging.INFO)

app = Flask(__name__)

# --- CONFIGURAÇÕES & FEATURE FLAGS ---
# ENABLE_CACHE permite desligar o Redis via variável de ambiente (Kill Switch) em caso de incidente.
REDIS_HOST = os.getenv('REDIS_HOST', 'redis')
ENABLE_CACHE = os.getenv('ENABLE_CACHE', 'true').lower() == 'true'
CACHE_TTL = 10 # TTL curto (10s) para garantir frescor do dado vs carga no banco.

# --- RATE LIMITING (Proteção de Infra) ---
# Evita que um único cliente ou script mal-intencionado derrube o serviço por excesso de chamadas.
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# --- CONEXÃO REDIS (FAIL-FAST) ---
# socket_timeout=1: Decisão SRE de "falhar rápido". Se o Redis não responder em 1s,
# a aplicação assume que ele está indisponível e segue para o fallback (Circuit Breaker).
cache = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True, socket_timeout=1)

# --- MÉTRICAS (SLI/SLO) ---
# Usamos Histogramas para latência pois queremos monitorar o Percentil (p95, p99),
# o que é mais preciso que a "média" para medir a experiência real do usuário.
REQUEST_COUNT = Counter('http_requests_total', 'Volume total de tráfego', ['method', 'endpoint', 'status'])
LATENCY = Histogram('http_request_duration_seconds', 'Distribuição de latência (p95/p99)', ['endpoint'])
CACHE_METRICS = Counter('cache_operations_total', 'Saúde e performance do cache', ['result'])

# --- SEGURANÇA: HARDENING DE HEADERS ---
# Proteções básicas contra XSS, Sniffing e Clickjacking.
@app.after_request
def apply_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# --- MIDDLEWARE: CORRELATION ID (RASTREABILIDADE) ---
# Gera um ID único para cada requisição. Crucial para debugar incidentes em sistemas distribuídos.
@app.before_request
def before_request():
    g.request_id = request.headers.get('X-Request-ID', str(uuid.uuid4()))
    g.start_time = time.time()

@app.after_request
def log_request(response):
    latency = time.time() - g.start_time
    response.headers['X-Request-ID'] = g.request_id
    # Log estruturado que será enviado para a stack de observabilidade.
    logger.info("Request processada", extra={
        'request_id': g.request_id,
        'endpoint': request.path,
        'status': response.status_code,
        'latency_ms': latency * 1000
    })
    return response

# --- LÓGICA DE RESILIÊNCIA (CIRCUIT BREAKER / FALLBACK) ---
def get_data_with_fallback(key, ttl, generator_func):
    """
    Tenta buscar no cache. Se o cache falhar ou estiver lento (timeout),
    a aplicação busca na 'origem' e continua funcionando (Graceful Degradation).
    """
    if not ENABLE_CACHE:
        return generator_func(), 'disabled'
    try:
        cached = cache.get(key)
        if cached:
            CACHE_METRICS.labels(result='hit').inc()
            return json.loads(cached), 'cache'
        CACHE_METRICS.labels(result='miss').inc()
        data = generator_func()
        cache.setex(key, ttl, json.dumps(data))
        return data, 'app'
    except (redis.exceptions.ConnectionError, redis.exceptions.TimeoutError):
        # Fallback ativado: o banco caiu, mas o usuário não percebe erro 500.
        logger.warning("Redis Offline - Usando Fallback de Segurança", extra={'request_id': g.request_id})
        CACHE_METRICS.labels(result='fallback').inc()
        return generator_func(), 'fallback'

@app.route('/message')
@limiter.limit("10 per second") # Limite específico para proteção deste endpoint
def get_message():
    with LATENCY.labels(endpoint='/message').time():
        def generate(): return {"app": "python", "data": "Olá nível SRE Globo"}
        data, source = get_data_with_fallback("py:msg", CACHE_TTL, generate)
        data.update({"source": source, "request_id": g.request_id})
        REQUEST_COUNT.labels(method='GET', endpoint='/message', status=200).inc()
        return jsonify(data)

@app.route('/time')
def get_time():
    with LATENCY.labels(endpoint='/time').time():
        def generate(): return {"app": "python", "data": datetime.utcnow().isoformat()}
        data, source = get_data_with_fallback("py:time", CACHE_TTL, generate)
        data.update({"source": source, "request_id": g.request_id})
        return jsonify(data)

# --- MONITORAMENTO (LIVENESS VS READINESS) ---
@app.route('/health') # Liveness: O processo está rodando?
def health():
    return jsonify({"status": "alive"}), 200

@app.route('/ready') # Readiness: O sistema está pronto para tráfego (dependências OK)?
def ready():
    try:
        cache.ping()
        return jsonify({"status": "ready"}), 200
    except:
        return jsonify({"status": "not_ready"}), 503

@app.route('/metrics')
def metrics():
    """Expõe métricas para o coletor do Prometheus."""
    return generate_latest(), 200, {'Content-Type': CONTENT_TYPE_LATEST}

# --- GRACEFUL SHUTDOWN ---
# Garante que ao receber um sinal de parada (Docker stop), a aplicação 
# termine as requisições ativas antes de encerrar o processo.
def handle_sigterm(*args):
    logger.info("Encerrando aplicação graciosamente (SIGTERM)...")
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_sigterm)

if __name__ == '__main__':
    # threaded=True habilita concorrência básica para o servidor de desenvolvimento.
    app.run(host='0.0.0.0', port=5000, threaded=True)
