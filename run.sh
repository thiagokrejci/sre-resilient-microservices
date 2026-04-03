#!/bin/bash
# Script para Linux e MacOS

echo "🚀 Iniciando SRE Stack no $(uname -s)..."

# Verifica se Docker está rodando
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Erro: Docker não detectado ou sem permissão."
    exit 1
fi

# Usa o Makefile para subir
make up

echo "⏳ Aguardando serviços (10s)..."
sleep 10

# Abre o navegador (se disponível)
make open

echo "✅ TUDO PRONTO!"
