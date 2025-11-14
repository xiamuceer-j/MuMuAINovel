#!/bin/bash

# MuMuAINovel 开发环境启动脚本
# 支持前端热重载 + 后端增量更新

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
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

# 检查必要依赖
check_dependencies() {
    log_info "检查依赖..."

    # 检查Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker未安装或未启动"
        exit 1
    fi

    # 检查Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose未安装"
        exit 1
    fi

    log_success "依赖检查通过"
}

# 检查环境文件
check_env_file() {
    if [ ! -f ".env" ]; then
        log_warning ".env文件不存在，创建默认配置..."
        cat > .env << 'EOF'
# 应用配置
APP_NAME=MuMuAINovel
APP_VERSION=1.0.0
APP_PORT=8000
DEBUG=true

# 数据库配置
POSTGRES_DB=mumuai_novel
POSTGRES_USER=mumuai
POSTGRES_PASSWORD=mumuai_password_2024
POSTGRES_PORT=5432

# 数据库连接池配置
DATABASE_POOL_SIZE=30
DATABASE_MAX_OVERFLOW=20
DATABASE_POOL_TIMEOUT=60
DATABASE_POOL_RECYCLE=1800
DATABASE_POOL_PRE_PING=true
DATABASE_POOL_USE_LIFO=true

# 代理配置（根据实际情况调整）
HTTP_PROXY=
HTTPS_PROXY=
NO_PROXY=localhost,127.0.0.1

# AI 服务配置（请填入实际的API密钥）
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_API_KEY=
GEMINI_BASE_URL=
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
DEFAULT_AI_PROVIDER=openai
DEFAULT_MODEL=gpt-4o-mini
DEFAULT_TEMPERATURE=0.7
DEFAULT_MAX_TOKENS=2000

# LinuxDO OAuth 配置
LINUXDO_CLIENT_ID=11111
LINUXDO_CLIENT_SECRET=11111
LINUXDO_REDIRECT_URI=http://localhost:8000/api/auth/linuxdo/callback
FRONTEND_URL=http://localhost:8000

# 本地账户登录配置
LOCAL_AUTH_ENABLED=true
LOCAL_AUTH_USERNAME=admin
LOCAL_AUTH_PASSWORD=admin123
LOCAL_AUTH_DISPLAY_NAME=本地管理员

# 会话配置
SESSION_EXPIRE_MINUTES=120
SESSION_REFRESH_THRESHOLD_MINUTES=30

# 时区配置
TZ=Asia/Shanghai
EOF
        log_success "已创建默认.env配置文件"
    fi
}

# 清理旧的开发容器
cleanup_dev_containers() {
    log_info "清理旧的开发容器..."

    # 停止开发容器
    docker-compose -f docker-compose.dev.yml down 2>/dev/null || true

    # 清理无用的卷
    docker volume prune -f 2>/dev/null || true

    log_success "清理完成"
}

# 构建开发镜像
build_dev_images() {
    log_info "构建开发镜像..."

    # 使用多阶段构建缓存优化构建速度
    docker build -f Dockerfile.dev --target frontend-development -t mumuainovel-frontend-dev:latest .
    docker build -f Dockerfile.dev --target backend-development -t mumuainovel-backend-dev:latest .

    log_success "开发镜像构建完成"
}

# 启动开发环境
start_dev_environment() {
    log_info "启动开发环境..."

    # 启动数据库和开发容器
    docker-compose -f docker-compose.dev.yml up -d postgres
    log_info "等待数据库启动..."
    sleep 10

    docker-compose -f docker-compose.dev.yml up -d

    log_success "开发环境启动完成"
}

# 显示开发环境信息
show_dev_info() {
    echo ""
    log_success "🚀 MuMuAINovel 开发环境已启动!"
    echo ""
    echo "📊 服务访问地址："
    echo "   • 后端API:     http://localhost:8000"
    echo "   • 前端开发:    http://localhost:3000"
    echo "   • 数据库:      localhost:5432"
    echo ""
    echo "🛠️  开发特性："
    echo "   • 前端热重载:   ✅ 代码修改即时生效"
    echo "   • 后端热重载:   ✅ Python文件修改自动重启"
    echo "   • 增量构建:    ✅ 利用Docker层缓存"
    echo ""
    echo "📝 常用命令："
    echo "   • 查看日志:    ./dev-logs.sh"
    echo "   • 停止开发:    ./stop-dev.sh"
    echo "   • 重启服务:    ./restart-dev.sh"
    echo "   • 拉取更新:    ./pull-and-reload.sh"
    echo ""
    echo "💡 开发工作流："
    echo "   1. 修改前端代码 → 浏览器自动刷新"
    echo "   2. 修改后端代码 → 服务自动重启"
    echo "   3. 拉取GitHub更新 → 自动增量构建"
    echo ""
}

# 主函数
main() {
    echo "🔧 MuMuAINovel 开发环境启动器"
    echo "================================"

    check_dependencies
    check_env_file

    if [ "$1" = "--clean" ]; then
        cleanup_dev_containers
    fi

    if [ "$1" = "--rebuild" ]; then
        cleanup_dev_containers
        build_dev_images
    elif [ "$1" = "--build" ]; then
        build_dev_images
    fi

    start_dev_environment
    show_dev_info
}

# 处理命令行参数
case "${1:-}" in
    --help|-h)
        echo "用法: $0 [选项]"
        echo ""
        echo "选项:"
        echo "  --clean     清理旧容器后启动"
        echo "  --rebuild   重新构建镜像并启动"
        echo "  --build     仅构建镜像"
        echo "  --help      显示帮助信息"
        echo ""
        echo "默认行为: 检查环境并启动开发环境"
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac