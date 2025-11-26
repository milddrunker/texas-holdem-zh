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
let stage = 'idle';
let dealerSeat = null;
let sbSeat = null;
let bbSeat = null;
let sb = 10;
let bb = 20;
let currentMaxBet = 0;
let minBet = 20;
let minRaiseInc = 20;
let lastAggressorSeat = null;
let currentTurnId = null;
let pots = [];

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
                ledger: self.ledger || 0,
                currentBet: self.currentBet || 0,
                totalCommitted: self.totalCommitted || 0,
                inHand: !!self.inHand,
                isCurrentTurn: id === currentTurnId,
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
                ledger: p.ledger || 0,
                currentBet: p.currentBet || 0,
                totalCommitted: p.totalCommitted || 0,
                inHand: !!p.inHand,
                isCurrentTurn: pid === currentTurnId,
            }));

        socket.emit('state', {
            stage,
            communityCards,
            hostId,
            playerCount,
            you,
            others,
            dealerSeat,
            sbSeat,
            bbSeat,
            currentMaxBet,
            minBet,
            minRaiseInc,
            currentTurnId,
            pots,
        });
    });
}

function startGameIfReady() {
    if (stage !== 'idle') return;
    const activesAll = Object.values(players);
    if (activesAll.length < 2) return;

    const allReady = activesAll.every((p) => p.ready);
    if (!allReady) return;

    deck = createDeck();
    shuffle(deck);
    communityCards = [];
    stage = 'preflop';

    const actives = Object.entries(players)
        .filter(([, p]) => p && p.ready)
        .sort((a, b) => a[1].id - b[1].id);

    if (dealerSeat == null) {
        dealerSeat = actives.length ? actives[0][1].id : null;
    } else {
        const ids = actives.map(([, p]) => p.id);
        if (ids.length) {
            const idx = ids.indexOf(dealerSeat);
            dealerSeat = ids[(idx + 1 + ids.length) % ids.length];
        }
    }

    for (const [, p] of actives) {
        p.inHand = true;
        p.folded = false;
        p.holeCards = [deck.pop(), deck.pop()];
        p.currentBet = 0;
        p.totalCommitted = 0;
        p.actedThisRound = false;
        if (p.ledger == null) p.ledger = 0;
    }

    const ordered = actives.map(([, p]) => p).sort((a, b) => a.id - b.id);
    const dIdx = ordered.findIndex((p) => p.id === dealerSeat);
    sbSeat = ordered[(dIdx + 1) % ordered.length].id;
    bbSeat = ordered[(dIdx + 2) % ordered.length].id;

    const sbPlayer = actives.find(([, p]) => p.id === sbSeat)[1];
    const bbPlayer = actives.find(([, p]) => p.id === bbSeat)[1];
    sbPlayer.currentBet += sb;
    sbPlayer.totalCommitted += sb;
    bbPlayer.currentBet += bb;
    bbPlayer.totalCommitted += bb;
    currentMaxBet = bb;
    minBet = bb;
    minRaiseInc = bb;
    lastAggressorSeat = bbSeat;
    pots = [{ amount: sb + bb, eligibleSeats: ordered.filter((p) => p.inHand && !p.folded).map((p) => p.id) }];

    const firstTurnSeat = ordered[(dIdx + 3) % ordered.length].id;
    const firstTurn = actives.find(([, p]) => p.id === firstTurnSeat)[0];
    currentTurnId = firstTurn;

    broadcastMessage(`人数 ${activesAll.length}，全部已准备，开始发底牌！`);
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
        broadcastMessage('进入摊牌阶段。');
        distributePayouts();
    } else {
        return;
    }
    Object.values(players).forEach((p) => { if (p) { p.currentBet = 0; p.actedThisRound = false; } });
    const actives = Object.values(players).filter((p) => p.inHand && !p.folded).sort((a, b) => a.id - b.id);
    const dIdx = actives.findIndex((p) => p.id === dealerSeat);
    const startSeat = stage === 'preflop' ? actives[(dIdx + 3) % actives.length].id : actives[(dIdx + 1) % actives.length].id;
    const startId = Object.entries(players).find(([, p]) => p.id === startSeat)[0] || null;
    currentTurnId = startId;
    currentMaxBet = 0;
    minRaiseInc = bb;
    broadcastState();
}

function resetGame() {
    const ps = Object.values(players);
    for (const p of ps) {
        p.ready = false;
        p.holeCards = [];
        p.folded = false;
        p.inHand = false;
        p.currentBet = 0;
        p.totalCommitted = 0;
    }
    deck = [];
    communityCards = [];
    stage = 'idle';
    dealerSeat = null;
    sbSeat = null;
    bbSeat = null;
    currentMaxBet = 0;
    minBet = bb;
    minRaiseInc = bb;
    lastAggressorSeat = null;
    currentTurnId = null;
    pots = [];
    broadcastMessage('牌局已重置，大家可以重新准备。');
    broadcastState();
}

io.on('connection', (socket) => {
    console.log('client connected', socket.id);

    socket.on('join', (data) => {
        const rawName = (data && data.name) || '';
        const name = rawName.trim() || '玩家';
        const role = 'player';

        if (players[socket.id]) {
            players[socket.id].name = name;
            // spectator 已取消，统一为 player
        } else {
            const nextSeat = Object.keys(players).length + 1;
            players[socket.id] = {
                id: nextSeat,
                name: name,
                ready: false,
                holeCards: [],
                folded: false,
                // spectator 已取消，统一为 player
                ledger: 0,
                inHand: false,
                currentBet: 0,
                totalCommitted: 0,
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

    socket.on('startNextHand', () => {
        if (socket.id !== hostId) { sendError(socket, '只有房主可以开启下一局'); return; }
        const allPlayers = Object.values(players);
        for (const p of allPlayers) {
            p.ready = false;
            p.inHand = false;
            p.folded = false;
            p.holeCards = [];
            p.currentBet = 0;
            p.totalCommitted = 0;
            p.actedThisRound = false;
        }
        deck = [];
        communityCards = [];
        stage = 'idle';
        currentMaxBet = 0;
        minBet = bb;
        minRaiseInc = bb;
        lastAggressorSeat = null;
        currentTurnId = null;
        pots = [];
        broadcastMessage('已开启下一局，请所有玩家点击“准备”以开始发牌。');
        broadcastState();
    });

    socket.on('fold', () => {
        const p = players[socket.id];
        if (!p) return;
        if (stage === 'idle' || stage === 'showdown') { sendError(socket, '当前阶段不可弃牌'); return; }
        if (socket.id !== currentTurnId) { sendError(socket, '还未轮到你行动'); return; }
        p.folded = true;
        p.inHand = false;
        p.actedThisRound = true;
        advanceTurn();
        broadcastMessage(`「${p.name}」选择弃牌。`);
        broadcastState();
    });

    socket.on('resetGame', () => {
        if (socket.id !== hostId) return;
        resetGame();
    });

    socket.on('bet', (amount) => {
        const p = players[socket.id];
        if (!p) return;
        if (stage === 'idle' || stage === 'showdown') { sendError(socket, '当前阶段不可下注'); return; }
        if (socket.id !== currentTurnId) { sendError(socket, '还未轮到你行动'); return; }
        const a = Math.floor(Number(amount) || 0);
        if (currentMaxBet > 0) { sendError(socket, '本轮已有下注，不能再次下注，请使用加注'); return; }
        if (a < minBet) { sendError(socket, `最小下注为 ${minBet}`); return; }
        p.currentBet += a;
        p.totalCommitted += a;
        currentMaxBet = p.currentBet;
        minRaiseInc = Math.max(minRaiseInc, a);
        lastAggressorSeat = p.id;
        p.actedThisRound = true;
        updatePots();
        advanceTurn();
        broadcastMessage(`「${p.name}」下注 ${a}。`);
        broadcastState();
    });

    socket.on('call', () => {
        const p = players[socket.id];
        if (!p) return;
        if (stage === 'idle' || stage === 'showdown') { sendError(socket, '当前阶段不可跟注'); return; }
        if (socket.id !== currentTurnId) { sendError(socket, '还未轮到你行动'); return; }
        const need = Math.max(0, currentMaxBet - (p.currentBet || 0));
        if (need <= 0) { sendError(socket, '当前无需跟注'); return; }
        p.currentBet += need;
        p.totalCommitted += need;
        p.actedThisRound = true;
        updatePots();
        advanceTurn();
        broadcastMessage(`「${p.name}」跟注 ${need}。`);
        broadcastState();
    });

    socket.on('check', () => {
        const p = players[socket.id];
        if (!p) return;
        if (stage === 'idle' || stage === 'showdown') { sendError(socket, '当前阶段不可过牌'); return; }
        if (socket.id !== currentTurnId) { sendError(socket, '还未轮到你行动'); return; }
        if ((p.currentBet || 0) !== currentMaxBet) { sendError(socket, '当前有更高下注，不能过牌'); return; }
        p.actedThisRound = true;
        advanceTurn();
        broadcastMessage(`「${p.name}」过牌。`);
        broadcastState();
    });

    socket.on('raise', (amount) => {
        const p = players[socket.id];
        if (!p) return;
        if (stage === 'idle' || stage === 'showdown') { sendError(socket, '当前阶段不可加注'); return; }
        if (socket.id !== currentTurnId) { sendError(socket, '还未轮到你行动'); return; }
        const a = Math.floor(Number(amount) || 0);
        const needToCall = Math.max(0, currentMaxBet - (p.currentBet || 0));
        const inc = a - needToCall;
        if (needToCall < 0) { sendError(socket, '数值错误'); return; }
        const finalBet = (p.currentBet || 0) + a;
        if (currentMaxBet > 0 && finalBet < currentMaxBet + minRaiseInc) { sendError(socket, `最小加注到 ${currentMaxBet + minRaiseInc}`); return; }
        if (currentMaxBet === 0 && a < minBet) { sendError(socket, `最小下注为 ${minBet}`); return; }
        p.currentBet += a;
        p.totalCommitted += a;
        currentMaxBet = p.currentBet;
        minRaiseInc = Math.max(minRaiseInc, inc > 0 ? inc : minRaiseInc);
        lastAggressorSeat = p.id;
        p.actedThisRound = true;
        updatePots();
        advanceTurn(true);
        broadcastMessage(`「${p.name}」加注到 ${p.currentBet}。`);
        broadcastState();
    });

    // legacy bet/call/check handlers removed; unified above with no-limit rules

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

function sendError(socket, msg) {
    socket.emit('actionError', msg);
}

function updatePots() {
    const actives = Object.values(players).filter((p) => p.inHand);
    const total = actives.reduce((s, p) => s + (p.totalCommitted || 0), 0);
    pots = [{ amount: total, eligibleSeats: actives.filter((p) => !p.folded).map((p) => p.id) }];
}

function advanceTurn(resetAggressor) {
    const actives = Object.entries(players)
        .filter(([, p]) => p.inHand && !p.folded)
        .sort((a, b) => a[1].id - b[1].id);
    if (actives.length <= 1) { stage = 'showdown'; distributePayouts(); broadcastState(); return; }
    const ids = actives.map(([id]) => id);
    let idx = ids.indexOf(currentTurnId);
    let nextIdx = (idx + 1) % ids.length;
    currentTurnId = ids[nextIdx];
    if (resetAggressor) {
        for (const [, p] of actives) p.actedThisRound = false;
    }
    if (isRoundComplete()) { nextStage(); return; }
    broadcastState();
}

function isRoundComplete() {
    const actives = Object.values(players).filter((p) => p.inHand && !p.folded);
    if (!actives.length) return true;
    const allEqual = actives.every((p) => (p.currentBet || 0) === currentMaxBet);
    if (!allEqual) return false;
    const lastAggressorIndex = actives.findIndex((p) => p.id === lastAggressorSeat);
    if (lastAggressorIndex < 0) return actives.every((p) => p.actedThisRound);
    const ids = actives.map((p) => p.id);
    const turnIndex = ids.indexOf(players[currentTurnId]?.id);
    return actives.every((p) => p.actedThisRound);
}

function distributePayouts() {
    const showdownPlayers = Object.values(players).filter((p) => p.totalCommitted > 0);
    if (!showdownPlayers.length) return;
    const evaluated = showdownPlayers.filter((p) => Array.isArray(p.holeCards) && p.holeCards.length === 2).map((p) => ({ p, cards: p.holeCards.concat(communityCards) }));
    const scores = evaluated.map(({ p, cards }) => ({ p, data: evaluate7(cards) }));
    const winners = pickWinners(scores, showdownPlayers.filter((p) => !p.folded));
    const total = pots.reduce((s, pot) => s + (pot.amount || 0), 0);
    if (!winners.length) return;
    const share = Math.round(total / winners.length);
    for (const w of winners) w.ledgerGain = share;
    for (const p of showdownPlayers) {
        const gain = winners.some((w) => w.id === p.id) ? share : 0;
        const loss = p.totalCommitted || 0;
        p.ledger = (p.ledger || 0) + gain - loss;
    }
}

function compareScores(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i] ?? 0;
        const bv = b[i] ?? 0;
        if (av !== bv) return av - bv;
    }
    return 0;
}

function evaluate5Cards(cards) {
    const ranks = cards.map((c) => c.rank);
    const suits = cards.map((c) => c.suit);
    const rankCount = {};
    for (const r of ranks) rankCount[r] = (rankCount[r] || 0) + 1;
    const counts = Object.values(rankCount).sort((a, b) => b - a);
    const isFlush = new Set(suits).size === 1;
    const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
    let straightHigh = null;
    if (uniqueRanks.length === 5) {
        if (uniqueRanks[0] - uniqueRanks[4] === 4) straightHigh = uniqueRanks[0];
        else {
            const set = new Set(uniqueRanks);
            if (set.has(14) && set.has(2) && set.has(3) && set.has(4) && set.has(5)) straightHigh = 5;
        }
    }
    const isStraight = straightHigh !== null;
    const score = [];
    const rankKeys = Object.keys(rankCount).map(Number);
    if (isFlush && isStraight) { score.push(8, straightHigh); return score; }
    if (counts[0] === 4) {
        let fourRank = null; let kicker = null;
        for (const r of rankKeys) { if (rankCount[r] === 4) fourRank = r; else if (rankCount[r] === 1) kicker = r; }
        score.push(7, fourRank, kicker); return score;
    }
    if (counts[0] === 3 && counts[1] === 2) {
        let tripRank = null; let pairRank = null;
        for (const r of rankKeys) { if (rankCount[r] === 3) tripRank = r; else if (rankCount[r] === 2) pairRank = r; }
        score.push(6, tripRank, pairRank); return score;
    }
    if (isFlush) { const sortedRanks = ranks.slice().sort((a, b) => b - a); score.push(5, ...sortedRanks); return score; }
    if (isStraight) { score.push(4, straightHigh); return score; }
    if (counts[0] === 3) {
        let tripRank = null; const kickers = [];
        for (const r of rankKeys) { if (rankCount[r] === 3) tripRank = r; else kickers.push(r); }
        kickers.sort((a, b) => b - a); score.push(3, tripRank, ...kickers); return score;
    }
    if (counts[0] === 2 && counts[1] === 2) {
        const pairs = []; let kicker = null;
        for (const r of rankKeys) { if (rankCount[r] === 2) pairs.push(r); else if (rankCount[r] === 1) kicker = r; }
        pairs.sort((a, b) => b - a); score.push(2, pairs[0], pairs[1], kicker); return score;
    }
    if (counts[0] === 2) {
        let pairRank = null; const kickers = [];
        for (const r of rankKeys) { if (rankCount[r] === 2) pairRank = r; else kickers.push(r); }
        kickers.sort((a, b) => b - a); score.push(1, pairRank, ...kickers); return score;
    }
    const sortedRanks = ranks.slice().sort((a, b) => b - a);
    score.push(0, ...sortedRanks); return score;
}

function evaluate7Cards(cards) {
    let bestScore = null; let bestHand = null;
    function dfs(startIndex, chosenIndices) {
        if (chosenIndices.length === 5) {
            const subset = chosenIndices.map((idx) => cards[idx]);
            const score = evaluate5Cards(subset);
            if (!bestScore || compareScores(score, bestScore) > 0) { bestScore = score; bestHand = subset; }
            return;
        }
        for (let i = startIndex; i < cards.length; i++) { chosenIndices.push(i); dfs(i + 1, chosenIndices); chosenIndices.pop(); }
    }
    dfs(0, []); return { score: bestScore, hand: bestHand };
}

function evaluate7(cards) {
    const { score } = evaluate7Cards(cards);
    return score;
}

function pickWinners(scores, eligible) {
    const eligIds = new Set(eligible.map((p) => p.id));
    const filtered = scores.filter(({ p }) => eligIds.has(p.id));
    let best = null;
    let ws = [];
    for (const s of filtered) {
        if (!best || compareScores(s.data, best) > 0) { best = s.data; ws = [s]; }
        else if (compareScores(s.data, best) === 0) { ws.push(s); }
    }
    return ws.map((x) => x.p);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Server listening on port', PORT);
});
