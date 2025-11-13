// client.js
const socket = io();

let gameId = null;
let myColor = null; // 'w' or 'b'
let chess = null;
let selected = null;
let squares = [];
let animating = false;
let lastMove = null;

const boardEl = document.getElementById('board');
const findBtn = document.getElementById('findBtn');

const gameIdEl = document.getElementById('gameId');
const myColorEl = document.getElementById('myColor');
const statusEl = document.getElementById('gameStatus');
const roleEl = document.getElementById('roleLabel');
const turnEl = document.getElementById('turnLabel');
const lastMoveEl = document.getElementById('lastMoveLabel');

// Unicode chess pieces
const PIECES = {
  w: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' },
  b: { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }
};

function algebraicToIndex(square) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
  const rank = 8 - parseInt(square[1], 10); // 0..7
  return { file, rank, index: rank * 8 + file };
}

function indexToAlgebraic(i) {
  const file = i % 8;
  const rank = Math.floor(i / 8);
  const a = String.fromCharCode('a'.charCodeAt(0) + file);
  const r = 8 - rank;
  return `${a}${r}`;
}

// Build board squares
function initBoard() {
  boardEl.innerHTML = '';
  squares = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const i = r * 8 + f;
      const sq = document.createElement('div');
      sq.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
      sq.dataset.index = i;
      boardEl.appendChild(sq);
      squares.push(sq);
    }
  }
}

function clearHighlights() {
  squares.forEach(sq => {
    sq.classList.remove('highlight-select', 'highlight-move');
  });
}

function renderBoard() {
  // Clear existing pieces
  squares.forEach(sq => sq.innerHTML = '');

  const board = chess.board(); // 8x8 matrix
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece) {
        const el = document.createElement('div');
        el.className = 'piece';
        el.textContent = PIECES[piece.color][piece.type];
        // place centered in square
        el.style.transform = 'translate(0, 0)';
        squares[r * 8 + f].appendChild(el);
      }
    }
  }
  applyLastMoveHighlight();
}

function applyLastMoveHighlight() {
  clearHighlights();
  if (!lastMove) return;
  const fromI = algebraicToIndex(lastMove.from).index;
  const toI = algebraicToIndex(lastMove.to).index;
  squares[fromI].classList.add('highlight-select');
  squares[toI].classList.add('highlight-move');
}

function animateMove(from, to) {
  const { index: fromI } = algebraicToIndex(from);
  const { index: toI } = algebraicToIndex(to);

  const fromSq = squares[fromI];
  const toSq = squares[toI];

  const pieceEl = fromSq.querySelector('.piece');
  if (!pieceEl) return;

  const fromRect = fromSq.getBoundingClientRect();
  const toRect = toSq.getBoundingClientRect();

  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;

  animating = true;
  pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
  setTimeout(() => {
    animating = false;
    renderBoard();
  }, 170);
}

function updateStatusBar() {
  const t = chess.turn();
  turnEl.textContent = `手番: ${t === 'w' ? '白' : '黒'}`;
  if (lastMove) {
    lastMoveEl.textContent = `前手: ${lastMove.from} → ${lastMove.to} (${lastMove.san || '-'})`;
  } else {
    lastMoveEl.textContent = '前手: -';
  }
}

function setRoleLabel() {
  if (!myColor) {
    roleEl.textContent = '未参加';
  } else {
    roleEl.textContent = `あなたは${myColor === 'w' ? '白' : '黒'}`;
  }
}

function legalMovesFrom(square) {
  return chess.moves({ square, verbose: true }).map(m => m.to);
}

function orientIndex(i) {
  // If you're black, flip the board indexing
  if (myColor === 'b') {
    const rank = Math.floor(i / 8);
    const file = i % 8;
    const flipRank = 7 - rank;
    const flipFile = 7 - file;
    return flipRank * 8 + flipFile;
  }
  return i;
}

function squareClickHandler(e) {
  if (!gameId || animating) return;
  if (chess.turn() !== myColor) return; // not your turn

  const i = parseInt(e.currentTarget.dataset.index, 10);
  // Adjust algebraic by orientation for black POV
  const baseAlg = indexToAlgebraic(i);
  const alg = myColor === 'b' ? indexToAlgebraic(orientIndex(i)) : baseAlg;

  const pieceAt = chess.get(alg);

  // Select or move
  if (!selected) {
    // must select your own piece
    if (pieceAt && pieceAt.color === myColor) {
      selected = alg;
      clearHighlights();
      const { index: selI } = algebraicToIndex(selected);
      squares[myColor === 'b' ? orientIndex(selI) : selI].classList.add('highlight-select');
      const moves = legalMovesFrom(selected);
      moves.forEach(to => {
        const { index: toI } = algebraicToIndex(to);
        squares[myColor === 'b' ? orientIndex(toI) : toI].classList.add('highlight-move');
      });
    }
  } else {
    // attempt move from selected -> alg (as destination)
    const dest = alg;
    const move = chess.move({ from: selected, to: dest, promotion: 'q' });
    if (move) {
      // Locally animate from selected to dest based on current (pre-move) board
      animateMove(selected, dest);
      lastMove = { from: selected, to: dest, san: move.san };
      updateStatusBar();
      clearHighlights();
      selected = null;

      // Send to server (source of truth)
      socket.emit('game:move', { gameId, from: move.from, to: move.to, promotion: move.promotion });
    } else {
      // illegal, reset selection if clicked own piece
      const clickedOwn = pieceAt && pieceAt.color === myColor;
      clearHighlights();
      selected = clickedOwn ? alg : null;
      if (selected) {
        const { index: selI } = algebraicToIndex(selected);
        squares[myColor === 'b' ? orientIndex(selI) : selI].classList.add('highlight-select');
        const moves = legalMovesFrom(selected);
        moves.forEach(to => {
          const { index: toI } = algebraicToIndex(to);
          squares[myColor === 'b' ? orientIndex(toI) : toI].classList.add('highlight-move');
        });
      }
    }
  }
}

// Attach handlers to squares after init
function bindSquareHandlers() {
  squares.forEach(sq => {
    sq.addEventListener('click', squareClickHandler);
  });
}

// Socket events
socket.on('lobby:connected', () => {
  statusEl.textContent = '待機中';
});

socket.on('lobby:waiting', () => {
  statusEl.textContent = 'マッチング中...';
});

socket.on('game:start', ({ gameId: gid, fen, turn, colors }) => {
  gameId = gid;
  chess = new Chess(fen);
  myColor = colors[socket.id];
  gameIdEl.textContent = gid;
  myColorEl.textContent = myColor === 'w' ? '白' : '黒';
  statusEl.textContent = '対局中';
  setRoleLabel();
  renderBoard();
  updateStatusBar();
});

socket.on('game:update', ({ fen, turn, lastMove: lm, status, winner, suddenDeath }) => {
  // Server is source of truth; sync position
  const prev = chess ? chess.fen() : null;
  chess = new Chess(fen);
  lastMove = lm || lastMove;
  updateStatusBar();

  if (lm && prev) {
    animateMove(lm.from, lm.to);
  } else {
    renderBoard();
  }

  if (status === 'ended') {
    statusEl.textContent = suddenDeath ? '終了（クイーンが取られました）' : '終了';
    const youWin = (winner === myColor);
    if (winner === 'draw') {
      turnEl.innerHTML = '<span class="draw">引き分け</span>';
    } else {
      turnEl.innerHTML = youWin ? '<span class="win">あなたの勝ち！</span>' : '<span class="lose">あなたの負け</span>';
    }
  } else {
    statusEl.textContent = '対局中';
  }
});

socket.on('game:error', ({ message }) => {
  // brief toast via status label
  statusEl.textContent = `エラー: ${message}`;
  setTimeout(() => {
    statusEl.textContent = gameId ? '対局中' : '待機中';
  }, 900);
});

// UI actions
findBtn.addEventListener('click', () => {
  socket.emit('lobby:findMatch');
});

// Initialize
initBoard();
bindSquareHandlers();
renderBoard();
updateStatusBar();
setRoleLabel();
// client.js
const socket = io();

let gameId = null;
let myColor = null; // 'w' or 'b'
let chess = null;
let selected = null;
let squares = [];
let animating = false;
let lastMove = null;

const boardEl = document.getElementById('board');
const findBtn = document.getElementById('findBtn');

const gameIdEl = document.getElementById('gameId');
const myColorEl = document.getElementById('myColor');
const statusEl = document.getElementById('gameStatus');
const roleEl = document.getElementById('roleLabel');
const turnEl = document.getElementById('turnLabel');
const lastMoveEl = document.getElementById('lastMoveLabel');

// Unicode chess pieces
const PIECES = {
  w: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' },
  b: { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }
};

function algebraicToIndex(square) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
  const rank = 8 - parseInt(square[1], 10); // 0..7
  return { file, rank, index: rank * 8 + file };
}

function indexToAlgebraic(i) {
  const file = i % 8;
  const rank = Math.floor(i / 8);
  const a = String.fromCharCode('a'.charCodeAt(0) + file);
  const r = 8 - rank;
  return `${a}${r}`;
}

// Build board squares
function initBoard() {
  boardEl.innerHTML = '';
  squares = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const i = r * 8 + f;
      const sq = document.createElement('div');
      sq.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
      sq.dataset.index = i;
      boardEl.appendChild(sq);
      squares.push(sq);
    }
  }
}

function clearHighlights() {
  squares.forEach(sq => {
    sq.classList.remove('highlight-select', 'highlight-move');
  });
}

function renderBoard() {
  // Clear existing pieces
  squares.forEach(sq => sq.innerHTML = '');

  const board = chess.board(); // 8x8 matrix
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece) {
        const el = document.createElement('div');
        el.className = 'piece';
        el.textContent = PIECES[piece.color][piece.type];
        // place centered in square
        el.style.transform = 'translate(0, 0)';
        squares[r * 8 + f].appendChild(el);
      }
    }
  }
  applyLastMoveHighlight();
}

function applyLastMoveHighlight() {
  clearHighlights();
  if (!lastMove) return;
  const fromI = algebraicToIndex(lastMove.from).index;
  const toI = algebraicToIndex(lastMove.to).index;
  squares[fromI].classList.add('highlight-select');
  squares[toI].classList.add('highlight-move');
}

function animateMove(from, to) {
  const { index: fromI } = algebraicToIndex(from);
  const { index: toI } = algebraicToIndex(to);

  const fromSq = squares[fromI];
  const toSq = squares[toI];

  const pieceEl = fromSq.querySelector('.piece');
  if (!pieceEl) return;

  const fromRect = fromSq.getBoundingClientRect();
  const toRect = toSq.getBoundingClientRect();

  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;

  animating = true;
  pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
  setTimeout(() => {
    animating = false;
    renderBoard();
  }, 170);
}

function updateStatusBar() {
  const t = chess.turn();
  turnEl.textContent = `手番: ${t === 'w' ? '白' : '黒'}`;
  if (lastMove) {
    lastMoveEl.textContent = `前手: ${lastMove.from} → ${lastMove.to} (${lastMove.san || '-'})`;
  } else {
    lastMoveEl.textContent = '前手: -';
  }
}

function setRoleLabel() {
  if (!myColor) {
    roleEl.textContent = '未参加';
  } else {
    roleEl.textContent = `あなたは${myColor === 'w' ? '白' : '黒'}`;
  }
}

function legalMovesFrom(square) {
  return chess.moves({ square, verbose: true }).map(m => m.to);
}

function orientIndex(i) {
  // If you're black, flip the board indexing
  if (myColor === 'b') {
    const rank = Math.floor(i / 8);
    const file = i % 8;
    const flipRank = 7 - rank;
    const flipFile = 7 - file;
    return flipRank * 8 + flipFile;
  }
  return i;
}

function squareClickHandler(e) {
  if (!gameId || animating) return;
  if (chess.turn() !== myColor) return; // not your turn

  const i = parseInt(e.currentTarget.dataset.index, 10);
  // Adjust algebraic by orientation for black POV
  const baseAlg = indexToAlgebraic(i);
  const alg = myColor === 'b' ? indexToAlgebraic(orientIndex(i)) : baseAlg;

  const pieceAt = chess.get(alg);

  // Select or move
  if (!selected) {
    // must select your own piece
    if (pieceAt && pieceAt.color === myColor) {
      selected = alg;
      clearHighlights();
      const { index: selI } = algebraicToIndex(selected);
      squares[myColor === 'b' ? orientIndex(selI) : selI].classList.add('highlight-select');
      const moves = legalMovesFrom(selected);
      moves.forEach(to => {
        const { index: toI } = algebraicToIndex(to);
        squares[myColor === 'b' ? orientIndex(toI) : toI].classList.add('highlight-move');
      });
    }
  } else {
    // attempt move from selected -> alg (as destination)
    const dest = alg;
    const move = chess.move({ from: selected, to: dest, promotion: 'q' });
    if (move) {
      // Locally animate from selected to dest based on current (pre-move) board
      animateMove(selected, dest);
      lastMove = { from: selected, to: dest, san: move.san };
      updateStatusBar();
      clearHighlights();
      selected = null;

      // Send to server (source of truth)
      socket.emit('game:move', { gameId, from: move.from, to: move.to, promotion: move.promotion });
    } else {
      // illegal, reset selection if clicked own piece
      const clickedOwn = pieceAt && pieceAt.color === myColor;
      clearHighlights();
      selected = clickedOwn ? alg : null;
      if (selected) {
        const { index: selI } = algebraicToIndex(selected);
        squares[myColor === 'b' ? orientIndex(selI) : selI].classList.add('highlight-select');
        const moves = legalMovesFrom(selected);
        moves.forEach(to => {
          const { index: toI } = algebraicToIndex(to);
          squares[myColor === 'b' ? orientIndex(toI) : toI].classList.add('highlight-move');
        });
      }
    }
  }
}

// Attach handlers to squares after init
function bindSquareHandlers() {
  squares.forEach(sq => {
    sq.addEventListener('click', squareClickHandler);
  });
}

// Socket events
socket.on('lobby:connected', () => {
  statusEl.textContent = '待機中';
});

socket.on('lobby:waiting', () => {
  statusEl.textContent = 'マッチング中...';
});

socket.on('game:start', ({ gameId: gid, fen, turn, colors }) => {
  gameId = gid;
  chess = new Chess(fen);
  myColor = colors[socket.id];
  gameIdEl.textContent = gid;
  myColorEl.textContent = myColor === 'w' ? '白' : '黒';
  statusEl.textContent = '対局中';
  setRoleLabel();
  renderBoard();
  updateStatusBar();
});

socket.on('game:update', ({ fen, turn, lastMove: lm, status, winner, suddenDeath }) => {
  // Server is source of truth; sync position
  const prev = chess ? chess.fen() : null;
  chess = new Chess(fen);
  lastMove = lm || lastMove;
  updateStatusBar();

  if (lm && prev) {
    animateMove(lm.from, lm.to);
  } else {
    renderBoard();
  }

  if (status === 'ended') {
    statusEl.textContent = suddenDeath ? '終了（クイーンが取られました）' : '終了';
    const youWin = (winner === myColor);
    if (winner === 'draw') {
      turnEl.innerHTML = '<span class="draw">引き分け</span>';
    } else {
      turnEl.innerHTML = youWin ? '<span class="win">あなたの勝ち！</span>' : '<span class="lose">あなたの負け</span>';
    }
  } else {
    statusEl.textContent = '対局中';
  }
});

socket.on('game:error', ({ message }) => {
  // brief toast via status label
  statusEl.textContent = `エラー: ${message}`;
  setTimeout(() => {
    statusEl.textContent = gameId ? '対局中' : '待機中';
  }, 900);
});

// UI actions
findBtn.addEventListener('click', () => {
  socket.emit('lobby:findMatch');
});

// Initialize
initBoard();
bindSquareHandlers();
renderBoard();
updateStatusBar();
setRoleLabel();
