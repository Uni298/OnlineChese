// app.js
// 必須: ここに先ほどデプロイした GAS の公開 URL を入れてください
const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbyc_A1CaKnGeD0tpeFYBs_oWVkqW-M8dMkZFIB2HIjzbmZoVD3KkMH12fO7-ADPHxhIvw/exec"; // <<--- ここを書き換える

// ----- シンプルなチェス盤・ルール（クイーン取られたら敗北） -----
// 駒は Unicode で表示（画像不要）
const PIECES = {
  pw: '♙', rw: '♖', nw: '♘', bw:'♗', qw:'♕', kw:'♔',
  pb: '♟', rb: '♜', nb: '♞', bb:'♝', qb:'♛', kb:'♚'
};

// 初期配置（簡易配列 -- white bottom）
const START_FEN = [
  ['rb','nb','bb','qb','kb','bb','nb','rb'],
  ['pb','pb','pb','pb','pb','pb','pb','pb'],
  ['','','','','','','',''],
  ['','','','','','','',''],
  ['','','','','','','',''],
  ['','','','','','','',''],
  ['pw','pw','pw','pw','pw','pw','pw','pw'],
  ['rw','nw','bw','qw','kw','bw','nw','rw']
];

// DOM refs
const boardEl = document.getElementById('board');
const logEl = document.getElementById('log');
const statusText = document.getElementById('statusText');
const turnText = document.getElementById('turnText');
const peerInfo = document.getElementById('peerInfo');
const btnFind = document.getElementById('btnFind');

let boardState = []; // 8x8 strings like 'pw','qb', or ''
let pieceEls = {}; // mapping pos 'e4' -> element
let selected = null;
let legalMoves = [];
let myColor = null; // 'w' or 'b'
let myTurn = false;
let pc = null;
let dataChannel = null;
let currentPairId = null;
let mySessionId = null;
let remoteMeta = null;

function coordToIndex(x,y){ return {r:y, c:x}; }
function idxToPos(r,c){
  const files = ['a','b','c','d','e','f','g','h'];
  return files[c] + (8 - r);
}
function posToRC(pos){
  const files = {'a':0,'b':1,'c':2,'d':3,'e':4,'f':5,'g':6,'h':7};
  return {r:8 - parseInt(pos[1]), c: files[pos[0]]};
}

function initBoardFromStart(){
  boardState = JSON.parse(JSON.stringify(START_FEN));
  renderBoard();
  log("ボード初期化");
  turnText.innerText = '—';
  statusText.innerText = '準備';
}

function renderBoard(){
  boardEl.innerHTML = '';
  pieceEls = {};
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const sq = document.createElement('div');
      sq.className = 'square ' + (((r+c)%2===0) ? 'light' : 'dark');
      sq.dataset.r = r; sq.dataset.c = c;
      const pos = idxToPos(r,c);
      sq.dataset.pos = pos;
      sq.addEventListener('click', onSquareClick);
      boardEl.appendChild(sq);

      const piece = boardState[r][c];
      if (piece){
        const p = document.createElement('div');
        p.className = 'piece';
        p.innerText = PIECES[piece];
        p.dataset.piece = piece;
        p.dataset.pos = pos;
        // position via absolute transform
        const size = boardEl.clientWidth / 8;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        // compute initial coordinates
        const left = (c * size);
        const top = (r * size);
        p.style.transform = `translate(${left}px, ${top}px)`;
        p.style.left = '0'; p.style.top = '0';
        p.style.position = 'absolute';
        p.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          onPieceClick(p);
        });
        boardEl.appendChild(p);
        pieceEls[pos] = p;
      }
    }
  }
}

// ----- 簡易ムーブ生成（全ルールは未実装） -----
// ポーン（前進1, 2初回, 斜め取る）/ ナイト / ビショップ/ ルーク/ クイーン/ キング（隣1）
// チェックの概念は無く、キングが取られても特別扱いなし。勝利は「相手のクイーンが取られた」だけ判定。
function isInside(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
function pieceColor(piece){ return piece ? piece[1] : null; }
function generateMovesFor(pos){
  // pos like 'e2'
  const rc = posToRC(pos);
  const r = rc.r, c = rc.c;
  const piece = boardState[r][c];
  if(!piece) return [];
  const color = piece[1]; // 'w' or 'b'
  const moves = [];
  const dir = (color==='w') ? -1 : 1;

  const addIf = (rr,cc) => {
    if(!isInside(rr,cc)) return;
    const target = boardState[rr][cc];
    if(!target || pieceColor(target)!==color) moves.push(idxToPos(rr,cc));
  };

  const type = piece[0];
  if(type==='p'){ // pawn
    const oneR = r + dir;
    if(isInside(oneR,c) && !boardState[oneR][c]) {
      moves.push(idxToPos(oneR,c));
      // start double
      if ((color==='w' && r===6) || (color==='b' && r===1)){
        const twoR = r + dir*2;
        if(isInside(twoR,c) && !boardState[twoR][c]) moves.push(idxToPos(twoR,c));
      }
    }
    // captures
    for(const dc of [-1,1]){
      const rr = r + dir, cc = c + dc;
      if(isInside(rr,cc) && boardState[rr][cc] && pieceColor(boardState[rr][cc])!==color){
        moves.push(idxToPos(rr,cc));
      }
    }
  } else if(type==='n'){ // knight
    const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for(const d of deltas) addIf(r+d[0], c+d[1]);
  } else if(type==='b' || type==='r' || type==='q'){
    const dirs = [];
    if(type==='b' || type==='q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
    if(type==='r' || type==='q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
    for(const d of dirs){
      let rr = r + d[0], cc = c + d[1];
      while(isInside(rr,cc)){
        if(!boardState[rr][cc]) { moves.push(idxToPos(rr,cc)); rr+=d[0]; cc+=d[1]; continue;}
        if(pieceColor(boardState[rr][cc])!==color) moves.push(idxToPos(rr,cc));
        break;
      }
    }
  } else if(type==='k'){
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(dr===0 && dc===0) continue;
      addIf(r+dr,c+dc);
    }
  }
  return moves;
}

// ----- UI interaction -----
function onPieceClick(el){
  const piece = el.dataset.piece;
  const pos = el.dataset.pos;
  if(!myTurn) return;
  if(!piece) return;
  if(piece[1] !== myColor) return; // not our piece
  selected = pos;
  clearHighlights();
  legalMoves = generateMovesFor(pos);
  highlightMoves(legalMoves);
}
function onSquareClick(ev){
  const sq = ev.currentTarget;
  const pos = sq.dataset.pos;
  if(selected){
    if(legalMoves.includes(pos)){
      attemptMove(selected, pos);
      selected = null;
      clearHighlights();
    } else {
      selected = null;
      clearHighlights();
    }
  }
}

function highlightMoves(moves){
  for(const m of moves){
    const el = findSquareEl(m);
    if(el) el.classList.add('legal');
  }
}
function clearHighlights(){
  document.querySelectorAll('.square.legal').forEach(s=>s.classList.remove('legal'));
}

function findSquareEl(pos){
  return document.querySelector(`.square[data-pos="${pos}"]`);
}
function findPieceEl(pos){
  return pieceEls[pos] || null;
}

function attemptMove(from, to){
  // local validation already performed; perform move locally, animate, then send to peer
  const fr = posToRC(from).r, fc = posToRC(from).c;
  const tr = posToRC(to).r, tc = posToRC(to).c;
  const moving = boardState[fr][fc];
  const captured = boardState[tr][tc];
  // execute
  boardState[tr][tc] = moving;
  boardState[fr][fc] = '';
  animateMove(from, to, () => {
    // update mapping
    const el = pieceEls[from];
    delete pieceEls[from];
    if(el){
      el.dataset.pos = to;
      pieceEls[to] = el;
    }
    // if captured remove element
    if(captured){
      const capEl = findPieceEl(to);
      if(capEl && capEl !== el) capEl.remove();
    }
    // turn toggle
    myTurn = false;
    updateTurnUI();
    log(`あなた: ${from} → ${to}`);
    // send to peer
    sendMessage({t:'move', from, to, piece:moving, captured});
    checkQueenCapture(captured, 'you');
  });
}

function animateMove(from, to, cb){
  const el = findPieceEl(from);
  if(!el){ cb(); return; }
  const size = boardEl.clientWidth / 8;
  const rcFrom = posToRC(from), rcTo = posToRC(to);
  const left = rcTo.c * size, top = rcTo.r * size;
  // transition via transform
  el.style.transition = 'transform 420ms cubic-bezier(.2,.8,.2,1)';
  requestAnimationFrame(()=>{
    el.style.transform = `translate(${left}px, ${top}px)`;
  });
  setTimeout(()=>{
    el.style.transition = '';
    cb();
  }, 430);
}

function applyRemoteMove(from,to,piece,captured){
  // update state and animate piece from remote
  const fr = posToRC(from).r, fc = posToRC(from).c;
  const tr = posToRC(to).r, tc = posToRC(to).c;
  boardState[tr][tc] = piece;
  boardState[fr][fc] = '';
  // move element (if present)
  const el = pieceEls[from];
  if(el){
    delete pieceEls[from];
    el.dataset.pos = to;
    pieceEls[to] = el;
    animateMove(from,to, ()=>{
      log(`相手: ${from} → ${to}`);
      if(captured){
        const cap = findPieceEl(to);
        if(cap && cap !== el) cap.remove();
      }
    });
  } else {
    // fallback: re-render
    renderBoard();
  }
  myTurn = true;
  updateTurnUI();
  checkQueenCapture(captured, 'opponent');
}

function checkQueenCapture(captured, by){
  if(captured && captured[0]==='q'){
    if(by==='you'){
      alert('あなたが相手のクイーンを取ったため、あなたの勝ちです！');
      statusText.innerText = '勝ち（クイーン捕獲）';
    } else {
      alert('あなたのクイーンが取られました。あなたの負けです。');
      statusText.innerText = '負け（クイーン捕獲）';
    }
    sendMessage({t:'gameOver', who: by});
  }
}

function log(s){
  const d = document.createElement('div');
  d.innerText = `[${new Date().toLocaleTimeString()}] ${s}`;
  logEl.prepend(d);
}

// ----- WebRTC & GAS シグナリング（簡易） -----
async function createPeerConnection(isInitiator){
  pc = new RTCPeerConnection();
  // data channel
  if(isInitiator){
    dataChannel = pc.createDataChannel('moves');
    setupDataChannel();
  } else {
    pc.ondatachannel = (e)=>{
      dataChannel = e.channel;
      setupDataChannel();
    };
  }

  // gather ICE finished? we rely on full SDP after gathering finished
  // listen for connection state
  pc.onconnectionstatechange = ()=> {
    log('PC state: ' + pc.connectionState);
    statusText.innerText = '接続: ' + pc.connectionState;
  };
  pc.onicecandidateerror = (e)=>console.warn(e);

}

function setupDataChannel(){
  dataChannel.onopen = ()=> {
    log('DataChannel open');
    statusText.innerText = '接続済み';
    peerInfo.innerText = `対戦相手: ${remoteMeta ? (remoteMeta.name||'相手') : '相手'}`;
  };
  dataChannel.onmessage = (ev)=>{
    try {
      const msg = JSON.parse(ev.data);
      if(msg.t==='move'){
        applyRemoteMove(msg.from, msg.to, msg.piece, msg.captured);
      } else if(msg.t==='meta'){
        remoteMeta = msg.meta;
        peerInfo.innerText = `対戦相手: ${remoteMeta.name || '相手'}`;
      } else if(msg.t==='gameOver'){
        log('ゲーム終了: ' + msg.who);
      }
    } catch(e){
      console.error(e);
    }
  };
}

async function gatherLocalSDPAndWaitForIce(pc){
  // createOffer/setLocalDescription should be done by caller.
  // Wait for iceGatheringState === 'complete'
  if (pc.iceGatheringState === 'complete') return pc.localDescription.sdp;
  await new Promise((res) => {
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        res();
      }
    }
    pc.addEventListener('icegatheringstatechange', check);
    // safety timeout
    setTimeout(()=>res(), 8000);
  });
  return pc.localDescription.sdp;
}

// GAS helper functions
async function postToGAS(obj){
  const res = await fetch(GAS_WEBAPP_URL, {
    method:'POST',
    mode:'cors',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(obj)
  });
  return res.json();
}

async function findRandomMatch(){
  statusText.innerText = 'マッチ探し中...';
  log('ランダムマッチを探します...');
  // create local metadata
  const meta = {name: '匿名_' + Math.floor(Math.random()*1000), ts: Date.now()};
  // act as initiator: create offer, post as waiting
  await createPeerConnection(true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // wait ice gather
  const fullSDP = await gatherLocalSDPAndWaitForIce(pc);
  // post to GAS
  const post = await postToGAS({action:'createOffer', offer: fullSDP, meta});
  mySessionId = post.id;
  // now poll for waiting slot taken by someone else
  statusText.innerText = '待機中（相手が参加するのを待機）';
  log('待機作成: ' + mySessionId);
  // Poll loop to check if someone claimed our waiting (GAS will remove waiting and create pair)
  const pol = setInterval(async ()=>{
    try {
      // check waiting (we want to see if someone claimed it by being removed from waiting and registering pair)
      const chk = await postToGAS({action:'checkWaiting', skipId: null});
      // If returned found and it's our session id means still waiting; otherwise check around: try to find pair by polling known pairs is hard.
      // Simpler approach: second player will claim waiting and create a pair; so we will poll for pairs by attempting to get pair id? But client doesn't know pair id.
      // Workaround: we instead let joiner call claimSession which returns pairId and then both clients will poll for it. To inform initiator, joiner will POST answer to pairId and initiator polls pairId.
      // So we need to poll by pairId — but initiator doesn't know pairId. Modify flow: when joiner claims, GAS will store pair under pairId and delete waiting; initiator must poll globally? Simpler: initiator will poll every few seconds to see if waiting no longer equals our session id -> then attempt to retrieve newest pair by scanning properties isn't possible.
      // Practical simpler flow: When joiner finds waiting, joiner will POST answer and then also call postToGAS({action:'postAnswer', pairId: pairId, answer: answer}) and initiator will instead poll pollAnswer by pairId. But initiator needs pairId. To get pairId, change flow: when joiner claims waiting, GAS returns pairId. But initiator didn't request it. So we implement: when joiner claims, they will set pairId into a shared property with key 'pair_for_' + waiting.id so initiator can poll that key. We'll rely on that key existing.
      // ========== Below: initiator polls for key "pair_for_<mySessionId>" ==========
      const info = await postToGAS({action:'getPair', pairId: 'pair_for_' + mySessionId});
      if(info && info.status==='ok' && info.pair && info.pair.answer){
        // we have the answer
        clearInterval(pol);
        const answerSDP = info.pair.answer;
        await pc.setRemoteDescription({type:'answer', sdp: answerSDP});
        log('リモートアンサーを受信して接続開始');
        statusText.innerText = '相手と接続中...';
        return;
      }
    } catch(e){ console.warn(e); }
  }, 1500);

  // As backup: after 60s, cancel
  setTimeout(()=>{ clearInterval(pol); }, 60000);
}

async function joinRandomMatch(){
  statusText.innerText = 'マッチ探索（join）...';
  // Poll to get waiting session
  const myself = {name: '匿名_' + Math.floor(Math.random()*1000)};
  let found = null;
  for(let i=0;i<40;i++){
    const res = await postToGAS({action:'checkWaiting', skipId: null});
    if(res.status==='found'){
      found = res.session; break;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  if(!found){
    statusText.innerText = '誰も見つかりませんでした。もう一度試してください。';
    return;
  }
  log('相手を発見: ' + found.id);
  // create pc as joiner
  await createPeerConnection(false);
  // set remote offer
  await pc.setRemoteDescription({type:'offer', sdp: found.offer});
  // create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  const fullSDP = await gatherLocalSDPAndWaitForIce(pc);
  // claim session (store pair)
  const claim = await postToGAS({action:'claimSession', answer: fullSDP, pairId: null});
  if(claim.status !== 'ok'){
    statusText.innerText = 'セッション取得に失敗しました';
    return;
  }
  const pairId = claim.pairId;
  // write a helper property so initiator can find pair: pair_for_<waiting.id> => {pair with answer}
  await postToGAS({action:'postAnswer', pairId: 'pair_for_' + found.id, answer: fullSDP});
  log('参加完了: pairId=' + pairId);
  // send our meta after data channel opens
  myColor = 'b'; myTurn = false; updateTurnUI();
  sendAfterChannelOpen({t:'meta', meta: myself});
}

function sendAfterChannelOpen(obj){
  const s = JSON.stringify(obj);
  if(dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(s);
  } else {
    const iv = setInterval(()=>{
      if(dataChannel && dataChannel.readyState === 'open'){
        clearInterval(iv);
        dataChannel.send(s);
      }
    },200);
  }
}

function sendMessage(obj){
  if(!dataChannel || dataChannel.readyState!=='open') {
    log('メッセージ送信失敗: 未接続');
    return;
  }
  dataChannel.send(JSON.stringify(obj));
}

// UI & button
btnFind.addEventListener('click', async ()=>{
  btnFind.disabled = true;
  btnFind.innerText = 'マッチング中...';
  // Try to find an existing waiting first -> if none, become initiator
  const res = await postToGAS({action:'checkWaiting'});
  if(res.status==='found'){
    // joiner flow
    await joinRandomMatch();
    btnFind.innerText = '接続完了';
    btnFind.disabled = false;
    myColor = 'b';
    myTurn = false;
    initBoardFromStart();
    updateTurnUI();
  } else {
    // initiator flow
    await findRandomMatch();
    btnFind.innerText = '接続待機中';
    btnFind.disabled = false;
    myColor = 'w';
    myTurn = true;
    initBoardFromStart();
    updateTurnUI();
  }
});

// helper to update UI whose turn
function updateTurnUI(){
  turnText.innerText = myTurn ? (myColor==='w' ? '白（あなた）' : '黒（あなた）') : (myColor==='w' ? '白（相手）' : '黒（相手）');
}

// when datachannel opens for initiator, send meta and set colors
function attachInitiatorMeta(){
  sendAfterChannelOpen({t:'meta', meta: {name:'匿名_init'}});
  myColor = 'w'; myTurn = true; updateTurnUI();
}

// Initialize
initBoardFromStart();

// Watch for connection & set initiator meta when DC opens
(function watchDC(){
  setInterval(()=>{
    if(dataChannel && dataChannel.readyState === 'open'){
      if(!remoteMeta) {
        // exchange meta
        sendAfterChannelOpen({t:'meta', meta: {name:'あなたの相手'}});
      }
      // if we are initiator and haven't set color, do so
      if(myColor === null){
        myColor = 'w';
        myTurn = true;
        updateTurnUI();
      }
    }
  }, 800);
})();
