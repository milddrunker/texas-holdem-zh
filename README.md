# Texas Hold'em Multi

多人德州扑克演示项目（Node.js + Express + Socket.IO）。当前支持多人联机、房主控制阶段、弃牌、基本牌型评估，以及新增的简化筹码与下注功能（下注、跟注、过牌；不包含结算与多边底池）。

## 项目概览
- 运行于 Node.js，使用 `Express` 提供静态页面与 Socket.IO 服务端。
- 前端为原生 HTML/JS，通过 Socket.IO 与服务端实时通信，所有玩家状态通过服务端广播同步。
- 默认同源架构：前端与服务端由同一个域名/端口提供（客户端以 `io()` 自动连接）。

## 功能
- 玩家加入房间、设置昵称、准备开局。
- 房主控制发牌阶段：翻牌前、翻牌、转牌、河牌、摊牌。
- 手牌与公共牌展示，摊牌阶段显示每位玩家的最佳牌型（未进行底池分配）。
- 弃牌、重置牌局。
- 筹码与下注（简化版）：
  - 每局起始筹码 `1000`。
  - 支持 `下注`（手动输入筹码）、`跟注`（补齐到最高下注）、`过牌`（在已持平时）。
  - 进入下一阶段自动清空“本轮下注”；底池在整局累计。

## 技术架构
- 服务端：`server.js`
  - `Express` 静态托管：`app.use(express.static('public'))`。
  - `Socket.IO` 事件：`join`、`setReady`、`nextStage`、`fold`、`resetGame`、`disconnect`，以及新增 `bet`、`call`、`check`。
  - 状态广播包含：阶段、公共牌、房主、玩家列表（含自己/他人）、`pot`（底池）、每位玩家 `stack`（筹码）与 `bet`（本轮下注）。
  - 监听端口：读取 `process.env.PORT`，默认 `3000`。
- 客户端：`public/index.html`
  - 引入 Socket.IO 客户端并以同源方式连接：`io()`。
  - 展示玩家、公共牌、日志；新增筹码/下注信息与按钮逻辑。

## 目录结构
```
.
├─ public/
│  └─ index.html         # 前端页面（原生 HTML/JS/CSS）
├─ server.js             # Node + Express + Socket.IO 服务端
└─ README.md             # 项目说明
```

## 本地运行
1. 安装依赖并启动：
   - 安装 Node.js（推荐 LTS）。
   - 在项目根目录运行：
     - `node server.js`
2. 打开浏览器访问：
   - `http://localhost:3000/`
3. 在两台设备或两个浏览器窗口中分别打开，加入房间、准备、体验发牌与下注。

## 部署到公网（统一域名）
目标：让非同一局域网的玩家也能通过一个统一的域名加入游戏。推荐同源部署（静态页与 Socket.IO 均走同一域名）。

### 步骤
1. 域名与服务器：
   - 购买域名与一台云主机（具有公网 IP）。
   - 在域名 DNS 添加 `A` 记录指向云主机公网 IP。
2. 部署 Node 服务：
   - 在服务器安装 Node.js 与可选的进程守护（如 `pm2`）。
   - 将代码上传至服务器，设置环境变量：`PORT=3000`。
   - 启动：`pm2 start server.js --name texas-holdem`（或直接 `node server.js`）。
3. 反向代理与证书（推荐 Nginx + Let’s Encrypt）：
   - 在服务器上安装 Nginx，签发域名证书（例如 `certbot`）。
   - 开启 80/443 入站（安全组/防火墙）。
   - Nginx 配置将 `https://yourdomain.com` 代理到 `http://127.0.0.1:3000`，并开启 WebSocket：

```
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

4. 验证：
   - 在不同网络（例如移动网络与家用宽带）下访问 `https://yourdomain.com`。
   - 两侧页面能正常连接，加入房间后状态与底池变化可同步显示。

### 跨域部署（前后端分离）
如果前端与服务端不在同一域名：
- 服务端需启用 Socket.IO CORS：

```js
// server.js 中将
const io = new Server(server);
// 改为
const io = new Server(server, {
  cors: { origin: "https://your-frontend-domain", methods: ["GET", "POST"] }
});
```

- 客户端以显式 URL 连接：

```js
const socket = io("https://your-backend-domain", { transports: ["websocket"] });
```

通常不建议分离，除非有前端托管需求；同源部署配置更简单且无需 CORS。

### 免运维快速通道（可选）
- 使用 Cloudflare Tunnel 或 Caddy 将本地 `3000` 暴露到域名，适合快速演示；正式环境仍推荐标准云主机 + Nginx + HTTPS。

## 使用指南（简要）
- 打开页面后输入昵称并点击 `加入房间`。
- 至少两人 `准备` 后自动发底牌，房主控制阶段推进。
- 下注区：输入金额后点击 `下注`；若桌上有更高下注可 `跟注`；与最高下注持平时可 `过牌`。
- `弃牌` 退出本局；`重置牌局` 由房主执行，恢复起始筹码并清空底池。

## 常见问题
- 无法连接？
  - 检查 Nginx 是否正确转发 WebSocket（`Upgrade`/`Connection: upgrade`）。
  - 确认防火墙/安全组已开放 `80/443` 入站。
  - 证书是否有效，是否强制走 `https://`（浏览器可能阻止非安全 WebSocket）。
- 前端跨域？
  - 使用同源部署可避免 CORS；分离时按“跨域部署”部分配置。

## 备注
- 项目演示为简化规则：未实现盲注、行动次序、加注限制与结算。若需要完整德州扑克流程，可在此基础上扩展（例如加注流程、最小加注额、摊牌分配与多边底池等）。

