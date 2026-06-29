FROM python:3.11-slim as builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
RUN groupadd -r sreuser && useradd -r -g sreuser sreuser && \
    apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /root/.local /home/sreuser/.local
COPY . .
RUN chown -R sreuser:sreuser /app
USER sreuser
ENV PATH=/home/sreuser/.local/bin:$PATH
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1
# Servidor WSGI de produção (gunicorn). 1 worker + threads mantém as métricas
# Prometheus consistentes (processo único) e ainda atende concorrência.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "30", "--access-logfile", "-", "app:app"]
