# Hello World Worker

一个简单而优雅的多语言问候页面 Cloudflare Worker。

A simple and elegant multilingual greeting page Cloudflare Worker.

## 功能特性 (Features)

- 🌍 **多语言问候**: 展示12种不同语言的问候语
- 📍 **地理位置信息**: 显示访客的IP地址、地理位置和Cloudflare POP
- ⏰ **实时时间**: 显示当前的北京时间
- 🎨 **现代化设计**: 响应式设计，支持移动端和桌面端
- ⚡ **边缘计算**: 基于 Cloudflare Workers，全球低延迟访问

## 支持的语言 (Supported Languages)

1. 中文 (Chinese) - 你好
2. English - Hello
3. 日本語 (Japanese) - こんにちは
4. 한국어 (Korean) - 안녕하세요
5. Español (Spanish) - Hola
6. Français (French) - Bonjour
7. Deutsch (German) - Guten Tag
8. Italiano (Italian) - Ciao
9. Português (Portuguese) - Olá
10. Русский (Russian) - Здравствуйте
11. العربية (Arabic) - مرحبا
12. हिन्दी (Hindi) - नमस्ते

## 部署方法 (Deployment)

### 使用 Wrangler CLI

1. 安装 Wrangler:
```bash
npm install -g wrangler
```

2. 登录到 Cloudflare:
```bash
wrangler login
```

3. 部署 Worker:
```bash
wrangler deploy
```

### 手动部署

1. 登录到 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 导航到 Workers & Pages
3. 创建新的 Worker
4. 复制 `worker.js` 的内容到编辑器
5. 保存并部署

## 配置 (Configuration)

此 Worker 不需要任何环境变量或配置。它会自动:
- 检测访客的 IP 地址和地理位置
- 显示 Cloudflare 边缘节点信息
- 展示当前时间（默认为北京时间）

## 技术栈 (Tech Stack)

- **平台**: Cloudflare Workers
- **运行时**: V8 JavaScript Engine
- **前端**: 原生 HTML/CSS (无框架依赖)
- **设计**: 渐变背景 + 现代卡片式布局

## 许可证 (License)

MIT License - 详见项目主 README 文件

## 贡献 (Contributing)

欢迎提交 Issue 和 Pull Request！

Welcome to submit Issues and Pull Requests!
