<h1 align="center">🧩 SRE-Powered Microservices Architecture</h1>
<p align="center">Arquitetura de microsserviços moderna, resiliente e observável — padrões de engenharia de elite para alta escala.</p>

<p align="center">
  <img src="https://img.shields.io/badge/SRE-Production_First-2E6CA4?style=flat"/>
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white"/>
  <img src="https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white"/>
  <img src="https://img.shields.io/badge/Prometheus-E6522C?style=flat&logo=prometheus&logoColor=white"/>
  <img src="https://img.shields.io/badge/Grafana-F46800?style=flat&logo=grafana&logoColor=white"/>
</p>

---


Este projeto demonstra como construir uma arquitetura de microsserviços moderna, resiliente e observável, utilizando padrões de engenharia de elite para ambientes de alta escala.

## 🚀 Filosofia de Engenharia
Diferente de sistemas convencionais, este projeto foi desenhado sob o conceito de **"Produção Primeiro"**:
- **Servidor de produção:** o app Python roda sob **gunicorn** (WSGI), não no servidor de desenvolvimento do Flask.
- **Fail-Fast:** Timeouts agressivos (1s) para evitar contenção de recursos.
- **Graceful Degradation:** Circuit breaker + fallback automático mantêm a experiência do usuário durante falhas de dependência.
- **Observability-First:** O sistema nasce instrumentado para monitoramento de percentis (p95/p99) e logs estruturados em JSON.

## ⚙️ Execução simplificada (Cross-platform)
Este projeto foi projetado para ser executado com o mínimo de esforço possível em qualquer sistema operacional:
- **Windows:** Duplo clique em `run.bat`.
- **Linux/macOS:** Execute `./run.sh`.
- **Alternativa Padrão:** `make up`.

*O Makefile atua como camada de abstração, adaptando automaticamente comandos conforme o SO.*

## 💎 Diferenciais de Nível SRE Sênior
- **Circuit Breaker real (máquina de estados):** `closed → open → half_open`. Após N falhas consecutivas o breaker **abre e para de bater no Redis** (evita efeito cascata) e, após cooldown, libera uma tentativa de teste. Estado exposto na métrica `circuit_breaker_open`.
- **Security Hardening:** Containers **non-root** (multi-stage) e headers de segurança (`nosniff`, `X-Frame-Options`).
- **FinOps (Gestão de Custo):** Limites de CPU e memória por serviço no `docker-compose` (`deploy.resources.limits`) para evitar o efeito "Noisy Neighbor".
- **Golden Signals:** Latência (`http_request_duration_seconds`), Tráfego (`http_requests_total`), Erros (status nas labels) e **Saturação** (`http_inflight_requests` + métricas de processo/event-loop).
- **Correlation ID:** Rastreabilidade fim-a-fim via header `X-Request-ID`.

## 📈 Monitoramento (Dashboard SRE)
A stack já provisiona automaticamente um dashboard profissional no **Grafana**:
- **Acesso:** http://localhost:4444 (Login: `admin` / Senha: `admin`)
- **Painéis:** RPS por endpoint, Latência p95 em tempo real e Eficiência do Cache.

## 🧪 Como Auditar a Resiliência
1. **Derrube o Banco:** `docker compose stop redis`.
2. **Teste a API:** `curl http://localhost:5050/message`.
3. **Valide:** O JSON retornará com `"source": "fallback"`. A aplicação sobreviveu.

## 🏗️ Roadmap de Evolução (Próximos Passos)
Para um ambiente enterprise real, os próximos passos seriam:
1. **Kubernetes:** Migração de Docker Compose para Helm Charts (HPA, Ingress, PDB).
2. **Secret Management:** Implementação do HashiCorp Vault ou AWS Secrets Manager.
3. **mTLS:** Implementação de Service Mesh (Istio/Linkerd) para segurança entre serviços.
4. **OpenTelemetry:** Distributed Tracing para rastrear o caminho da requisição entre microserviços.

---
*Este projeto foi construído para demonstrar maturidade arquitetural e foco em disponibilidade. Qualquer dúvida técnica, estou à disposição.*
