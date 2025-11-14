#!/bin/bash

# 停止轻量开发模式

set -e

GREEN='\033[0;32m'
NC='\033[0m'

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

echo "🛑 停止 MuMuAINovel 轻量开发模式..."

# 停止Docker容器
docker-compose -f docker-compose.light.yml down 2>/dev/null || true

# 停止前端开发服务器
if [ -f ".frontend.pid" ]; then
    PID=$(cat .frontend.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "停止前端开发服务器 (PID: $PID)..."
        kill $PID 2>/dev/null || true
        sleep 2
        # 强制杀死进程（如果还在运行）
        kill -9 $PID 2>/dev/null || true
    fi
    rm -f .frontend.pid
fi

# 清理可能的vite进程
pkill -f "vite.*3000" 2>/dev/null || true

log_success "轻量开发模式已停止"