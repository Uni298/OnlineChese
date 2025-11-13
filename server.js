const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// ゲームの状態を管理
const games = new Map();
const waitingPlayers = [];

// チェスの初期設定
const initialBoard = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
];

io.on('connection', (socket) => {
  console.log('ユーザーが接続しました:', socket.id);

  // マッチメイキング
  if (waitingPlayers.length > 0) {
    const player1 = waitingPlayers.pop();
    const player2 = socket.id;
    
    const gameId = `game_${Date.now()}`;
    const game = {
      id: gameId,
      players: [player1, player2],
      board: JSON.parse(JSON.stringify(initialBoard)),
      currentPlayer: 'white', // whiteが先手
      moves: []
    };
    
    games.set(gameId, game);
    
    // 両プレイヤーにゲーム開始を通知
    io.to(player1).emit('gameStart', { 
      gameId, 
      color: 'white',
      board: game.board 
    });
    io.to(player2).emit('gameStart', { 
      gameId, 
      color: 'black',
      board: game.board 
    });
    
    console.log(`ゲーム開始: ${gameId}`);
  } else {
    waitingPlayers.push(socket.id);
    socket.emit('waiting', { message: '対戦相手を待っています...' });
  }

  // 駒の移動
  socket.on('move', (data) => {
    const { gameId, from, to } = data;
    const game = games.get(gameId);
    
    if (!game || !game.players.includes(socket.id)) return;
    
    // 現在のプレイヤーを確認
    const playerColor = game.players[0] === socket.id ? 'white' : 'black';
    if (playerColor !== game.currentPlayer) return;

    // 駒の移動を実行
let piece = game.board[from.row][from.col];

// ポーンのプロモーションをチェック
if (piece.toLowerCase() === 'p') {
    const promotionRow = playerColor === 'white' ? 0 : 7;
    if (to.row === promotionRow) {
        // クイーンに自動で昇格
        piece = playerColor === 'white' ? 'Q' : 'q';
    }
}

game.board[from.row][from.col] = '';
game.board[to.row][to.col] = piece;
    
    // 移動履歴を保存
    game.moves.push({ from, to, piece });
    
    // Kingが取られたかチェック
    let whiteQueenExists = false;
    let blackQueenExists = false;
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (game.board[row][col] === 'K') whiteQueenExists = true;
        if (game.board[row][col] === 'k') blackQueenExists = true;
      }
    }
    
    // ターンを交代
    game.currentPlayer = game.currentPlayer === 'white' ? 'black' : 'white';
    
    // 全プレイヤーに更新を通知
    game.players.forEach(playerId => {
      io.to(playerId).emit('boardUpdate', {
        board: game.board,
        currentPlayer: game.currentPlayer,
        lastMove: { from, to },
        gameOver: !whiteQueenExists || !blackQueenExists,
        winner: !whiteQueenExists ? 'black' : (!blackQueenExists ? 'white' : null)
      });
    });
  });

  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました:', socket.id);
    
    // 待機リストから削除
    const waitingIndex = waitingPlayers.indexOf(socket.id);
    if (waitingIndex > -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // ゲームから削除
    for (let [gameId, game] of games) {
      if (game.players.includes(socket.id)) {
        const opponent = game.players.find(id => id !== socket.id);
        if (opponent) {
          io.to(opponent).emit('opponentDisconnected');
        }
        games.delete(gameId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
});
