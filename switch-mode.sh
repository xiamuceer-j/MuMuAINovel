#!/bin/bash

# 智能环境切换脚本
# 根据开发阶段自动选择最适合的环境

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

# 检测当前模式
detect_current_mode() {
    if docker-compose -f docker-compose.dev.yml ps --services --filter "status=running" | grep -q "."; then
        echo "development"
    elif docker-compose -f docker-compose.light.yml ps --services --filter "status=running" | grep -q "light-dev"; then
        echo "light"
    elif docker-compose ps --services --filter "status=running" | grep -q "mumuainovel"; then
        echo "production"
    else
        echo "none"
    fi
}

# 显示环境对比
show_mode_comparison() {
    echo ""
    echo "📊 环境对比："
    echo ""
    echo "                    全开发模式      轻量模式        生产模式"
    echo "============================================================="
    echo "启动速度:           ⚡ 快 (10-20秒)   🚀 最快 (5-10秒)  🐌 慢 (2-3分钟)"
    echo "热重载:             ✅ 前后端都支持   ✅ 前后端都支持   ❌ 不支持"
    echo "前端性能:           📱 开发版 (1.6MB)  ⚡ 本地开发最快    🚀 生产版 (500KB)"
    echo "内存占用:           💾 高 (2-3GB)      💚 低 (1-1.5GB)   💚 低 (1-2GB)"
    echo "资源占用:           🏋️ 3个容器         💪 1个容器        💪 1个容器"
    echo "安全性:             🔓 开发模式         🔓 开发模式         🔒 生产安全"
    echo "调试能力:           🐛 完整调试         🐛 完整调试         ⚠️ 有限调试"
    echo "稳定性:             ⚡ 开发模式         🛡️ 较稳定          🛡️ 生产稳定"
    echo ""
    echo "💡 推荐选择:"
    echo "  • 开发调试:     全开发模式 (功能最全)"
    echo "  • 日常开发:     轻量模式 (性能平衡) ⭐ 推荐"
    echo "  • 发布演示:     生产模式 (性能最优)"
    echo ""
}

# 推荐最佳模式
recommend_mode() {
    local current_mode=$1

    case "$current_mode" in
        "development")
            log_warning "当前在全开发模式 (资源占用最高)"
            echo ""
            echo "💡 建议切换到轻量模式（性能更好）："
            echo "  ./switch-mode.sh light"
            echo ""
            echo "💡 何时使用生产模式："
            echo "  • 发布代码前"
            echo "  • 性能测试时"
            echo "  • 客户演示时"
            echo ""
            echo "🔄 切换命令: ./switch-mode.sh light | production"
            ;;
        "light")
            log_success "当前在轻量开发模式 ⭐ (推荐)"
            echo ""
            echo "💡 轻量模式的优势："
            echo "  • 资源占用减少60%"
            echo "  • 前端响应更快"
            echo "  • 保留完整热重载"
            echo "  • 适合日常开发"
            echo ""
            echo "🔄 其他选项:"
            echo "  • 全功能调试: ./switch-mode.sh development"
            echo "  • 发布演示:   ./switch-mode.sh production"
            ;;
        "production")
            log_info "当前在生产模式"
            echo ""
            echo "💡 何时切换到开发模式："
            echo "  • 活跃开发新功能时 - 推荐轻量模式"
            echo "  • 深度调试问题时 - 推荐全开发模式"
            echo ""
            echo "🔄 切换命令: ./switch-mode.sh light | development"
            ;;
        "none")
            log_info "当前没有运行的服务"
            echo ""
            echo "💡 推荐启动模式："
            echo "  • 轻量开发:   ./switch-mode.sh light     ⭐ 推荐"
            echo "  • 全功能开发: ./switch-mode.sh development"
            echo "  • 生产模式:   ./switch-mode.sh production"
            ;;
    esac
}

# 切换到轻量开发模式
switch_to_light() {
    log_info "切换到轻量开发模式..."

    # 停止其他环境
    if docker-compose ps --services --filter "status=running" | grep -q "mumuainovel"; then
        log_info "停止生产环境..."
        docker-compose down
    fi

    if docker-compose -f docker-compose.dev.yml ps --services --filter "status=running" | grep -q "."; then
        log_info "停止全开发环境..."
        ./stop-dev.sh
    fi

    # 启动轻量开发模式
    log_info "启动轻量开发模式..."
    ./start-light-dev.sh

    log_success "✅ 已切换到轻量开发模式 ⭐"
    echo ""
    echo "🌐 访问地址："
    echo "   前端开发: http://localhost:3000 (本地Node.js)"
    echo "   后端API:  http://localhost:8000 (Docker容器)"
    echo ""
    echo "💪 轻量模式优势："
    echo "   • 资源占用: 减少60%"
    echo "   • 前端响应: 本地运行更快"
    echo "   • 热重载: 前后端都支持"
    echo "   • 调试能力: 完整保留"
    echo ""
    echo "📝 常用命令："
    echo "   • 查看日志: ./logs-light-dev.sh"
    echo "   • 停止服务: ./stop-light-dev.sh"
    echo "   • GitHub拉取: ./pull-and-reload.sh"
}

# 切换到开发模式
switch_to_development() {
    log_info "切换到全开发模式..."

    # 停止其他环境
    if docker-compose ps --services --filter "status=running" | grep -q "mumuainovel"; then
        log_info "停止生产环境..."
        docker-compose down
    fi

    if docker-compose -f docker-compose.light.yml ps --services --filter "status=running" | grep -q "light-dev"; then
        log_info "停止轻量开发环境..."
        ./stop-light-dev.sh
    fi

    # 启动全开发环境
    log_info "启动全开发环境..."
    ./start-dev.sh

    log_success "✅ 已切换到全开发模式"
    echo ""
    echo "🌐 访问地址："
    echo "   前端开发: http://localhost:3000"
    echo "   后端API:  http://localhost:8000"
    echo ""
    echo "🛠️  全开发特性："
    echo "   • 前端热重载: Docker容器化"
    echo "   • 后端热重载: Docker容器化"
    echo "   • 完全隔离: 开发环境独立"
    echo "   • 智能拉取: ./pull-and-reload.sh"
}

# 切换到生产模式
switch_to_production() {
    log_info "切换到生产模式..."

    # 停止开发环境
    if docker-compose -f docker-compose.dev.yml ps --services --filter "status=running" | grep -q "."; then
        log_info "停止全开发环境..."
        ./stop-dev.sh
    fi

    if docker-compose -f docker-compose.light.yml ps --services --filter "status=running" | grep -q "light-dev"; then
        log_info "停止轻量开发环境..."
        ./stop-light-dev.sh
    fi

    # 启动生产环境
    log_info "启动生产环境..."
    docker compose up -d

    # 等待服务启动
    log_info "等待服务启动..."
    sleep 20

    # 健康检查
    if curl -f http://localhost:8025/health > /dev/null 2>&1; then
        log_success "✅ 生产环境启动成功"
        echo ""
        echo "🌐 访问地址："
        echo "   应用: http://localhost:8025"
        echo ""
        echo "🚀 生产特性："
        echo "   • 优化性能: 压缩代码，快速加载"
        echo "   • 高稳定性: 生产级配置"
        echo "   • 安全加固: 移除开发工具"
    else
        log_error "生产环境启动失败，请检查日志"
        docker compose logs mumuainovel --tail 20
        exit 1
    fi
}

# 显示帮助
show_help() {
    echo "用法: $0 [模式]"
    echo ""
    echo "模式:"
    echo "  development  切换到开发模式 (热重载，适合开发)"
    echo "  production   切换到生产模式 (优化性能，适合测试/演示)"
    echo "  status       显示当前状态和建议"
    echo "  help         显示帮助信息"
    echo ""
    echo "无参数调用时，自动检测当前状态并给出建议"
}

# 主函数
main() {
    echo "🔄 MuMuAINovel 智能环境切换器"
    echo "=================================="

    local current_mode=$(detect_current_mode)

    case "${1:-status}" in
        "development"|"dev")
            switch_to_development
            ;;
        "production"|"prod")
            switch_to_production
            ;;
        "status"|"")
            show_mode_comparison
            recommend_mode "$current_mode"
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            log_error "未知模式: $1"
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"