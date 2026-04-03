# Script de Inicialização Rápida - SRE Stack

Write-Host "🚀 Iniciando a limpeza e subida da Stack..." -ForegroundColor Cyan

# 1. Garante que estamos na pasta correta
cd C:\Users\tkrejci\devops-senior-test

# 2. Derruba tudo e limpa volumes antigos
docker compose down -v

# 3. Sobe os containers em modo detach
docker compose up -d --build

Write-Host "⏳ Aguardando serviços iniciarem (10 segundos)..." -ForegroundColor Yellow
Start-Sleep -s 10

# 4. Verifica se os containers estão UP
docker compose ps

Write-Host "✅ TUDO PRONTO! Acesse os links abaixo:" -ForegroundColor Green
Write-Host "----------------------------------------"
Write-Host "👉 App Python:   http://localhost:5050/message"
Write-Host "👉 App Node:     http://localhost:3030/message"
Write-Host "👉 Grafana:      http://localhost:4444 (Dashboard pronto)"
Write-Host "👉 Prometheus:   http://localhost:9091"
Write-Host "----------------------------------------"
Write-Host "DICA: Se os links não abrirem, verifique se o Docker Desktop está rodando!" -ForegroundColor Gray
