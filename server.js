// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静态资源目录：public/index.html
app.use(express.static('public'));

const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_MIN = 2;
const RANK_MAX = 14;

// 所有玩家（socket.id -> player）
const players = {};
let hostId = null;          // 房主 socket.id
let deck = [];
let communityCards = [];
let stage = 'idle';         // idle, preflop, flop, turn, river, showdown

function createDeck() {
    const d = [];
    for (let r = RANK_MIN; r <= RANK_MAX; r++) {
        for (const s of SUITS) {
            d.push({ rank: r, suit: s });
        }
    }
    return d;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function burnCard() {
    if (deck.length > 0) deck.pop();
}

function broadcastMessage(msg) {
    console.log(msg);
    io.emit('message', msg);
}

function broadcastState() {
    const playerEntries = Object.entries(players);
    const playerCount = playerEntries.length;
    const showdown = stage === 'showdown';

    io.sockets.sockets.forEach((socket, id) => {
        const self = players[id] || null;
        const you = self
            ? {
                id: self.id,
                name: self.name,
                ready: self.ready,
                folded: self.folded,
                holeCards: self.holeCards,     // 自己永远能看到自己的底牌
                isHost: id === hostId,
            }
            : null;

        const others = playerEntries
            .filter(([pid]) => pid !== id)
            .map(([pid, p]) => ({
                id: p.id,
                name: p.name,
                ready: p.ready,
                folded: p.folded,
                isHost: pid === hostId,
                // 在摊牌阶段之前不把对手的底牌发给前端
                holeCards: showdown ? p.holeCards : [],
            }));

        socket.emit('state', {
            stage,
            communityCards,
            hostId,
            playerCount,
            you,
            others,
        });
    });
}

function startGameIfReady() {
    if (stage !== 'idle') return;
    const ps = Object.values(players);
    if (ps.length < 2) return;

    const allReady = ps.every((p) => p.ready);
    if (!allReady) return;

    // 所有人都准备好了，开局发底牌
    deck = createDeck();
    shuffle(deck);
    communityCards = [];
    stage = 'preflop';

    for (const p of ps) {
        p.holeCards = [deck.pop(), deck.pop()];
        p.folded = false;
    }

    broadcastMessage(`人数 ${ps.length}，全部已准备，开始发底牌！`);
    broadcastState();
}

function nextStage() {
    if (stage === 'preflop') {
        burnCard();
        communityCards.push(deck.pop(), deck.pop(), deck.pop());
        stage = 'flop';
        broadcastMessage('进入翻牌阶段。');
    } else if (stage === 'flop') {
        burnCard();
        communityCards.push(deck.pop());
        stage = 'turn';
        broadcastMessage('进入转牌阶段。');
    } else if (stage === 'turn') {
        burnCard();
        communityCards.push(deck.pop());
        stage = 'river';
        broadcastMessage('进入河牌阶段。');
    } else if (stage === 'river') {
        stage = 'showdown';
        broadcastMessage('进入摊牌阶段（所有手牌对所有人可见，本 Demo 不做筹码结算）。');
    } else {
        return;
    }
    broadcastState();
}

function resetGame() {
    const ps = Object.values(players);
    for (const p of ps) {
        p.ready = false;
        p.holeCards = [];
        p.folded = false;
    }
    deck = [];
    communityCards = [];
    stage = 'idle';
    broadcastMessage('牌局已重置，大家可以重新准备。');
    broadcastState();
}

io.on('connection', (socket) => {
    console.log('client connected', socket.id);

    socket.on('join', (data) => {
        const rawName = (data && data.name) || '';
        const name = rawName.trim() || '玩家';

        if (players[socket.id]) {
            players[socket.id].name = name;
        } else {
            const nextSeat = Object.keys(players).length + 1;
            players[socket.id] = {
                id: nextSeat,
                name: name,
                ready: false,
                holeCards: [],
                folded: false,
            };
            if (!hostId) {
                hostId = socket.id;
                broadcastMessage(`「${name}」加入房间（当前为房主，可以控制发牌节奏）。`);
            } else {
                broadcastMessage(`「${name}」加入房间。`);
            }
        }
        broadcastState();
    });

    socket.on('setReady', (ready) => {
        const p = players[socket.id];
        if (!p) return;
        p.ready = !!ready;
        broadcastMessage(`「${p.name}」${p.ready ? '已准备' : '取消准备'}。`);
        broadcastState();
        startGameIfReady();
    });

    socket.on('nextStage', () => {
        if (socket.id !== hostId) return;
        if (stage === 'idle') {
            startGameIfReady();
        } else {
            nextStage();
        }
    });

    socket.on('fold', () => {
        const p = players[socket.id];
        if (!p) return;
        if (stage === 'idle' || stage === 'showdown') return;
        p.folded = true;
        broadcastMessage(`「${p.name}」选择弃牌。`);
        broadcastState();
    });

    socket.on('resetGame', () => {
        if (socket.id !== hostId) return;
        resetGame();
    });

    socket.on('disconnect', () => {
        const p = players[socket.id];
        delete players[socket.id];
        if (p) {
            broadcastMessage(`「${p.name}」断开连接。`);
        }
        if (hostId === socket.id) {
            const ids = Object.keys(players);
            hostId = ids[0] || null;
            if (hostId) {
                const newHost = players[hostId];
                broadcastMessage(`房主已变更为「${newHost.name}」。`);
            } else {
                deck = [];
                communityCards = [];
                stage = 'idle';
            }
        }
        broadcastState();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Server listening on port', PORT);
});
