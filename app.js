/* ---- Chess state & minimal rules ---- */
const files = ['a','b','c','d','e','f','g','h'];
const ranks = ['8','7','6','5','4','3','2','1'];
const boardEl = document.getElementById('board');
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const youEl = document.getElementById('you');
const gasUrlEl = document.getElementById('gasUrl');
const btnMatch = document.getElementById('btnMatch');

const PIECES = {
  'P': '♙','N': '♘','B': '♗','R':'♖','Q':'♕','K':'♔',
  'p': '♟','n': '♞','b':'♝','r':'♜','q':'♛','k':'♚'
};

let squares = {}; // map "a1" -> {el, piece}
let state = {
  turn: 'w',
  you: null, // 'w' or 'b'
  id: null, // GAS側の自分ID
  partnerId: null,
  board: initialBoard(),
};
let lastTouched = null; // 直近に触ったマス（自分操作）
let lastOpponentMove = null; // 相手の手

function initialBoard() {
  const b = {};
  for (let f of files) { b[f+'2'] = 'P'; b[f+'7'] = 'p'; }
  b['a1']='R'; b['h1']='R'; b['a8']='r'; b['h8']='r';
  b['b1']='N'; b['g1']='N'; b['b8']='n'; b['g8']='n';
  b['c1']='B'; b['f1']='B'; b['c8']='b'; b['f8']='b';
  b['d1']='Q'; b['e1']='K'; b['d8']='q'; b['e8']='k';
  return b;
}

function render() {
  boardEl.innerHTML = '';
  squares = {};
  ranks.forEach((r, ri) => {
    files.forEach((f, fi) => {
      const sq = f + r;
      const el = document.createElement('div');
      el.className = 'sq ' + (((ri+fi)%2===0)?'light':'dark');
      el.dataset.sq = sq;
      el.textContent = state.board[sq] ? PIECES[state.board[sq]] : '';
      boardEl.appendChild(el);
      squares[sq] = { el, piece: state.board[sq] || null };
    });
  });
}
render();

function pieceColor(pc) { return pc ? (pc === pc.toUpperCase() ? 'w' : 'b') : null; }
function inBounds(fileIndex, rankIndex) { return fileIndex>=0 && fileIndex<8 && rankIndex>=0 && rankIndex<8; }
function sqAt(fi, ri) { return files[fi] + ranks[ri]; }

function legalMoves(from) {
  const pc = state.board[from];
  if (!pc) return [];
  const color = pieceColor(pc);
  const fi = files.indexOf(from[0]);
  const ri = ranks.indexOf(from[1]);
  const moves = [];
  const add = (fi2, ri2) => {
    if (!inBounds(fi2, ri2)) return;
    const to = sqAt(fi2, ri2);
    const occ = state.board[to];
    if (!occ || pieceColor(occ) !== color) moves.push(to);
  };
  switch (pc.toLowerCase()) {
    case 'p': {
      const dir = color==='w' ? -1 : 1;
      const fwd = sqAt(fi, ri+dir);
      if (inBounds(fi, ri+dir) && !state.board[fwd]) moves.push(fwd);
      if ((color==='w' && from[1]==='2') || (color==='b' && from[1]==='7')) {
        const mid = sqAt(fi, ri+dir);
        const dbl = sqAt(fi, ri+2*dir);
        if (!state.board[mid] && !state.board[dbl]) moves.push(dbl);
      }
      for (let df of [-1,1]) {
        const fi2 = fi+df, ri2 = ri+dir;
        if (!inBounds(fi2, ri2)) continue;
        const to = sqAt(fi2, ri2);
        const occ = state.board[to];
        if (occ && pieceColor(occ) !== color) moves.push(to);
      }
      break;
    }
    case 'n': {
      const deltas = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
      for (let [df,dr] of deltas) add(fi+df, ri+dr);
      break;
    }
    case 'b': lineMoves(fi,ri,[[1,1],[1,-1],[-1,1],[-1,-1]], moves, color); break;
    case 'r': lineMoves(fi,ri,[[1,0],[-1,0],[0,1],[0,-1]], moves, color); break;
    case 'q': lineMoves(fi,ri,[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]], moves, color); break;
    case 'k': {
      const deltas = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      for (let [df,dr] of deltas) add(fi+df, ri+dr);
      break;
    }
  }
  return moves;
}

function lineMoves(fi,ri,dirs,out,color) {
  for (let [df,dr] of dirs) {
    let f=fi+df, r=ri+dr;
    while (inBounds(f,r)) {
      const to = sqAt(f,r);
      const occ = state.board[to];
      if (!occ) out.push(to);
      else { if (pieceColor(occ)!==color) out.push(to); break; }
      f+=df; r+=dr;
    }
  }
}

/* ---- Interaction ---- */
let selected = null;
let moves = [];

function clearSel() {
  Object.values(squares).forEach(s=>{
    s.el.classList.remove('sel','move','pulse','flash');
  });
}

boardEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.sq');
  if (!cell) return;
  const sq = cell.dataset.sq;

  // your turn guard
  if (!state.you || state.turn !== state.you) return;

  // select/deselect
  if (selected === sq) { selected = null; moves = []; clearSel(); return; }

  // if clicking a move
  if (moves.includes(sq)) {
    const from = selected, to = sq;
    performMove(from, to, true);
    selected = null; moves = []; clearSel();
    return;
  }

  // select own piece
  const pc = state.board[sq];
  if (!pc || pieceColor(pc) !== state.you) return;
  selected = sq; moves = legalMoves(sq);
  clearSel();
  squares[sq].el.classList.add('sel','pulse'); // 触った駒を強調
  moves.forEach(m=> squares[m].el.classList.add('move'));
});

function performMove(from, to, broadcast=false) {
  const pc = state.board[from];
  if (!pc) return;
  const isPawn = pc.toLowerCase()==='p';
  const lastRank = (pieceColor(pc)==='w') ? '8' : '1';

  // アニメーション前のUI（ゴースト作成用に座標取得）
  const fromEl = squares[from].el;
  const toEl = squares[to].el;
  const rectFrom = fromEl.getBoundingClientRect();
  const rectTo = toEl.getBoundingClientRect();

  // 実盤更新
  delete state.board[from];
  state.board[to] = (isPawn && to[1]===lastRank) ? (pieceColor(pc)==='w'?'Q':'q') : pc;
  state.turn = (state.turn==='w'?'b':'w');
  render();

  // ゴーストで滑らか移動（視認性Up）
  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  ghost.textContent = PIECES[pc];
  ghost.style.left = rectFrom.left + 'px';
  ghost.style.top = rectFrom.top + 'px';
  ghost.style.fontSize = fromEl.style.fontSize || '58px';
  document.body.appendChild(ghost);

  const dx = rectTo.left - rectFrom.left;
  const dy = rectTo.top - rectFrom.top;
  let t = 0;
  function step() {
    t += 0.06;
    ghost.style.left = (rectFrom.left + dx * t) + 'px';
    ghost.style.top  = (rectFrom.top  + dy * t) + 'px';
    if (t < 1) requestAnimationFrame(step);
    else {
      document.body.removeChild(ghost);
      // 終端でフラッシュ
      squares[to].el.classList.add('flash');
      setTimeout(()=> squares[to].el.classList.remove('flash'), 600);
    }
  }
  step();

  // 自分の手（触った駒）をログ
  lastTouched = { from, to };
  log(`${from} → ${to}`);

  if (broadcast) sendMove({from,to});
}

/* ---- Log ---- */
function log(msg) {
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.textContent = `[${time}] ${msg}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

/* ---- WebRTC + GAS random match ---- */
const pc = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});
let dc = null;
pc.onconnectionstatechange = () => {
  statusEl.textContent = `接続状態: ${pc.connectionState}`;
};
pc.onicecandidate = () => {
  // ICE候補収集中にSDPが更新されるため、必要に応じて再送もあり
};
pc.ondatachannel = (ev) => {
  dc = ev.channel;
  setDataHandlers();
};

function setDataHandlers() {
  if (!dc) return;
  dc.onopen = () => { statusEl.textContent = '接続完了（データチャネル）'; };
  dc.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'move') {
      // 相手の手を適用＋ハイライト
      const { from, to } = msg.payload;
      performMove(from, to, false);
      squares[from]?.el.classList.add('flash');
      squares[to]?.el.classList.add('flash');
      setTimeout(()=>{
        squares[from]?.el.classList.remove('flash');
        squares[to]?.el.classList.remove('flash');
      }, 800);
      lastOpponentMove = { from, to };
    } else if (msg.type === 'role') {
      state.you = msg.payload.opposite;
      youEl.textContent = state.you==='w'?'白':'黒';
      log(`相手と同期: あなたは ${youEl.textContent}`);
    }
  };
}

function sendMove(m) {
  if (dc && dc.readyState==='open') {
    dc.send(JSON.stringify({type:'move', payload:m}));
  }
}

function sendRole(opposite) {
  if (dc && dc.readyState==='open') {
    dc.send(JSON.stringify({type:'role', payload:{opposite}}));
  }
}

/* ---- Compression helpers ---- */
function compressText(str) {
  const enc = new TextEncoder().encode(str);
  const compressed = pako.deflate(enc);
  return btoa(String.fromCharCode(...compressed));
}
function decompressText(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dec = pako.inflate(bin);
  return new TextDecoder().decode(dec);
}

/* ---- Random match flow ---- */
let pollTimer = null;

btnMatch.onclick = async () => {
  const gasUrl = gasUrlEl.value.trim();
  if (!gasUrl) { alert('GAS WebアプリURLを入力してください'); return; }

  // 自分が白側（待機者）の可能性があるので、まずオファー生成
  dc = pc.createDataChannel('moves');
  setDataHandlers();

  await pc.setLocalDescription(await pc.createOffer());
  const offerSdpB64 = compressText(pc.localDescription.sdp);

  const joinRes = await api(gasUrl, { action: "join", sdp: offerSdpB64, type: "offer" });

  if (!joinRes) { alert('GAS応答エラー'); return; }

  state.id = joinRes.id;
  if (joinRes.matched) {
    // 相手のofferをもらって黒で参加
    state.you = 'b';
    youEl.textContent = '黒';
    statusEl.textContent = '相手とマッチングしました。接続準備中…';
    const remoteOffer = decompressText(joinRes.partner.sdp);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: remoteOffer }));
    await pc.setLocalDescription(await pc.createAnswer());
    const answerB64 = compressText(pc.localDescription.sdp);
    await api(gasUrl, { action: "answer", id: state.id, sdp: answerB64 });
    statusEl.textContent = 'アンサー送信済み。接続待機…';
    // ロール同期（片側送信で十分）
    const syncInterval = setInterval(() => {
      if (dc && dc.readyState==='open') {
        sendRole('w'); // 相手は白、あなたは黒
        clearInterval(syncInterval);
      }
    }, 500);
  } else {
    // 待機者（白）
    state.you = 'w';
    youEl.textContent = '白';
    statusEl.textContent = '待機中… 相手が来ると自動で接続します。';

    // 相手が来て自分の行に answer が書かれるのをポーリング
    pollTimer = setInterval(async () => {
      const p = await api(gasUrl, { action: "poll", id: state.id });
      if (!p) return;
      if (p.type === "answer" && p.sdp) {
        clearInterval(pollTimer);
        const remoteAnswer = decompressText(p.sdp);
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: remoteAnswer }));
        statusEl.textContent = '接続確立を待機中…';
        const syncInterval = setInterval(() => {
          if (dc && dc.readyState==='open') {
            sendRole('b'); // 相手は黒、あなたは白
            clearInterval(syncInterval);
          }
        }, 500);
      }
    }, 1000);
  }
};

/* ---- GAS API helper ---- */
async function api(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}
