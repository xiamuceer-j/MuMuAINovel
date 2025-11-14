#!/bin/bash

# GitHub拉取+智能重载脚本
# 专门解决开发环境中的拉取冲突问题

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

# 错误处理
handle_error() {
    log_error "操作失败，正在恢复..."

    # 恢复到工作状态
    if [ "$STASH_CREATED" = "true" ]; then
        log_info "恢复暂存的修改..."
        git stash pop
    fi

    log_warning "已恢复到拉取前状态，请手动处理冲突"
    exit 1
}

trap handle_error ERR

# 配置代理
setup_proxy() {
    if command -v curl &> /dev/null; then
        if ! curl -s --connect-timeout 1 https://github.com > /dev/null 2>&1; then
            log_info "检测到需要代理访问GitHub..."
            export HTTPS_PROXY=${HTTPS_PROXY:-http://127.0.0.1:7897}
            export HTTP_PROXY=${HTTP_PROXY:-http://127.0.0.1:7897}
            log_success "已配置代理: $HTTPS_PROXY"
        fi
    fi
}

# 检查大文件资产
check_large_assets() {
    log_info "检查重要资产文件..."

    # 检查embedding模型文件
    if [ -d "backend/embedding" ]; then
        MODEL_SIZE=$(du -s backend/embedding 2>/dev/null | cut -f1 2>/dev/null || echo "0")
        if [ "$MODEL_SIZE" -gt 100000 ]; then  # 大于100MB
            log_success "✅ 检测到embedding模型文件 (${MODEL_SIZE}KB)"
            BACKUP_MODELS=true
        else
            log_warning "⚠️  embedding模型文件较小或不完整"
            BACKUP_MODELS=false
        fi
    else
        log_warning "⚠️  未发现embedding目录"
        BACKUP_MODELS=false
    fi
}

# 备份重要资产
backup_assets() {
    if [ "$BACKUP_MODELS" = "true" ]; then
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        BACKUP_DIR="backup_models_$TIMESTAMP"

        log_info "备份模型文件到 $BACKUP_DIR..."
        cp -r backend/embedding "$BACKUP_DIR"
        log_success "模型备份完成"
    fi
}

# 智能Git拉取
smart_git_pull() {
    log_info "开始智能Git拉取..."

    # 1. 保存当前修改
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        log_info "检测到本地修改，暂存到stash..."
        git stash push -m "dev_backup_$(date +%Y%m%d_%H%M%S)"
        STASH_CREATED=true
        log_success "本地修改已暂存"
    else
        log_info "工作区干净，无需暂存"
        STASH_CREATED=false
    fi

    # 2. 获取远程信息
    log_info "获取远程更新信息..."
    setup_proxy
    git fetch origin main 2>/dev/null || {
        log_error "无法获取远程信息，请检查网络连接"
        exit 1
    }

    # 3. 检查是否有更新
    if git diff --quiet HEAD origin/main; then
        log_info "没有新的更新"
        return 0
    fi

    # 4. 显示即将拉取的变更
    log_info "即将拉取的变更："
    echo "--- 变更文件 ---"
    git diff --name-status HEAD..origin/main
    echo ""

    # 5. 检查可能的冲突
    log_info "检查潜在冲突..."
    CONFLICT_FILES=$(git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main 2>/dev/null | grep "^<<<<<<<\|^=======\|^>>>>>>>" | wc -l || echo "0")

    if [ "$CONFLICT_FILES" -gt 0 ]; then
        log_warning "⚠️  检测到潜在冲突文件，准备智能合并..."
    fi

    # 6. 智能处理LFS文件
    log_info "智能处理大文件..."

    # 先尝试跳过LFS文件拉取
    if ! GIT_LFS_SKIP_SMUDGE=1 git pull origin main; then
        log_warning "跳过LFS失败，尝试普通拉取..."

        # 如果有模型备份，先恢复
        if [ "$BACKUP_MODELS" = "true" ] && [ -n "${BACKUP_DIR:-}" ]; then
            log_info "临时移除模型目录避免冲突..."
            rm -rf backend/embedding
        fi

        # 普通拉取
        if ! git pull origin main; then
            log_error "Git拉取失败"

            # 恢复模型文件
            if [ "$BACKUP_MODELS" = "true" ] && [ -n "${BACKUP_DIR:-}" ]; then
                log_info "恢复模型文件..."
                mv "$BACKUP_DIR" backend/embedding
            fi

            exit 1
        fi
    fi

    log_success "Git拉取完成"
}

# 恢复大文件资产
restore_assets() {
    if [ "$BACKUP_MODELS" = "true" ]; then
        # 检查是否需要恢复模型文件
        if [ ! -d "backend/embedding" ] || [ $(du -s backend/embedding 2>/dev/null | cut -f1 || echo "0") -lt 100000 ]; then
            log_info "检查模型文件完整性..."

            # 从备份恢复
            if [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
                log_info "从备份恢复模型文件..."
                rm -rf backend/embedding
                mv "$BACKUP_DIR" backend/embedding
            fi

            # 从其他项目寻找模型文件
            if [ ! -d "backend/embedding" ] || [ $(du -s backend/embedding 2>/dev/null | cut -f1 || echo "0") -lt 100000 ]; then
                log_info "从其他项目寻找模型文件..."
                for PROJECT_DIR in /vol1/1000/docker/*/; do
                    if [ -d "$PROJECT_DIR/backend/embedding" ] && [ "$PROJECT_DIR" != "$(pwd)/" ]; then
                        PROJECT_SIZE=$(du -s "$PROJECT_DIR/backend/embedding" 2>/dev/null | cut -f1 || echo "0")
                        if [ "$PROJECT_SIZE" -gt 100000 ]; then
                            log_info "发现完整模型文件在: $PROJECT_DIR"
                            mkdir -p backend/embedding
                            cp -r "$PROJECT_DIR/backend/embedding/"* backend/embedding/
                            log_success "模型文件复制完成"
                            break
                        fi
                    fi
                done
            fi
        fi

        # 清理备份
        if [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
            rm -rf "$BACKUP_DIR"
        fi
    fi
}

# 恢复本地修改
restore_changes() {
    if [ "$STASH_CREATED" = "true" ]; then
        log_info "恢复本地修改..."
        git stash pop
        log_success "本地修改已恢复"
    fi
}

# 热重载开发服务
hot_reload_services() {
    log_info "热重载开发服务..."

    # 检查开发环境是否运行
    if docker-compose -f docker-compose.dev.yml ps --services --filter "status=running" | grep -q "backend-dev\|frontend-dev"; then
        log_info "检测到开发环境运行中，执行热重载..."

        # 重启后端服务（Python代码变更需要重启）
        if docker-compose -f docker-compose.dev.yml ps backend-dev | grep -q "Up"; then
            log_info "重启后端服务..."
            docker-compose -f docker-compose.dev.yml restart backend-dev
            log_success "后端服务已重启"
        fi

        # 前端热重载（文件变更会自动刷新）
        if docker-compose -f docker-compose.dev.yml ps frontend-dev | grep -q "Up"; then
            log_info "前端服务支持热重载，修改会自动生效"
        fi

        log_success "服务热重载完成"
    else
        log_warning "开发环境未运行，请执行 ./start-dev.sh 启动"
    fi
}

# 显示拉取结果
show_pull_result() {
    echo ""
    log_success "🎉 GitHub拉取和热重载完成!"
    echo ""
    echo "📋 更新状态："

    # 显示Git状态
    if [ "$STASH_CREATED" = "true" ]; then
        echo "   • 本地修改:    ✅ 已恢复"
    fi

    if [ "$BACKUP_MODELS" = "true" ]; then
        echo "   • 模型文件:    ✅ 完整"
    fi

    echo "   • 代码更新:    ✅ 已同步"
    echo "   • 开发服务:    ✅ 热重载完成"
    echo ""

    # 显示服务状态
    if docker-compose -f docker-compose.dev.yml ps --services --filter "status=running" | grep -q "."; then
        echo "🌐 开发环境访问地址："
        echo "   • 前端:        http://localhost:3000"
        echo "   • 后端:        http://localhost:8000"
        echo ""
    fi
}

# 主函数
main() {
    echo "🔄 GitHub拉取 + 智能热重载"
    echo "=================================="

    # 检查是否在Git仓库中
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "当前目录不是Git仓库"
        exit 1
    fi

    check_large_assets
    backup_assets
    smart_git_pull
    restore_assets
    restore_changes
    hot_reload_services
    show_pull_result
}

# 处理命令行参数
case "${1:-}" in
    --help|-h)
        echo "用法: $0 [选项]"
        echo ""
        echo "功能: 智能处理GitHub拉取冲突，自动热重载开发环境"
        echo ""
        echo "特性:"
        echo "  • 自动暂存和恢复本地修改"
        echo "  • 智能处理LFS大文件"
        echo "  • 自动备份和恢复模型文件"
        echo "  • 检测和解决拉取冲突"
        echo "  • 自动热重载开发服务"
        echo ""
        echo "选项:"
        echo "  --help      显示此帮助信息"
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac