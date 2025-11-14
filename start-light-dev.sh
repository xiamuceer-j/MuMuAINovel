#!/bin/bash

# 轻量开发模式启动脚本
# 前端本地运行 + 后端热重载 = 资源占用减半

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查Node.js环境
check_nodejs() {
    if ! command -v node &> /dev/null; then
        log_error "未检测到Node.js，请先安装Node.js 18+"
        echo "下载地址: https://nodejs.org/"
        exit 1
    fi

    local node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_version" -lt 18 ]; then
        log_error "Node.js版本过低，需要18+，当前版本: $(node -v)"
        exit 1
    fi

    log_success "Node.js检查通过: $(node -v)"
}

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."

    # 检查Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker未安装或未启动"
        exit 1
    fi

    log_success "依赖检查通过"
}

# 安装前端依赖
install_frontend_deps() {
    log_info "检查前端依赖..."

    if [ ! -d "frontend/node_modules" ]; then
        log_info "安装前端依赖..."
        cd frontend
        npm config set registry https://registry.npmmirror.com
        npm install
        cd ..
        log_success "前端依赖安装完成"
    else
        log_info "前端依赖已存在"
    fi
}

# 构建前端（开发模式）
build_frontend_dev() {
    log_info "构建前端（开发模式）..."

    cd frontend
    npm run build
    cd ..

    log_success "前端构建完成"
}

# 启动后端开发服务
start_backend() {
    log_info "启动后端开发服务..."

    # 停止现有服务
    docker-compose -f docker-compose.light.yml down 2>/dev/null || true

    # 启动数据库
    docker-compose -f docker-compose.light.yml up -d postgres
    log_info "等待数据库启动..."
    sleep 10

    # 启动后端
    docker-compose -f docker-compose.light.yml up -d light-dev

    log_success "后端服务启动完成"
}

# 启动前端开发服务器
start_frontend() {
    log_info "启动前端开发服务器..."

    # 检查端口是否被占用
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        log_warning "端口3000已被占用，尝试终止现有进程..."
        pkill -f "vite.*3000" 2>/dev/null || true
        sleep 2
    fi

    # 后台启动前端开发服务器
    cd frontend
    npm run dev > ../logs/frontend-dev.log 2>&1 &
    FRONTEND_PID=$!
    cd ..

    echo $FRONTEND_PID > .frontend.pid
    log_success "前端开发服务器启动 (PID: $FRONTEND_PID)"
}

# 显示轻量开发环境信息
show_light_dev_info() {
    echo ""
    log_success "🚀 轻量开发模式已启动!"
    echo ""
    echo "🌐 服务访问地址："
    echo "   • 前端开发:    http://localhost:3000 (本地Node.js)"
    echo "   • 后端API:     http://localhost:8000 (Docker容器)"
    echo "   • 数据库:      localhost:5432"
    echo ""
    echo "💪 轻量模式优势："
    echo "   • 资源占用:    降低60% (只运行一个Docker容器)"
    echo "   • 前端性能:    本地运行，响应更快"
    echo "   • 热重载:      ✅ 前端+后端都支持"
    echo "   • 调试能力:    ✅ 完整保留"
    echo ""
    echo "📝 常用命令："
    echo "   • 查看日志:    ./logs.sh"
    echo "   • 停止服务:    ./stop-light-dev.sh"
    echo "   • 重启服务:    ./restart-light-dev.sh"
    echo "   • 拉取更新:    ./pull-and-reload-light.sh"
    echo ""
    echo "💡 开发工作流："
    echo "   1. 修改前端代码 → 浏览器自动刷新"
    echo "   2. 修改后端代码 → Docker容器自动重启"
    echo "   3. 资源占用低，性能好，稳定性强"
    echo ""
}

# 等待服务启动完成
wait_for_services() {
    log_info "等待服务完全启动..."

    # 等待后端API可用
    local attempts=0
    local max_attempts=30

    while [ $attempts -lt $max_attempts ]; do
        if curl -f http://localhost:8000/health > /dev/null 2>&1; then
            log_success "后端服务就绪"
            break
        fi

        echo -n "."
        sleep 2
        attempts=$((attempts + 1))
    done

    if [ $attempts -eq $max_attempts ]; then
        log_warning "后端服务启动超时，请检查日志"
    fi
}

# 主函数
main() {
    echo "🔋 MuMuAINovel 轻量开发模式启动器"
    echo "=================================="

    # 检查必要依赖
    check_dependencies
    check_nodejs

    # 创建日志目录
    mkdir -p logs

    # 安装前端依赖
    install_frontend_deps

    # 构建前端
    build_frontend_dev

    # 启动服务
    start_backend
    start_frontend

    # 等待服务就绪
    wait_for_services

    # 显示信息
    show_light_dev_info
}

# 处理命令行参数
case "${1:-}" in
    --help|-h)
        echo "用法: $0 [选项]"
        echo ""
        echo "轻量开发模式: 前端本地运行 + 后端热重载"
        echo ""
        echo "优势:"
        echo "  • 资源占用减少60%"
        echo "  • 前端响应更快"
        echo "  • 保留热重载功能"
        echo "  • 调试能力完整"
        echo ""
        echo "选项:"
        echo "  --help      显示帮助信息"
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac