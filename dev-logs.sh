#!/bin/bash

# 查看开发环境日志

show_help() {
    echo "用法: $0 [服务名]"
    echo ""
    echo "服务名:"
    echo "  backend    查看后端日志"
    echo "  frontend   查看前端日志"
    echo "  postgres   查看数据库日志"
    echo "  all        查看所有服务日志 (默认)"
    echo ""
    echo "选项:"
    echo "  -f         跟踪日志输出"
    echo "  --tail N   显示最后N行 (默认: 50)"
}

# 默认参数
SERVICE=""
FOLLOW=false
TAIL=50

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--follow)
            FOLLOW=true
            shift
            ;;
        --tail)
            TAIL="$2"
            shift 2
            ;;
        backend|frontend|postgres|all)
            SERVICE="$1"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "未知参数: $1"
            show_help
            exit 1
            ;;
    esac
done

# 构建docker-compose命令
BASE_CMD="docker-compose -f docker-compose.dev.yml logs"

if [ "$FOLLOW" = true ]; then
    BASE_CMD="$BASE_CMD -f"
fi

BASE_CMD="$BASE_CMD --tail=$TAIL"

# 根据服务选择执行
case "$SERVICE" in
    backend)
        echo "📊 查看后端日志..."
        $BASE_CMD backend-dev
        ;;
    frontend)
        echo "🎨 查看前端日志..."
        $BASE_CMD frontend-dev
        ;;
    postgres)
        echo "🗄️  查看数据库日志..."
        $BASE_CMD postgres
        ;;
    all|"")
        echo "📋 查看所有服务日志..."
        $BASE_CMD
        ;;
esac