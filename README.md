# Cpider Console

一个基于 FastAPI 的爬虫任务控制台项目，提供 Web UI、配置管理、日志目录和本地数据库初始化能力。

## 功能简介

- 基于 FastAPI 提供 Web 管理界面
- 支持登录鉴权访问控制
- 启动时自动初始化数据库与默认配置
- 提供静态资源、模板页面和 WebSocket 路由
- 集成 DrissionPage，适合浏览器自动化/爬虫相关场景

## 项目结构

```text
Cpider-console/
├── main.py              # 启动入口
├── webui.py             # 示例脚本/占位文件
├── pyproject.toml       # 项目配置
├── requirements.txt     # 依赖列表
├── src/                 # 核心源码
│   ├── config/          # 配置管理
│   ├── core/            # 核心服务与工具
│   ├── database/        # 数据库初始化与访问
│   └── web/             # Web 应用与路由
├── templates/           # Jinja2 模板
├── static/              # 静态资源
├── data/                # 数据文件
└── logs/                # 日志文件
```

## 运行环境

- Python 3.10 及以上

## 安装依赖

推荐先创建并激活虚拟环境，再安装依赖：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

如果你使用 `pyproject.toml`：

```bash
pip install -e .
```

## 启动项目

当前可用的启动方式：

```bash
python main.py
```

如果需要指定参数：

```bash
python main.py --host 0.0.0.0 --port 8001 --debug --log-level INFO --access-password your_password
```

默认启动配置：

- Host: `127.0.0.1`
- Port: `8001`
- 默认访问密码: `admin123`

启动后访问：

```text
http://127.0.0.1:8001
```

## 启动参数

`main.py` 当前支持以下命令行参数：

- `--host`：指定 Web UI 监听地址
- `--port`：指定 Web UI 端口
- `--debug`：开启调试模式
- `--log-level`：指定日志级别
- `--access-password`：设置 Web UI 访问密码

## 环境变量

项目启动时会尝试读取根目录下的 `.env` 文件，常用环境变量包括：

- `WEBUI_HOST`
- `WEBUI_PORT`
- `DEBUG`
- `LOG_LEVEL`
- `WEBUI_ACCESS_PASSWORD`
- `APP_DATABASE_URL`

## 数据与日志

启动时会自动确保以下目录存在：

- `data/`：用于存放数据库等数据文件
- `logs/`：用于存放日志文件

## 默认安全配置

当前默认值适合本地开发，若要对外使用，建议至少修改：

- `webui_access_password`
- `webui_secret_key`

## 说明

- `main.py` 是实际启动入口。
- `webui.py` 当前是示例文件，不是主程序入口，也不能作为项目启动命令使用。
