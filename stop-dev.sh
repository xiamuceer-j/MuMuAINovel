#!/bin/bash

# 停止开发环境

set -e

GREEN='\033[0;32m'
NC='\033[0m'

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

echo "🛑 停止 MuMuAINovel 开发环境..."

# 停止开发容器
docker-compose -f docker-compose.dev.yml down

log_success "开发环境已停止"