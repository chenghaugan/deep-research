# Deep Research + Obsidian 集成方案

## 需求背景

- **应用**：`deep-research` 运行在 Docker 中，通过 `localhost:3021` 访问 Web UI
- **目标**：每次深度研究完成后，自动将报告保存到 Obsidian
- **Obsidian 路径**：`01_投资研究/AI深度报告/`
- **Obsidian API**：`http://127.0.0.1:27123`，已验证可连接 ✅

---

## 一、架构设计

### 1.1 当前架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  用户浏览器  │────►│  proxy 容器   │────►│ deep-research│
│  localhost  │     │   :3021       │     │   :3020      │
│  :3021      │     └──────────────┘     └─────────────┘
└─────────────┘                                  │
                                                 ▼
                                          ┌─────────────┐
                                          │   Obsidian  │
                                          │   :27123    │
                                          └─────────────┘
```

**关键配置**：
- 两个容器在同一 docker 网络 (`research-net`)
- `TAVILY_API_BASE_URL=http://deep-research-proxy:3021/tavily-internal`
- SSE 流内部的 Tavily 请求通过容器名称转发到 proxy
- Proxy 自动添加 `Bearer` 前缀后转发到外部代理

### 1.2 Proxy 功能

1. **Tavily 搜索代理**：自动为 Authorization header 添加 `Bearer` 前缀
2. **SSE 流转发**：实时转发研究进度
3. **Obsidian 保存**：将报告保存到 Obsidian vault

---

## 二、环境变量配置

### 2.1 .env 文件

```bash
# ==================== 访问控制 ====================
ACCESS_PASSWORD=a+123456

# ==================== AI 模型配置 ====================
# OpenAI 兼容 API 基础 URL
OPENAI_API_BASE_URL=https://api.openai.com

# 可选的 OpenAI 兼容服务示例：
# - DeepSeek: https://api.deepseek.com
# - X.AI: https://api.x.ai
# - OpenRouter: https://openrouter.ai
# - 本地 Ollama: http://host.docker.internal:11434/v1

# ==================== 搜索引擎配置 ====================
# Tavily 搜索 API 代理 URL
TAVILY_API_BASE_URL=https://tavily-proxy.870314.top:5000

# ==================== Obsidian 集成配置 ====================
DEEP_RESEARCH_URL=http://192.168.31.118:3020
OBSIDIAN_API_URL=http://127.0.0.1:27123
OBSIDIAN_API_KEY=your_obsidian_api_key
OBSIDIAN_PATH=01_投资研究/AI深度报告
PROXY_PORT=3021
```

---

## 三、Tavily 配置说明

### 3.1 问题背景

部分 Tavily 代理服务要求 Authorization header 格式为 `Bearer xxx`，但 deep-research 后端直接传递原始 API key。

**解决方案**：
- 设置 `TAVILY_API_BASE_URL` 环境变量指向 proxy 的 `/tavily-internal` 路径
- SSE 流内部的 Tavily 搜索请求会通过 proxy 发送
- Proxy 自动从请求 body 中提取 `api_key` 并添加 `Bearer` 前缀

### 3.2 架构流程

```
SSE 流请求 → deep-research 后端 → TAVILY_API_BASE_URL → proxy:/tavily-internal → 外部 Tavily 代理
                                                    ↓
                                              自动添加 Bearer 前缀
```

### 3.3 Web UI 配置

| 配置项 | 值 |
|-------|-----|
| **搜索引擎** | Tavily |
| **API Key** | 你的 API key（不需要 Bearer 前缀） |

### 3.4 测试 Tavily 连接

```bash
# 测试内部路径（SSE 流使用此路径）
curl -X POST "http://localhost:3021/tavily-internal/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"test","max_results":5,"api_key":"your_api_key"}'

# 测试 Web UI 直连路径
curl -X POST "http://localhost:3021/api/search/tavily/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: your_api_key" \
  -d '{"query":"test","max_results":5}'
```

---

## 四、部署方式

### 4.1 启动服务

```bash
cd /home/xuanyang/docker/deep-research
docker compose up -d
```

### 4.2 访问地址

- **Web UI**：`http://localhost:3021`（通过 proxy 访问）
- **直连 deep-research**：`http://localhost:3020`（不推荐，Tavily 可能不可用）

### 4.3 查看日志

```bash
# 查看 proxy 日志（包含 Tavily 代理信息）
docker logs deep-research-proxy --tail 20

# 查看 deep-research 日志
docker logs deep-research --tail 20
```

---

## 五、文件结构

```
/home/xuanyang/docker/deep-research/
├── .env                 # 环境变量配置
├── compose.yml          # Docker compose 配置
├── readme.md            # 本文档
└── proxy/
│   ├── proxy.js         # 代理服务代码（含 Tavily Bearer 修复）
│   ├── package.json     # Node.js 依赖
│   └── Dockerfile       # Proxy 容器配置
```

---

## 六、保存到 Obsidian

用户完成研究后，调用保存接口：

```bash
curl -X POST "http://localhost:3021/api/save-to-obsidian" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "研究报告标题",
    "content": "# 报告内容..."
  }'
```

文件将保存为: `01_投资研究/AI深度报告/2026-03-31_研究报告标题.md`

---

## 七、验证测试

```bash
# 1. 检查 proxy 运行状态
curl http://localhost:3021/health

# 2. 测试 Tavily 搜索
curl -X POST "http://localhost:3021/api/search/tavily/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: your_api_key" \
  -d '{"query":"test","max_results":5}'

# 3. 测试保存到 Obsidian
curl -X POST "http://localhost:3021/api/save-to-obsidian" \
  -H "Content-Type: application/json" \
  -d '{"title": "测试", "content": "# 测试报告"}'
```

---

## 八、注意事项

1. **必须通过 :3021 访问**：proxy 监听 3021 端口，转发到 3020
2. **Obsidian 必须运行**：保存时 Obsidian 必须在后台运行
3. **API Key 不需要 Bearer 前缀**：proxy 会自动添加
4. **网络模式**：proxy 容器使用 host 网络模式，可访问宿主机服务

---

## 九、修改 AI 模型

如需更换 AI 提供商，修改 `.env` 文件中的 `OPENAI_API_BASE_URL`：

| 服务商 | URL |
|-------|-----|
| OpenAI 官方 | `https://api.openai.com` |
| DeepSeek | `https://api.deepseek.com` |
| X.AI (Grok) | `https://api.x.ai` |
| OpenRouter | `https://openrouter.ai` |
| 本地 Ollama | `http://host.docker.internal:11434/v1` |

修改后重启：
```bash
docker compose down && docker compose up -d
```

在 Web UI 设置中选择 **OpenAI Compatible** 作为 AI 提供商，填入对应的 API Key。