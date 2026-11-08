## 简介
基于cloudflare worker的telegram 消息转发bot
## KV
|Type|Name|Value|
|----|----|-----|
|KV namespace|nfd|nfd|
|KV namespace|FRAUD_LIST|FRAUD_LIST|
## 必要步骤
初次部署后，向 `https://xxx.workers.dev/registerWebhook` 发送 POST 请求来注册 webhook，并在 `X-Telegram-Bot-Api-Secret-Token` 请求头中提供已配置的 `ENV_BOT_SECRET`。不要将密钥放到 URL 中。

`/unRegisterWebhook` 和 `/setCommands` 使用相同的 POST 方法和请求头。直接通过浏览器地址栏打开管理接口不再执行操作。已有 Telegram webhook 的消息接收方式不变。

管理命令和选择聊天目标的按钮，仅允许 `ENV_ADMIN_UID` 本人在与机器人的私聊中使用。部署前请先在本地或测试环境验证；本轮修改未执行线上注册或部署。
## Thanks
- https://github.com/LloydAsp/nfd
- https://github.com/cvzi/telegram-bot-cloudflare
- https://github.com/small-haozi/worker-SXbot.js/tree/main
