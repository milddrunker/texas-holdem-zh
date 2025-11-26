# Texas Hold'em Multi

多人德州扑克（Node.js + Express + Socket.IO）。支持多人联机、自动阶段推进、No-Limit 下注规则、房主管理，以及摊牌分配与盈亏显示。

## 主要特性
- 多人实时联机：Socket.IO 双向通信，状态差异化广播。
- 自动流程：阶段与行动自动推进；房主仅负责“开启下一局”和“重置房间”。
- 开局准备机制：房主点击“开启下一局”后所有玩家变为“未准备”；只有当所有玩家点击“准备”，系统才自动开始发牌并设置大小盲（10/20）。
- No-Limit 下注规则：
  - 下注（Bet）仅在本轮尚无下注时允许；金额 ≥ 最小下注（BB）。
  - 加注（Raise）需达到 当前最高下注 + 上一次加注增量（最小加注增量会随加注更新）。
  - 跟注（Call）补齐到当前最高下注；过牌（Check）在持平时允许。
  - 服务端权威校验，违规操作会在客户端弹窗提示。
- 当前行动高亮：UI 高亮轮到行动的玩家。
- 摊牌与分配：自动评估牌型，平分底池（并处理多人并列），更新每位玩家盈亏（正负值）。
- 简洁前端：原生 HTML/CSS/JS，无框架依赖。

## 技术栈与结构
- 服务端：`server.js`
  - Express 静态托管 `public/`，Socket.IO 事件与状态管理。
  - 主要事件：`join`、`setReady`、`startNextHand`、`bet`、`raise`、`call`、`check`、`fold`、`resetGame`、`disconnect`。
  - 广播字段：阶段、公共牌、庄位/SB/BB、当前最高下注、最小下注与最小加注增量、当前行动玩家、旁池列表、玩家盈亏与回合下注信息。
- 客户端：`public/index.html`
  - 原生页面与交互，渲染桌面、玩家状态、按钮可用性与错误弹窗。

## 目录结构
```
.
├─ public/
│  └─ index.html         # 客户端页面（原生 HTML/JS/CSS）
├─ server.js             # Node + Express + Socket.IO 服务端
└─ README.md             # 项目说明
```

## 本地运行
1. 安装 Node.js（推荐 LTS）。
2. 在项目根目录运行：
   - `node server.js`
3. 浏览器访问：
   - `http://localhost:3000/`
4. 两台设备分别打开后：房主点击“开启下一局”，所有人点击“准备”，自动开始；按规则进行下注/加注/跟注/过牌。

## 公网部署（统一域名）
推荐同源部署（静态页与 Socket.IO 同一域名）。

1) 域名与服务器
- 购买域名与云主机（公网 IP）。
- 在域名 DNS 添加 `A` 记录指向云主机 IP。

2) 部署 Node 服务
- 安装 Node.js 与可选进程守护（如 `pm2`）。
- 上传代码并启动：`pm2 start server.js --name texas-holdem` 或 `node server.js`。

3) Nginx + HTTPS + WebSocket
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

4) 验证
- 在不同网络访问 `https://yourdomain.com`，两端加入房间后，状态与下注互动可实时同步。

## 使用说明
- 输入昵称后 `加入房间`。
- 房主点击 `开启下一局`，所有玩家自动变为 `未准备`。
- 所有玩家点击 `准备` 后自动发牌与设置大小盲。
- 根据 UI 提示进行下注/加注/跟注/过牌；违规会弹窗提示。
- `弃牌` 退出本局；`重置牌局` 仅房主可用。

## 常见问题
- 无法连接：检查 Nginx WebSocket 转发（`Upgrade`/`Connection: upgrade`）、开放 80/443 入站与证书有效性。
- 跨域部署：建议同源；如需分离，请在服务端启用 Socket.IO CORS 并在客户端使用显式后端 URL。

## 说明
- 演示侧重规则/流程与实时互动，旁池在全下情形下的精细分配可按需要继续完善。
- 代码结构简洁，便于扩展如踢人、房间列表、更多 UI 与测试用例。
