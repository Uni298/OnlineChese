// server.js
// Node.js server for Render: Express + PeerJS signaling + simple random matchmaking

const express = require('express');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = require('http').createServer(app);

// PeerJS signaling server
const peerServer = ExpressPeerServer(server, {
  path: '/peer',
  proxied: true,
});
app.use('/peerjs', peerServer);

// In-memory matchmaking queue
let waitingPeerId = null;

// Register yourself in the matchmaking queue
app.post('/match/register', (req, res) => {
  const { peerId } = req.body;
  if (!peerId) return res.status(400).json({ error: 'peerId required' });

  if (!waitingPeerId) {
    waitingPeerId = peerId;
    return res.json({ status: 'waiting' });
  }

  if (waitingPeerId === peerId) {
    return res.json({ status: 'waiting' });
  }

  // Pair found
  const opponentId = waitingPeerId;
  waitingPeerId = null;
  return res.json({ status: 'paired', opponentId });
});

// Poll to see if someone paired with you
app.post('/match/check', (req, res) => {
  const { peerId } = req.body;
  if (!peerId) return res.status(400).json({ error: 'peerId required' });

  // If there is someone waiting (not you), pair you now
  if (waitingPeerId && waitingPeerId !== peerId) {
    const opponentId = waitingPeerId;
    waitingPeerId = null;
    return res.json({ status: 'paired', opponentId });
  }

  return res.json({ status: 'waiting' });
});

// Health check
app.get('/', (_req, res) => {
  res.send('P2P Chess server is running.');
});

// Render uses PORT env
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
