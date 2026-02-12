## MuMuAINovel 二次开发/紧跟上游指南（面向后续 AI 开发）

本仓库为上游 MuMuAINovel 的 fork，用于二次开发，并保持**高频同步上游更新**。
目标是：

1. 尽可能“吃到上游更新”
2. 二开功能尽量不与上游改动产生大面积冲突
3. 让后续 AI 开发有明确的落点与检查清单

---

## 0. 约定（必须遵守）

### 0.1 Git 远端与分支

- `origin`: 你的 fork
- `upstream`: 上游原仓库

分支建议（已按此组织）：

- `main`：基准分支（保持干净，尽量不放二开）
- `custom/main`：二开主分支（所有自定义功能在此开发）
- `upstream/main`：上游主分支（只读参考，不在此开发）
- `upstream/dev`：上游开发分支（仅参考）

### 0.2 二开“能力类型”分流（优先级：插件 > 新模块 > 改核心）

1) **新增外部工具能力**（检索/爬取/内部系统/第三方 API 等）

- 一律走 **MCP 插件**（通过插件管理 API + DB 持久化 + 动态加载 tools）
- 原因：几乎不需要改核心逻辑；上游更新冲突极少

2) **新增业务 API/数据模型/页面**（项目内 CRUD、列表、详情页等）

- 走“**新模块 + 少量入口注册**”
- 把改动集中在少数固定入口文件，避免散落修改

3) **必须修改核心生成/核心流程**

- 优先改成“可配置开关/可插拔 hook”，否则 rebase 成本会持续上升
- 能上游化（向上游提 PR 提供扩展点）优先上游化

---

## 1. 项目结构速览

### 1.1 后端（FastAPI + SQLAlchemy + PostgreSQL）

- 入口：`backend/app/main.py`
- 配置：`backend/app/config.py`（pydantic-settings，读取 `backend/.env`）
- DB：`backend/app/database.py`
- 模型集中导出：`backend/app/models/__init__.py`
- API 路由模块：`backend/app/api/*.py`（每个模块通常自带 `router = APIRouter(...)`）

### 1.2 前端（React 18 + TS + AntD + Zustand + Vite）

- 路由：`frontend/src/App.tsx`（react-router-dom v6：`BrowserRouter + Routes/Route`）
- API 客户端：`frontend/src/services/api.ts`（axios 实例 `baseURL: '/api'`，带 withCredentials）
- Vite 代理：`frontend/vite.config.ts`（dev 下 `/api` -> `http://localhost:8000`）
- 前端构建产物默认输出到：`backend/static`（用于后端静态托管）

### 1.3 推荐运行方式

- 推荐：`docker-compose.yml`（包含 postgres + app）
- 本地开发：按根目录 `README.md` 的 backend/frontend 分别启动

注意：不要在文档/代码里写死密钥；配置应通过 `.env` / 环境变量提供，参考 `backend/.env.example`。

---

## 2. MCP 插件扩展（新增外部工具能力的首选方案）

### 2.1 插件体系关键事实（你应该知道它已经具备什么）

- 插件是 **按用户** 存在 DB 中的记录（启用/禁用、状态、工具缓存等）
- 后端提供完整的插件管理 API（创建/更新/启用/禁用/测试/列出工具/调用工具/状态与指标）
- 工具加载链路：`backend/app/services/mcp_tools_loader.py`
  - 会查询用户启用的插件并调用 `mcp_client.ensure_registered` / `get_tools`
  - 将 tool 列表格式化为 OpenAI tools schema（并做 5 分钟缓存）
- 前端已内置 MCP 插件管理页面与 API 客户端：
  - `frontend/src/services/api.ts` 内的 `mcpPluginApi`
  - 路由：`/mcp-plugins`

### 2.2 什么时候用 MCP 插件

符合以下任意一条就优先做成 MCP 插件：

- 需要访问外部系统（HTTP/SSE/streamable http）
- 需要给 AI “新增工具”（搜索、抓取、知识库、内部服务能力）
- 希望尽量不碰核心生成/业务逻辑

### 2.3 MCP 插件二开落地方式（建议）

1. 外部能力实现为 MCP server（独立进程/服务）
2. 通过系统现有插件管理 API 注册/启用（或在前端插件页操作）
3. 在业务上只做最小接入：
   - 尽量让现有 AI 流程自动“看到”新工具（通过 tools loader 动态加载）
   - 避免在核心链路里写死某个插件名称或 tool 名称

---

## 3. 新增后端业务模块（CRUD/API）规范：最小侵入

### 3.1 推荐的模块布局

新增一个功能模块（示例：`xxx`）推荐自包含：

- `backend/app/api/xxx.py`：API 路由（`router = APIRouter(prefix='...', tags=[...])`）
- `backend/app/schemas/xxx.py`：Pydantic schema（请求/响应）
- `backend/app/models/xxx.py`：SQLAlchemy 模型（建议包含 `user_id` 用于隔离）
- `backend/app/services/xxx_service.py`：业务逻辑（避免把逻辑写在 api 层）

### 3.2 需要触碰的“入口文件”（尽量控制在这些固定点）

1) **路由注册**：`backend/app/main.py`

- 在文件顶部 import 你的 `app.api.xxx`
- `app.include_router(xxx.router, prefix='/api')`

2) **模型导出**：`backend/app/models/__init__.py`

- import 你的模型并加入 `__all__`

3) **Alembic 元数据导入（非常关键）**

- `backend/alembic/postgres/env.py`
- `backend/alembic/sqlite/env.py`

这两个 env.py 都有一段“显式 import 模型”的列表，用于确保 `Base.metadata` 完整。
如果你新增了 DB 表，必须把模型加入 **两个 env.py 的 import 列表**，否则 autogenerate 可能漏表。

### 3.3 数据库会话与用户隔离

- 依赖注入建议使用：`from app.database import get_db`
- `get_db` 通过 `request.state.user_id` 判断登录态，并创建 AsyncSession
- 新表建议包含 `user_id` 字段，并在所有查询中按 user_id 过滤，避免跨用户数据泄漏

### 3.4 迁移命令（推荐用脚本）

项目提供：`backend/scripts/migrate.py`

常用：

- 生成迁移：`python backend/scripts/migrate.py create "feat: add xxx"`
- 升级：`python backend/scripts/migrate.py upgrade`

容器启动时会自动：`alembic upgrade head`（见 `backend/scripts/entrypoint.sh`）。

---

## 4. 新增前端页面/模块规范：最小侵入

### 4.1 路由

- 路由集中在：`frontend/src/App.tsx`
- 新增页面：通常在 `frontend/src/pages/` 新建组件，然后在 `App.tsx` 增加 `<Route ... />`
- 需要登录保护时：包在 `ProtectedRoute` 下（保持项目既有行为一致）

### 4.2 API 接入

- 统一走：`frontend/src/services/api.ts` 的 axios 实例（`baseURL: '/api'`）
- 约定：
  - 为新模块新增一个 `xxxApi` 区块导出函数
  - 为请求/响应在 `frontend/src/types`（或项目现有类型目录）补齐 TS 类型

注意：不要在前端硬编码后端地址（dev 使用 Vite proxy，prod 使用相对路径）。

---

## 5. 紧跟上游更新：Rebase SOP（高频同步）

### 5.1 基本原则

- `custom/main` 保持为“补丁栈”（一组小而聚焦的 commits）
- 不要把“格式化/重构”混进功能提交；否则每次 rebase 冲突扩大
- 冲突尽量只发生在少数入口文件（`backend/app/main.py`、`frontend/src/App.tsx`、`frontend/src/services/api.ts` 等）

### 5.2 同步上游（推荐流程）

1) 拉取上游：

```bash
git fetch upstream
```

2) 在二开分支上 rebase 到上游最新：

```bash
git checkout custom/main
git rebase upstream/main
```

3) 有冲突：解决后继续

```bash
git add <resolved-files>
git rebase --continue
```

4) rebase 完成后推送到 origin：

```bash
# rebase 会改历史，务必用 --force-with-lease
git push --force-with-lease origin custom/main
```

### 5.3 安全措施（强烈建议）

- 已启用 `rerere`：Git 会记住你解决冲突的方式，后续同类冲突会自动复用
- 每次 rebase 前先打一个本地备份分支：

```bash
git checkout custom/main
git branch backup/custom-main-$(date +%Y%m%d-%H%M)
```

- rebase 过程中想撤销：

```bash
git rebase --abort
```

---

## 6. 二开提交规范（为了长期 rebase 不爆炸）

建议 commit 结构（示例）：

- `feat(mcp): ...` 仅 MCP 接入
- `feat(api): ...` 仅后端 API 与 DB
- `feat(ui): ...` 仅前端页面
- `fix: ...` 修复 bug

约束：

- 一次提交只做一类事情（不要顺手改无关文件）
- 避免大范围重命名/格式化（会让上游合并几乎不可读）

---

## 7. 新功能开发检查清单（AI 开发必须逐项自检）

### 7.1 MCP 插件类

- [ ] 能力是否可以通过 MCP server 暴露为 tool？
- [ ] 是否通过现有插件管理 API/前端页面启用/测试？
- [ ] 没有在核心链路里写死插件名称/工具名称（除非业务强约束）

### 7.2 后端新模块类

- [ ] 新增 `app/api/xxx.py`、`schemas/xxx.py`、`models/xxx.py`、`services/xxx_service.py`
- [ ] `backend/app/main.py` 仅新增必要的 import + include_router
- [ ] `backend/app/models/__init__.py` 已导出新模型
- [ ] Alembic postgres/sqlite env.py 的模型 import 列表已加入新模型
- [ ] 查询按 `user_id` 做隔离（避免跨用户泄露）

### 7.3 前端新页面类

- [ ] `frontend/src/App.tsx` 添加路由（必要时使用 ProtectedRoute）
- [ ] `frontend/src/services/api.ts` 增加对应 `xxxApi` 调用
- [ ] TS 类型已补齐且不重复造轮子

---

## 8. 备注：构建与部署要点

- `docker-compose.yml` 会把根目录 `./.env` 挂载到容器 `/app/.env`（只读）
- Dockerfile 为多阶段构建：前端 build 产物拷到后端 `./static` 供 FastAPI 托管
- 容器启动会自动跑迁移：`alembic upgrade head`
