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

function assert(name, cond) {
  if (!cond) throw new Error("Test failed: " + name);
  console.log("PASS", name);
}

const rf = [
  { rank: 10, suit: '♠' },
  { rank: 11, suit: '♠' },
  { rank: 12, suit: '♠' },
  { rank: 13, suit: '♠' },
  { rank: 14, suit: '♠' },
];
const sf = [
  { rank: 9, suit: '♠' },
  { rank: 10, suit: '♠' },
  { rank: 11, suit: '♠' },
  { rank: 12, suit: '♠' },
  { rank: 13, suit: '♠' },
];

const a = evaluate5Cards(rf);
const b = evaluate5Cards(sf);
assert('皇家同花顺胜于同花顺', compareScores(a, b) > 0);

const seven = [
  { rank: 14, suit: '♠' },
  { rank: 14, suit: '♥' },
  { rank: 10, suit: '♠' },
  { rank: 9, suit: '♣' },
  { rank: 8, suit: '♦' },
  { rank: 7, suit: '♦' },
  { rank: 6, suit: '♦' },
];
const res = evaluate7Cards(seven);
assert('评估7张牌得到结果', Array.isArray(res.score) && res.score.length > 0);
