// app.js
// P2P chess client: PeerJS + chess.js, random matchmaking, legal moves, queen capture loses, move animation

const SERVER_BASE = "https://onlinechese.onrender.com";

const PEER_PATH = '/peerjs/peer'; // as mounted in server.js

// UI elements
const boardEl = document.getElementById('board');
const connStatusEl = document.getElementById('connStatus');
const roleBadgeEl = document.getElementById('roleBadge');
const turnBadgeEl = document.getElementById('turnBadge');
const myIdEl = document.getElementById('myId');
const opponentIdEl = document.getElementById('opponentId');
const logEl = document.getElementById('log');
const findMatchBtn = document.getElementById('findMatchBtn');
const resetBtn = document.getElementById('resetBtn');

// Chess state
const chess = new window.Chess(); // chess.js
let myColor = null; // 'w' or 'b'
let peer = null;
let conn = null;
let myPeerId = null;
let opponentPeerId = null;

// Board rendering model
const files = ['a','b','c','d','e','f','g','h'];
const ranks = ['1','2','3','4','5','6','7','8'];
const SQUARE_SIZE = 62.5;
const pieceElBySquare = new Map();
let selectedSquare = null;
let legalTargets = new Set();

// Helpers
function log(msg) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(line);
}

function setConnStatus(text, color='') {
  connStatusEl.textContent = text;
  connStatusEl.style.borderColor = color || '#e5e7eb';
}

function setRoleBadge(text) {
  roleBadgeEl.textContent = text;
}
function setTurnBadge(text) {
  turnBadgeEl.textContent = text;
}

function algebraicToXY(sq) {
  const f = files.indexOf(sq[0]);
  const r = ranks.indexOf(sq[1]);
  return { x: f, y: r };
}

function squareTopLeft(sq) {
  const { x, y } = algebraicToXY(sq);
  // White at bottom: rank 1 at bottom visually
  const top = (7 - y) * SQUARE_SIZE;
  const left = x * SQUARE_SIZE;
  return { top, left };
}

function createSquares() {
  boardEl.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = files[f] + ranks[r];
      const el = document.createElement('div');
      el.className = 'square ' + (((r + f) % 2 === 0) ? 'light' : 'dark');
      el.style.top = (7 - r) * SQUARE_SIZE + 'px';
      el.style.left = f * SQUARE_SIZE + 'px';
      el.dataset.square = sq;

      const coord = document.createElement('div');
      coord.className = 'square coord';
      coord.textContent = sq;
      el.appendChild(coord);

      el.addEventListener('click', () => onSquareClick(sq));

      boardEl.appendChild(el);
    }
  }
}

function pieceEmoji(piece) {
  const map = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
  };
  return map[piece.color][piece.type];
}

function renderPieces() {
  // Remove existing
  for (const el of pieceElBySquare.values()) el.remove();
  pieceElBySquare.clear();

  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const sq = files[f] + ranks[r];
      const el = document.createElement('div');
      el.className = `piece ${piece.color}`;
      el.textContent = pieceEmoji(piece);
      const { top, left } = squareTopLeft(sq);
      el.style.transform = `translate(${left + 1}px, ${top + 1}px)`;
      el.dataset.square = sq;
      el.dataset.color = piece.color;
      el.dataset.type = piece.type;

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onPieceSelect(sq);
      });

      boardEl.appendChild(el);
      pieceElBySquare.set(sq, el);
    }
  }
}

function highlightSquares(sqs) {
  // Clear
  document.querySelectorAll('.square.highlight').forEach(el => el.classList.remove('highlight'));
  sqs.forEach(sq => {
    const targetEl = [...document.querySelectorAll('.square')].find(el => el.dataset.square === sq);
    if (targetEl) targetEl.classList.add('highlight');
  });
}

function onPieceSelect(sq) {
  if (!myColor) return;
  const piece = chess.get(sq);
  if (!piece || piece.color !== myColor) return;
  selectedSquare = sq;

  const moves = chess.moves({ square: sq, verbose: true });
  legalTargets = new Set(moves.map(m => m.to));
  highlightSquares([sq, ...legalTargets]);
}

function onSquareClick(sq) {
  if (!myColor) return;

  // Allow deselect
  if (selectedSquare && selectedSquare === sq) {
    selectedSquare = null;
    legalTargets.clear();
    highlightSquares([]);
    return;
  }

  if (!selectedSquare) {
    onPieceSelect(sq);
    return;
  }

  if (!legalTargets.has(sq)) return; // only legal moves allowed

  const move = chess.move({ from: selectedSquare, to: sq, promotion: 'q' });
  if (!move) return;

  selectedSquare = null;
  legalTargets.clear();
  highlightSquares([]);

  animateMove(move.from, move.to, () => {
    renderPieces();
    afterMoveEffects(move, true);
    broadcastMove(move);
  });
}

function animateMove(from, to, onDone) {
  const pieceEl = pieceElBySquare.get(from);
  if (!pieceEl) { onDone?.(); return; }
  pieceEl.classList.add('dragging');
  const { left: toLeft, top: toTop } = squareTopLeft(to);
  pieceEl.style.transform = `translate(${toLeft + 1}px, ${toTop + 1}px)`;
  setTimeout(() => {
    pieceEl.classList.remove('dragging');
    onDone?.();
  }, 240);
}

function broadcastMove(move) {
  if (!conn || conn.open !== true) return;
  conn.send({ type: 'move', move });
  setTurnBadge('相手の番');
  log(`あなた: ${move.from} → ${move.to}${move.captured ? `（${move.captured}捕獲）` : ''}`);
}

function afterMoveEffects(move, isLocal) {
  // Turn badge
  const turnColor = chess.turn(); // whose turn next
  setTurnBadge(turnColor === myColor ? 'あなたの番' : '相手の番');

  // Queen capture = instant loss for the captured side
  if (move.captured === 'q') {
    const loser = (isLocal ? '相手' : 'あなた');
    log(`クイーン捕獲！${loser}の敗北`);
    endGame(`${loser}の敗北（クイーン捕獲）`);
  }

  // Checkmate detection fallback (not required, but informative)
  if (chess.game_over()) {
    if (chess.in_checkmate()) {
      log('チェックメイト！');
    } else if (chess.in_stalemate()) {
      log('ステイルメイト');
    } else if (chess.insufficient_material()) {
      log('引き分け（駒不足）');
    }
  }
}

function endGame(message) {
  setConnStatus(message, '#ef4444');
  // Disable inputs by clearing selection and legal targets
  selectedSquare = null;
  legalTargets.clear();
  highlightSquares([]);
  // Prevent further moves by nulling myColor
  myColor = null;
}

function initPeer() {
  myPeerId = `p${Math.random().toString(36).slice(2, 10)}`;
  myIdEl.textContent = myPeerId;

  peer = new Peer(myPeerId, {
    host: new URL(SERVER_BASE).hostname,
    port: new URL(SERVER_BASE).port || (SERVER_BASE.startsWith('https') ? 443 : 80),
    path: '/peerjs/peer',
    secure: SERVER_BASE.startsWith('https'),
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
      ],
    },
  });

  peer.on('open', () => {
    setConnStatus('接続待機中', '#2563eb');
    log('PeerJS open');
  });

  peer.on('connection', (c) => {
    conn = c;
    opponentPeerId = c.peer;
    opponentIdEl.textContent = opponentPeerId;

    conn.on('open', () => {
      decideColors();
      setConnStatus('対戦相手に接続', '#10b981');
      setTurnBadge(chess.turn() === myColor ? 'あなたの番' : '相手の番');
      log(`接続: ${myPeerId} ⇄ ${opponentPeerId}`);
      conn.send({ type: 'hello', id: myPeerId });
    });

    conn.on('data', onData);
    conn.on('close', () => {
      setConnStatus('接続が切断されました', '#ef4444');
      log('接続が切断');
    });
  });

  peer.on('error', (err) => {
    setConnStatus('エラー', '#ef4444');
    log(`Peer error: ${err.type || err}`);
  });
}

function connectToOpponent(id) {
  opponentPeerId = id;
  opponentIdEl.textContent = opponentPeerId;
  conn = peer.connect(opponentPeerId, { reliable: true });
  conn.on('open', () => {
    decideColors();
    setConnStatus('対戦相手に接続', '#10b981');
    setTurnBadge(chess.turn() === myColor ? 'あなたの番' : '相手の番');
    log(`接続: ${myPeerId} → ${opponentPeerId}`);
    conn.send({ type: 'hello', id: myPeerId });
  });
  conn.on('data', onData);
  conn.on('close', () => {
    setConnStatus('接続が切断されました', '#ef4444');
    log('接続が切断');
  });
}

function decideColors() {
  // Deterministic: lexicographically smaller ID is white
  const [wId, bId] = [myPeerId, opponentPeerId].sort();
  myColor = (myPeerId === wId) ? 'w' : 'b';
  setRoleBadge(myColor === 'w' ? 'あなた：白' : 'あなた：黒');
}

function onData(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.type === 'hello') {
    log(`相手とハンドシェイク: ${payload.id}`);
  }
  if (payload.type === 'move') {
    const move = payload.move;
    const ok = chess.move(move);
    if (!ok) {
      log('相手の不正手を受信（無視）');
      return;
    }
    animateMove(move.from, move.to, () => {
      renderPieces();
      afterMoveEffects(move, false);
      setTurnBadge('あなたの番');
      log(`相手: ${move.from} → ${move.to}${move.captured ? `（${move.captured}捕獲）` : ''}`);
    });
  }
}

// Matchmaking
async function startMatchmaking() {
  setConnStatus('ランダムマッチ検索中...', '#2563eb');
  log('マッチング登録');
  await fetch(`${SERVER_BASE}/match/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId: myPeerId }),
  }).catch(() => {});

  const poll = async () => {
    try {
      const res = await fetch(`${SERVER_BASE}/match/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: myPeerId }),
      });
      const data = await res.json();
      if (data.status === 'paired' && data.opponentId) {
        connectToOpponent(data.opponentId);
        return true;
      }
    } catch (e) {
      log('マッチングエラー（再試行）');
    }
    return false;
  };

  const interval = setInterval(async () => {
    const done = await poll();
    if (done) clearInterval(interval);
  }, 1500);
}

// Reset
function resetGame() {
  chess.reset();
  selectedSquare = null;
  legalTargets.clear();
  highlightSquares([]);
  renderPieces();
  setTurnBadge(chess.turn() === myColor ? 'あなたの番' : '相手の番');
  setConnStatus('ゲームをリセット', '#2563eb');
  log('ゲームをリセット');
}

function initBoard() {
  createSquares();
  renderPieces();
}

// Wire UI
findMatchBtn.addEventListener('click', () => {
  if (!peer || !peer.open) {
    log('Peer未準備。少し待って再試行してください。');
    return;
  }
  startMatchmaking();
});

resetBtn.addEventListener('click', resetGame);

// Bootstrap
initBoard();
initPeer();
setRoleBadge('未割り当て');
setTurnBadge('—');
