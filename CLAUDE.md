# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

### 环境与依赖
- Python 要求：`>=3.10`（见 `pyproject.toml`）
- 安装运行依赖：`pip install -r requirements.txt`
- 安装可编辑模式：`pip install -e .`
- 安装开发依赖：`pip install -e '.[dev]'`

### 启动项目
- 直接启动：`python webui.py`
- 指定监听参数：`python webui.py --host 0.0.0.0 --port 8001 --debug --log-level INFO --access-password <password>`
- 通过入口脚本启动：`spider-console`

### 测试
- 仓库当前没有 `tests/` 目录，也没有 `pytest.ini`/`tool.pytest` 配置。
- 若后续补充测试，默认使用：`pytest`
- 运行单个测试文件：`pytest path/to/test_file.py`
- 运行单个测试用例：`pytest path/to/test_file.py -k test_name`

### 打包
- 构建方式由 Hatchling 提供：`python -m build`

## 高层架构

### 应用启动链路
- `webui.py` 是实际启动入口：负责读取 `.env`、创建 `data/` 与 `logs/`、初始化数据库、加载/更新设置，然后调用 Uvicorn 启动 `src.web.app:app`。
- `src/database/init_db.py` 在启动阶段完成两件事：初始化 SQLAlchemy 连接/建表，以及把默认设置写入数据库。
- `src/config/settings.py` 的设置不是纯文件配置，而是“默认值 + 数据库 settings 表 + 环境变量兜底（仅 database_url）”的组合；Web UI 对设置页的修改最终会落到数据库里。

### Web 层结构
- `src/web/app.py` 创建 FastAPI 应用，挂载 `/static`、注册 `/api` 路由和 `/api/ws` WebSocket 路由，同时提供 HTML 页面路由。
- 页面访问有一层非常轻量的登录保护：`/login` 提交密码后，把基于 `webui_secret_key` 计算出的 HMAC 写入 `spider_console_auth` cookie；页面路由会校验该 cookie。
- HTML 页面使用 Jinja2 模板，公共框架在 `templates/base.html`；前端交互逻辑主要集中在 `static/js/app.js`，通过 `fetch` 调 `/api/*`，并通过 `/api/ws/task/{task_id}` 订阅任务状态与日志。

### 路由职责
- `src/web/routes/dashboard.py`：仪表盘摘要、最近任务、演示任务入口。
- `src/web/routes/settings.py`：读取/保存系统设置。
- `src/web/routes/dpjs.py`：DPJS 爬虫配置保存、任务启动、任务列表/详情、取消任务。
- `src/web/routes/video.py`：视频抓取配置保存、任务启动、任务列表/详情、取消任务。
- `src/web/routes/websocket.py`：任务日志与状态推送。

### 数据模型
- `src/database/models.py` 定义 3 张核心表：
  - `settings`：运行配置。
  - `spider_sites`：站点/平台级配置，`settings_json` 保存解析器相关配置。
  - `spider_tasks` + `task_logs`：任务元数据与日志。
- `src/database/crud.py` 封装所有数据库读写；当前代码没有 service/repository 的更深分层，路由和核心任务服务会直接调用这些 CRUD 方法。

### 任务执行模型
- `src/web/task_manager.py` 是运行时任务协调中心：
  - 内存里维护当前状态、日志缓存、WebSocket 连接、取消标记。
  - 同时把状态和日志持久化到数据库，保证页面刷新后仍能读到任务历史。
- `task_manager.set_loop()` 在 FastAPI startup 时绑定事件循环；后台线程里的任务通过它把日志/状态广播给 WebSocket 客户端。

### DPJS 与视频抓取的关系
- `src/core/dpjs_service.py` 负责通用的 DPJS 请求执行流程：规范化配置、构造请求模板、循环变量展开、调用 `dpjs/standalone_dpjs_downloader.py`、记录任务状态，并可执行用户提供的 Python `parse(response)` 解析代码。
- `src/core/video_service.py` 在架构上复用了同一套 DPJS 浏览器/下载器能力，但在上层增加了“平台适配器”概念；当前只内置了 bilibili 单视频页支持，其他平台会回退到 generic 适配器配置。
- 这意味着新增视频平台时，优先看 `video_service.py` 的 adapter 注册与运行流程，而不是新增独立 FastAPI 子应用。

### 资源路径与打包兼容
- `webui.py` 和 `src/web/app.py` 都显式处理了 `sys.frozen` / `sys._MEIPASS`，说明仓库在设计上兼容 PyInstaller 一类的打包场景。
- 静态资源和模板目录在运行时根据是否 frozen 动态定位，不要把这些路径硬编码成仅开发环境可用的相对路径。

## 开发时需要注意的仓库特性
- 默认数据库是 SQLite：`data/spider_console.db`。
- 启动时会自动创建 `data/` 和 `logs/`。
- `dpjs/google_user_data/` 是浏览器用户数据目录，体量较大且包含运行时缓存；做代码搜索时应避免把这里当成源码区。
- 当前前后端没有分仓或单独构建流程，模板、静态资源、FastAPI 路由都在同一仓库内协同修改。
