#!/bin/bash
# Docker 容器启动入口脚本
# 功能：等待数据库就绪，执行迁移，启动应用

set -e  # 遇到错误立即退出

# 获取版本信息(从 .env.example 文件)
# 如果环境变量未设置，则从 .env.example 读取
if [ -z "$APP_VERSION" ]; then
    if [ -f "/app/.env.example" ]; then
        APP_VERSION=$(grep "^APP_VERSION=" /app/.env.example | cut -d '=' -f2)
    fi
    APP_VERSION="${APP_VERSION:-1.0.0}"
fi

if [ -z "$APP_NAME" ]; then
    if [ -f "/app/.env.example" ]; then
        APP_NAME=$(grep "^APP_NAME=" /app/.env.example | cut -d '=' -f2)
    fi
    APP_NAME="${APP_NAME:-MuMuAINovel}"
fi

BUILD_TIME=$(date '+%Y-%m-%d %H:%M:%S')

echo "================================================"
echo "🚀 ${APP_NAME} 启动中..."
echo "📦 版本: v${APP_VERSION}"
echo "🕐 启动时间: ${BUILD_TIME}"
echo "================================================"

# 数据库配置（从环境变量读取）
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-mumuai}"
DB_NAME="${POSTGRES_DB:-mumuai_novel}"

# 等待数据库就绪
echo "⏳ 等待数据库启动..."
MAX_RETRIES=30
RETRY_COUNT=0

while ! nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ 错误: 数据库连接超时（${MAX_RETRIES}秒）"
        exit 1
    fi
    echo "   等待数据库... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 1
done

echo "✅ 数据库连接成功"

# 额外等待，确保数据库完全就绪
echo "⏳ 等待数据库完全就绪..."
sleep 3

# 检查数据库是否可以接受连接
echo "🔍 检查数据库状态..."
if ! PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ 数据库尚未就绪，继续等待..."
    sleep 5
fi

echo "✅ 数据库已就绪"

# 运行数据库迁移
echo "================================================"
echo "🔄 执行数据库迁移..."
echo "================================================"

cd /app

# 统一使用 alembic upgrade head
# Alembic 会自动处理首次部署和增量迁移
echo "🔄 升级数据库到最新版本..."
alembic upgrade head

if [ $? -eq 0 ]; then
    echo "✅ 数据库迁移成功"
else
    echo "❌ 数据库迁移失败"
    exit 1
fi

echo "================================================"
echo "📁 同步内置 Skills..."
echo "================================================"

# 将内置 Skills 同步到持久化目录（仅首次部署或新增内置 Skill 时）
PERSISTENT_SKILLS="/app/storage/skills"
DEFAULT_SKILLS="/app/app/skills-default"

if [ -d "$DEFAULT_SKILLS" ]; then
    mkdir -p "$PERSISTENT_SKILLS"
    for skill_dir in "$DEFAULT_SKILLS"/*/; do
        skill_name=$(basename "$skill_dir")
        # 只同步持久化目录中不存在的 Skill（不覆盖用户创建/修改的同名 Skill）
        if [ ! -d "$PERSISTENT_SKILLS/$skill_name" ]; then
            cp -r "$skill_dir" "$PERSISTENT_SKILLS/$skill_name"
            echo "   ✅ 同步内置 Skill: $skill_name"
        else
            echo "   ⏭️  跳过已有 Skill: $skill_name"
        fi
    done
    echo "✅ Skills 同步完成"
else
    echo "⚠️  未找到内置 Skills 备份目录"
fi

echo "================================================"
echo "🎉 启动应用服务..."
echo "================================================"

# 启动应用（使用 exec 替换当前进程，确保信号正确传递）
cd /app
exec uvicorn app.main:app \
    --host "${APP_HOST:-0.0.0.0}" \
    --port "${APP_PORT:-8000}" \
    --log-level info \
    --access-log \
    --use-colors