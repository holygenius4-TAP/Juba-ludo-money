const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);

// ===== FIX FOR WHITE SCREEN =====
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// ================================

// Enable CORS for all origins
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// In-memory state storage (no database)
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`[Connected] Socket ID: ${socket.id}`);

  socket.on('createRoom', ({ entryFee, playerId }) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const parsedFee = Number(entryFee) || 0;
    const pot = parsedFee * 2;
    const commission = pot * 0.15;
    const winnerGets = pot - commission;
    const roomData = {
      roomId, entryFee: parsedFee, pot, commission, winnerGets,
      players: [{ socketId: socket.id, playerId, color: 'red' }],
      turnIndex: 0
    };
    rooms.set(roomId, roomData);
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`\n--- [Room Created: ${roomId}] ---`);
    console.log(`Entry Fee per player : $${parsedFee}`);
    console.log(`Total Pot : $${pot}`);
    console.log(`Commission (15%) : $${commission}`);
    console.log(`Winner Payout : $${winnerGets}`);
    socket.emit('roomCreated', { roomId, color: 'red', pot, winnerGets });
  });

  socket.on('joinRoom', ({ roomId, playerId }) => {
    const cleanRoomId = roomId ? roomId.trim().toUpperCase() : '';
    const room = rooms.get(cleanRoomId);
    if (!room) return socket.emit('error', { message: 'Room not found.' });
    if (room.players.length >= 2) return socket.emit('error', { message: 'Room is already full.' });
    room.players.push({ socketId: socket.id, playerId, color: 'green' });
    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;
    console.log(`[Player Joined] Player ${playerId} joined room ${cleanRoomId}`);
    socket.emit('roomJoined', { roomId: cleanRoomId, color: 'green', pot: room.pot, winnerGets: room.winnerGets });
    io.to(cleanRoomId).emit('gameStart', {
      roomId: cleanRoomId, pot: room.pot, winnerGets: room.winnerGets,
      players: room.players.map(p => ({ playerId: p.playerId, color: p.color })),
      currentTurn: room.players[room.turnIndex].color
    });
  });

  socket.on('rollDice', ({ roomId }) => {
    const activeRoomId = roomId || socket.roomId;
    const room = rooms.get(activeRoomId);
    if (!room) return socket.emit('error', { message: 'Active game not found.' });
    const currentPlayer = room.players[room.turnIndex];
    if (currentPlayer.socketId !== socket.id) return socket.emit('error', { message: "It is not your turn to roll!" });
    const diceValue = Math.floor(Math.random() * 6) + 1;
    console.log(`[Dice Roll] Room ${activeRoomId} | Player (${currentPlayer.color}): ${diceValue}`);
    io.to(activeRoomId).emit('diceResult', { player: currentPlayer.color, value: diceValue });
  });

  socket.on('moveToken', ({ tokenIndex }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const currentPlayer = room.players[room.turnIndex];
    socket.to(room.roomId).emit('playerMoved', { player: currentPlayer.color, tokenIndex });
  });

  socket.on('endTurn', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.turnIndex];
    io.to(room.roomId).emit('turnSwitched', { currentTurn: nextPlayer.color });
  });

  socket.on('disconnect', () => {
    console.log(`[Disconnected] Socket ID: ${socket.id}`);
    if (socket.roomId) {
      io.to(socket.roomId).emit('playerDisconnected', { message: 'Opponent disconnected.' });
      rooms.delete(socket.roomId);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`\n🚀 Juba Ludo live on ${PORT}`);
});