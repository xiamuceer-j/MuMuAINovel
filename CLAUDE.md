# Development Guidelines

## Overview

This document defines project-specific coding standards and development principles.
### CLI Tool Context Protocols
For all CLI tool usage, command syntax, and integration guidelines:
- **MCP Tool Strategy**: @~/.claude/workflows/mcp-tool-strategy.md
- **Intelligent Context Strategy**: @~/.claude/workflows/intelligent-tools-strategy.md
- **Context Search Commands**: @~/.claude/workflows/context-search-strategy.md

**Context Requirements**:
- Identify 3+ existing similar patterns before implementation
- Map dependencies and integration points
- Understand testing framework and coding conventions


## Philosophy

### Core Beliefs

- **Pursue good taste** - Eliminate edge cases to make code logic natural and elegant
- **Embrace extreme simplicity** - Complexity is the root of all evil
- **Be pragmatic** - Code must solve real-world problems, not hypothetical ones
- **Data structures first** - Bad programmers worry about code; good programmers worry about data structures
- **Never break backward compatibility** - Existing functionality is sacred and inviolable
- **Incremental progress over big bangs** - Small changes that compile and pass tests
- **Learning from existing code** - Study and plan before implementing
- **Clear intent over clever code** - Be boring and obvious
- **Follow existing code style** - Match import patterns, naming conventions, and formatting of existing codebase
- **No unsolicited reports** - Task summaries can be performed internally, but NEVER generate additional reports, documentation files, or summary files without explicit user permission

### Simplicity Means

- Single responsibility per function/class
- Avoid premature abstractions
- No clever tricks - choose the boring solution
- If you need to explain it, it's too complex

## Project Integration

### Learning the Codebase

- Find 3 similar features/components
- Identify common patterns and conventions
- Use same libraries/utilities when possible
- Follow existing test patterns

### Tooling

- Use project's existing build system
- Use project's test framework  
- Use project's formatter/linter settings
- Don't introduce new tools without strong justification

## Important Reminders

**NEVER**:
- Make assumptions - verify with existing code
- Generate reports, summaries, or documentation files without explicit user request

**ALWAYS**:
- Plan complex tasks thoroughly before implementation
- Generate task decomposition for multi-module work (>3 modules or >5 subtasks)
- Track progress using TODO checklists for complex tasks
- Validate planning documents before starting development
- Commit working code incrementally
- Update plan documentation and progress tracking as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess

## Platform-Specific Guidelines

### Windows Path Format Guidelines
- always use complete absolute Windows paths with drive letters and backslashes for ALL file operations
- **MCP Tools**: Use double backslash `D:\\path\\file.txt` (MCP doesn't support POSIX `/d/path`)
- **Bash Commands**: Use forward slash `D:/path/file.txt` or POSIX `/d/path/file.txt`
- **Relative Paths**: No conversion needed `./src`, `../config`
- **Quick Ref**: `C:\Users` → MCP: `C:\\Users` | Bash: `/c/Users` or `C:/Users`

#### **Content Uniqueness Rules**

- **Each layer owns its abstraction level** - no content sharing between layers
- **Reference, don't duplicate** - point to other layers, never copy content
- **Maintain perspective** - each layer sees the system at its appropriate scale
- **Avoid implementation creep** - higher layers stay architectural

---

## Prompt Management System Integration

### System Overview
The project includes a Prompt Management System running on `localhost:3501` (Docker container: `prompt-manage-prompt-manager-1`).

### Database Architecture
- **Primary Database**: `/app/data/data.sqlite3` (NOT `/app/prompts.db`)
- **Table Structure**: `prompts`, `versions`, `ai_configs`, `optimization_tasks`
- **Current Prompts**:
  - ID 1: "提示词优化"
  - ID 5: "测试"
  - **Note**: ID 4 (test prompt) does not exist in database

### AI Configuration Status
- **Active Config**: ID 27 - "项目标准修复测试配置"
- **Provider**: OpenAI-compatible API
- **Model**: gemini-2.5-flash
- **API URL**: `https://newapi.eve.ink/v1`
- **Status**: ✅ Active and configured

### Critical Issues Identified

#### 🚨 **Issue 1: AI API Endpoint Configuration Error**
**Problem**: `Invalid URL (POST /v1)` - 404 Error
**Root Cause**: API URL configuration incomplete or incorrect
**Impact**: All optimization tasks fail with OpenAI service error
**Current Status**: Tasks created successfully but execution fails

```
ERROR: OpenAI 服务错误: API 请求失败: 404 - {
  "error": {
    "message": "Invalid URL (POST /v1)",
    "type": "invalid_request_error",
    "param": "",
    "code": ""
  }
}
```

#### 🚨 **Issue 2: Database Connection Instability**
**Problem**: `Cannot operate on a closed database`
**Root Cause**: Database connection management issues
**Impact**: Migration failures and occasional query failures
**Current Status**: Basic functionality works but needs connection pooling

#### 🚨 **Issue 3: Frontend JavaScript Errors**
**Problem**: `_GeneratorContextManager` object attribute error
**Root Cause**: Context manager usage in API endpoints
**Impact**: Some API endpoints return 500 errors
**Affected Endpoints**: `/api/tags` and potentially others

### Functional Testing Results

#### ✅ **Working Components**
- **Basic CRUD Operations**: Create, read, update prompts
- **Web Interface**: Full UI functionality at `http://localhost:3501`
- **API Endpoints**: Most REST endpoints functional
- **Task Creation**: Optimization tasks can be created successfully
- **AI Config Management**: AI configurations load and can be selected

#### ❌ **Non-Working Components**
- **AI Optimization Execution**: Fails due to API URL configuration
- **Database Tags API**: 500 errors due to context manager issues
- **Task Completion**: No successful optimizations completed yet

### API Endpoint Reference

#### Optimization API
```bash
# Create optimization task
POST /api/prompts/<prompt_id>/optimize
Content-Type: application/json
{
  "ai_config_id": 27,
  "optimization_prompt": "请优化这个提示词，使其更加有效和清晰。"
}

# Check task status
GET /api/optimization-tasks/<task_id>
```

#### System Status API
```bash
# Get AI configurations
GET /api/ai-configs

# Get prompts list
GET /api/prompts
```

### Resolution Strategies

#### **Priority 1: Fix AI API Configuration**
1. Verify API endpoint URL correctness
2. Test API connectivity with curl/Postman
3. Update configuration in database if needed
4. Validate authentication tokens/keys

#### **Priority 2: Fix Database Connection Issues**
1. Implement proper connection pooling
2. Fix context manager usage in endpoints
3. Add connection error handling and retry logic

#### **Priority 3: Frontend Error Handling**
1. Fix JavaScript context manager implementation
2. Add better error messages for users
3. Improve loading states and progress indicators

### Development Workflow

#### **Testing Optimization Functionality**
1. Use existing prompt ID 1 for testing
2. Monitor task status via `/api/optimization-tasks/<task_id>`
3. Check Docker logs: `docker logs --tail 50 prompt-manage-prompt-manager-1`
4. Verify database state: `docker exec -it prompt-manage-prompt-manager-1 sqlite3 /app/data/data.sqlite3`

#### **Debugging Commands**
```bash
# Check container status
docker ps | grep prompt-manage

# View real-time logs
docker logs -f prompt-manage-prompt-manager-1

# Database inspection
docker exec prompt-manage-prompt-manager-1 sqlite3 /app/data/data.sqlite3 ".tables"

# Test API endpoints
curl -X GET "http://localhost:3501/api/ai-configs"
```

### Resolution Strategies - Updated with MCP Analysis

#### **Priority 1: Fix AI API Configuration** ✅ **RESOLVED**
**Issue**: `Invalid URL (POST /v1)` - 404 Error
**Root Cause**: API endpoint configuration incorrect and missing authentication
**Status**: ✅ **RESOLVED** - API configuration working correctly
**Current config in database**: `api_url = "https://newapi.eve.ink/v1"` (ID: 27)

**Solutions**:
```bash
# Option 1: Fix API URL (Base URL only)
docker exec prompt-manage-prompt-manager-1 sqlite3 /app/data/data.sqlite3 "UPDATE ai_configs SET api_url = 'https://newapi.eve.ink/v1' WHERE id = 27;"

# Option 2: Add API authentication key
# Access: http://localhost:3501/ai-configs or update database directly

# Option 3: Restart service after config changes
docker restart prompt-manage-prompt-manager-1
```

**Verification Commands**:
```bash
# Test API connectivity
curl -X GET "https://newapi.eve.ink/v1/models" -H "Authorization: Bearer YOUR_API_KEY"

# Test optimization after fix
curl -X POST "http://localhost:3501/api/prompts/1/optimize" \
  -H "Content-Type: application/json" \
  -d '{"ai_config_id": 27, "optimization_prompt": "请优化这个提示词"}'
```

#### **Priority 2: Core Python Errors** ✅ **RESOLVED (2025-11-08)**
**Status**: ✅ **RESOLVED** - Three critical Python errors fixed successfully

**Fixed Issues**:
1. **sqlite3.Row AttributeError** ✅ **RESOLVED**
   - **Problem**: `'sqlite3.Row' object has no attribute 'get'`
   - **Location**: Multiple functions in `/app/app.py`
   - **Solution**: Convert sqlite3.Row objects to dictionaries using `dict(task)` before accessing with `.get()`
   - **Functions Fixed**:
     - `AIService.__init__()` - Line ~1379
     - `create_ai_service()` - Line ~1522
     - `run_optimization_async()` - Line ~1550

2. **Database Context Manager Error** ✅ **RESOLVED**
   - **Problem**: `'_GeneratorContextManager' object has no attribute 'execute'`
   - **Location**: `api_tags()` function - Line ~1278
   - **Solution**: Changed from `conn = get_db()` to `with get_db() as conn:`

3. **Version Number Type Conversion Error** ✅ **RESOLVED**
   - **Problem**: `could not convert string to float: '1.0.0'`
   - **Location**: `run_optimization_async()` - Line ~1590
   - **Solution**: Added proper version string handling logic to safely parse version numbers

**Current Status**: ✅ Optimization workflow now executes successfully through task creation and AI processing phases. Minor database schema issue remains.

#### **Priority 3: Database Schema Issues** 🔄 **IN PROGRESS**
**Current Issue**: `table version_relations has no column named optimization_task_id`
**Status**: Tasks complete AI processing but fail during result insertion due to schema mismatch
**Next Steps**: Need to add missing column or fix database migration logic

#### **Priority 4: Frontend Error Handling**
- Fix JavaScript context manager implementation
- Add better error messages for users
- Improve loading states and progress indicators

---

## 🐳 Docker构建缓存策略指南

### 📋 **何时使用缓存（推荐）**

#### ✅ **使用缓存的情况**
```bash
# 推荐命令：利用Docker层缓存，构建速度快
docker compose build mumuainovel
```

**适用场景**：
- **日常开发**：只有少量代码变更
- **CI/CD流水线**：依赖文件未变化
- **快速测试**：需要快速构建验证
- **资源优化**：节省构建时间和带宽

**效果**：
- **首次构建**：10分钟（无缓存）
- **后续构建**：1-3分钟（有缓存）
- **仅后端变更**：30秒（前端缓存命中）
- **仅前端变更**：1分钟（后端缓存命中）

#### 🎯 **缓存命中的关键**
1. **依赖文件不变**：`package.json`、`requirements.txt`
2. **系统依赖不变**：Dockerfile基础层
3. **模型文件不变**：`backend/embedding/`
4. **配置文件不变**：`.env`、`docker-compose.yml`

### ❌ **不使用缓存（必要时）**

#### 🚨 **必须使用--no-cache的情况**
```bash
# 必要命令：完全重新构建，确保一致性
docker compose build mumuainovel --no-cache
```

**适用场景**：
- **首次构建**：全新环境，无缓存可用
- **依赖变更**：`package.json`、`requirements.txt`更新
- **基础镜像更新**：系统依赖或Python版本升级
- **缓存问题**：构建出现莫名其妙的错误
- **生产发布**：确保完全干净的构建
- **大版本升级**：Node.js、Python、依赖库大版本升级

#### 🔍 **需要--no-cache的症状**
- 构建成功但运行时出现莫名错误
- 依赖版本冲突
- 某些包安装失败
- 运行时找不到模块
- 缓存层损坏导致的问题

### 🔄 **智能缓存策略**

#### **最佳实践工作流**

```bash
# 1. 日常开发（使用缓存）
docker compose build mumuainovel

# 2. 如果构建失败，尝试清理相关层
docker compose build --no-cache mumuainovel

# 3. 依赖更新后，清理缓存
# 更新 package.json 或 requirements.txt 后
docker compose build --no-cache mumuainovel

# 4. 定期清理（每周/每月）
# 避免缓存层过多影响构建
docker system prune -f
```

#### **缓存问题诊断**

```bash
# 检查Docker存储使用情况
docker system df

# 清理未使用的镜像和缓存
docker system prune -a -f

# 强制清理所有缓存
docker builder prune -a -f
```

### 💡 **缓存优化技巧**

#### **优化Dockerfile层级**
- **少变层在前**：系统依赖、Python环境
- **多变层在后**：应用代码、配置文件
- **合理分组**：相关操作合并到同一层

#### **监控缓存效果**
```bash
# 查看构建时间
time docker compose build mumuainovel

# 查看缓存命中情况
docker compose build --progress=plain mumuainovel
```

### 🎯 **决策指南**

| 场景 | 推荐命令 | 原因 |
|------|----------|------|
| **日常开发** | `docker compose build` | 利用缓存，快速迭代 |
| **依赖更新** | `docker compose build --no-cache` | 确保新依赖正确安装 |
| **首次部署** | `docker compose build --no-cache` | 无缓存可用，确保完整 |
| **构建错误** | `docker compose build --no-cache` | 排除缓存问题 |
| **生产发布** | `docker compose build --no-cache` | 确保生产环境一致性 |
| **快速测试** | `docker compose build` | 速度优先，节省时间 |

### ⚠️ **注意事项**

1. **缓存依赖文件变更时必须用--no-cache**
2. **生产环境发布建议用--no-cache确保一致性**
3. **定期清理Docker缓存避免存储空间问题**
4. **构建失败时优先尝试--no-cache**
5. **团队开发时保持Dockerfile版本一致**

**记住：缓存是双刃剑，用得好大幅提升效率，用错了带来困扰！**

### MCP-Enhanced Debugging Workflow

#### **Using MCP Tools for Advanced Analysis**
The investigation leveraged multiple MCP tools for comprehensive analysis:

1. **Sequential Thinking Tools**: Systematic problem breakdown and solution path identification
2. **Context7 Documentation**: OpenAI API official documentation retrieval for correct endpoint configuration
3. **Tavily Web Crawling**: Real-time API documentation and community solution discovery

#### **MCP Analysis Methodology**
```bash
# Tool usage pattern for complex debugging
mcp__mcphub__search_tools  # Discover relevant analysis tools
mcp__sequentialthinking-tools  # Systematic problem analysis
context7-get-library-docs  # Official documentation retrieval
tavily-mcp-tavily-crawl  # Web resource discovery
```

### Updated Resolution Strategies

#### **Immediate Action Items**
1. **API Configuration Fix**: Update AI config with correct base URL and authentication
2. **Client Code Review**: Ensure OpenAI client uses proper base_url configuration
3. **Authentication Setup**: Obtain and configure valid API keys for newapi.eve.ink

#### **Alternative Solutions**
If current API provider cannot be fixed:
- **Primary Alternative**: OpenAI official API (`https://api.openai.com/v1`)
- **Local Options**: Ollama, LocalAI, or vLLM for on-premise deployment
- **Other Providers**: Various OpenAI-compatible API services

#### **Verification Protocol**
After fixes applied:
1. Test API connectivity with authentication
2. Create optimization task via API
3. Monitor task completion and results
4. Validate frontend integration

### Future Improvements - Enhanced with MCP Insights
- Add API endpoint validation and health checks (automated MCP-based testing)
- Implement proper error logging and monitoring (MCP tool integration)
- Add frontend validation for AI configuration (MCP-driven form validation)
- Create automated testing for optimization workflow (MCP sequential thinking)
- Add support for multiple AI providers beyond OpenAI-compatible APIs
- **NEW**: Implement MCP-based diagnostic tools for real-time system health monitoring
- **NEW**: Add automated API endpoint verification using MCP web crawling capabilities

---

## 📋 Git项目更新标准流程

### 🚨 **血泪教训：2025-11-14 MuMuAINovel更新灾难**

#### **灾难回顾**
- **根本错误**：误判网络连接问题为分支冲突，导致删除420MB宝贵模型文件
- **连锁错误**：在错误方向上不断尝试，浪费大量时间
- **解决代价**：依赖其他项目的模型文件才恢复

#### **核心教训**
1. **先诊断后解决**：错误诊断导致错误解决方案
2. **网络优先**：Git问题先检查网络连接
3. **大文件即资产**：任何几百MB的文件都应视为珍贵资源
4. **永远备份**：执行破坏性命令前必须备份

### 🔄 **标准更新流程（四阶段）**

#### **第一阶段：环境诊断（必须！）**

```bash
# 1. 网络连接诊断
curl -I https://github.com > /dev/null 2>&1 && echo "✅ GitHub连接正常" || echo "❌ 需要代理"

# 2. Git仓库状态检查
git status
git remote -v
git branch -a

# 3. 大文件资产检查（关键！）
du -sh */embedding/ 2>/dev/null || echo "无embedding目录"
find . -name "*.safetensors" -exec ls -lh {} \; 2>/dev/null || echo "无模型文件"

# 4. 容器运行状态
docker compose ps
```

**如果发现问题**：
- ❌ 网络问题 → 配置代理后再继续
- ❌ 大文件缺失 → 先备份或恢复，再考虑更新

#### **第二阶段：安全准备**

```bash
# 1. 备份重要资产
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
if [ -d "backend/embedding" ] && [ "$(du -s backend/embedding | cut -f1)" -gt 100000 ]; then
    echo "💾 备份embedding模型..."
    cp -r backend/embedding backend/embedding_backup_$TIMESTAMP
    echo "✅ 模型文件已备份到 backend/embedding_backup_$TIMESTAMP"
fi

# 2. 查看即将拉取的变更
git fetch origin main 2>/dev/null || echo "⚠️  网络问题，无法获取远程信息"
if [ $? -eq 0 ]; then
    echo "📋 即将拉取的变更："
    git log --oneline HEAD..origin/main
    git diff --name-status HEAD..origin/main
fi
```

#### **第三阶段：智能更新**

```bash
# 1. 优先使用增量更新（带代理）
if command -v HTTPS_PROXY >/dev/null; then
    echo "🔄 尝试增量更新..."
    HTTPS_PROXY=http://127.0.0.1:7897 git pull origin main
    if [ $? -eq 0 ]; then
        echo "✅ 增量更新成功"
        return 0
    fi
fi

# 2. 如果LFS问题，跳过大文件
echo "⚠️  尝试跳过LFS大文件..."
GIT_LFS_SKIP_SMUDGE=1 HTTPS_PROXY=http://127.0.0.1:7897 git pull origin main
if [ $? -eq 0 ]; then
    echo "✅ 跳过大文件更新成功，需手动处理模型"
    return 0
fi

# 3. 最后手段：手动处理大文件
echo "🔧 手动处理大文件冲突..."
# 检查是否有其他项目有完整文件
for PROJECT_DIR in /vol1/1000/docker/*/; do
    if [ -d "$PROJECT_DIR/backend/embedding" ] && [ "$(ls -la $PROJECT_DIR/backend/embedding/*.safetensors 2>/dev/null | wc -l)" -gt 0 ]; then
        echo "📁 发现完整模型文件在：$PROJECT_DIR"
        read -p "是否复制到此项目？(y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            cp -r $PROJECT_DIR/backend/embedding/* backend/embedding/
            echo "✅ 模型文件已复制"
            break
        fi
    fi
done
```

#### **第四阶段：构建验证**

```bash
# 1. 增量构建（优先）
echo "🔨 尝试增量构建..."
docker compose build mumuainovel
if [ $? -eq 0 ]; then
    echo "✅ 增量构建成功"
else
    echo "⚠️  增量构建失败，尝试完整重建..."
    docker compose build mumuainovel --no-cache
fi

# 2. 服务重启
echo "🔄 重启服务..."
docker compose restart mumuainovel

# 3. 等待启动
echo "⏳ 等待服务启动..."
sleep 30

# 4. 健康检查
echo "🏥 执行健康检查..."
if curl -f http://localhost:8025/health >/dev/null 2>&1; then
    echo "✅ 服务启动成功"
    echo "🌐 访问地址: http://localhost:8025"
else
    echo "❌ 服务启动失败，检查日志："
    docker logs mumuainovel --tail 20
fi
```

### 🚨 **绝对禁止的操作（红色警报）**

```bash
# ❌ 除非100%确定，否则禁止执行：
git clean -fd                    # 已导致灾难
git reset --hard HEAD~1         # 除非有完整备份
rm -rf backend/embedding/       # 420MB模型文件
docker system prune -af         # 可能删除重要镜像

# ✅ 安全的替代方案：
git stash push -m "backup"       # 安全暂存
git add . && git commit          # 先提交再操作
mv backend/embedding backup/    # 移动而非删除
```

### 📊 **应急恢复清单**

如果更新失败，按顺序检查：

```bash
# 1. 恢复模型文件
if [ -d "backend/embedding_backup_*" ]; then
    LATEST_BACKUP=$(ls -td backend/embedding_backup_* | head -1)
    echo "🔄 从备份恢复模型: $LATEST_BACKUP"
    rm -rf backend/embedding
    cp -r "$LATEST_BACKUP" backend/embedding
fi

# 2. 回滚代码
git reflog --oneline -10  # 查看最近操作
git reset --hard <commit-hash>  # 回滚到工作状态

# 3. 重新构建
docker compose build mumuainovel --no-cache
docker compose up -d mumuainovel
```

### 🎯 **成功标准**

更新成功必须满足：
- ✅ 网络连接正常或代理配置有效
- ✅ 重要文件（特别是embedding模型）完整无损
- ✅ 代码成功拉取到最新版本
- ✅ Docker构建无错误
- ✅ 容器启动且健康检查通过
- ✅ 应用功能正常访问

### 📝 **更新后记录**

```bash
echo "$(date): 更新完成" >> update.log
echo "Commit: $(git rev-parse --short HEAD)" >> update.log
echo "镜像: $(docker images mumuainovel -q)" >> update.log
echo "状态: $(curl -s http://localhost:8025/health | jq .status)" >> update.log
```

**记住**：宁可多花10分钟检查，也不要花2小时救灾！

