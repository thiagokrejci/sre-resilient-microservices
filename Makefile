# Identifica o Sistema Operacional
ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
    DOCKER_CMD := docker compose
    OPEN_CMD := start
else
    DETECTED_OS := $(shell uname -s)
    DOCKER_CMD := docker compose
    ifeq ($(DETECTED_OS),Darwin)
        OPEN_CMD := open
    else
        OPEN_CMD := xdg-open
    endif
endif

.PHONY: help up down logs test load-test

help:
	@echo "SRE Stack - OS Detectado: $(DETECTED_OS)"
	@echo "Uso: make [comando]"
	@echo "  up         - Sobe a stack completa"
	@echo "  down       - Derruba e limpa volumes"
	@echo "  logs       - Mostra logs em tempo real"
	@echo "  test       - Testa resiliência (Circuit Breaker)"
	@echo "  open       - Abre as apps no navegador"

up:
	$(DOCKER_CMD) up -d --build

down:
	$(DOCKER_CMD) down -v

logs:
	$(DOCKER_CMD) logs -f

test:
	$(DOCKER_CMD) stop redis
	@echo "🔥 Redis parado. Testando fallback..."
	curl -i http://localhost:5050/message
	$(DOCKER_CMD) start redis
	@echo "✅ Redis restaurado."

open:
	$(OPEN_CMD) http://localhost:5050/message
	$(OPEN_CMD) http://localhost:3030/message
	$(OPEN_CMD) http://localhost:4444
