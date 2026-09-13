const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Enable CORS for all origins
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// In-memory state storage (no database)
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`[Connected] Socket ID: ${socket.id}`);

  /**
   * 1. CREATE ROOM
   * Payload: { entryFee: number, playerId: string }
   */
  socket.on('createRoom', ({ entryFee, playerId }) => {
    // Generate a simple 6-character unique room code
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const parsedFee = Number(entryFee) || 0;
    const pot = parsedFee * 2;
    const commission = pot * 0.15;
    const winnerGets = pot - commission;

    // Room state object
    const roomData = {
      roomId,
      entryFee: parsedFee,
      pot,
      commission,
      winnerGets,
      players: [
        { socketId: socket.id, playerId, color: 'red' }
      ],
      turnIndex: 0 // Index of player whose turn it is
    };

    rooms.set(roomId, roomData);
    socket.join(roomId);
    socket.roomId = roomId;

    console.log(`\n--- [Room Created: ${roomId}] ---`);
    console.log(`Entry Fee per player : $${parsedFee}`);
    console.log(`Total Pot            : $${pot}`);
    console.log(`Commission (15%)     : $${commission}`);
    console.log(`Winner Payout        : $${winnerGets}`);
    console.log(`---------------------------------\n`);

    // Acknowledge creation to the host player
    socket.emit('roomCreated', {
      roomId,
      color: 'red',
      pot,
      winnerGets
    });
  });

  /**
   * 2. JOIN ROOM
   * Payload: { roomId: string, playerId: string }
   */
  socket.on('joinRoom', ({ roomId, playerId }) => {
    const cleanRoomId = roomId ? roomId.trim().toUpperCase() : '';
    const room = rooms.get(cleanRoomId);

    if (!room) {
      return socket.emit('error', { message: 'Room not found.' });
    }

    if (room.players.length >= 2) {
      return socket.emit('error', { message: 'Room is already full.' });
    }

    // Add second player as Green
    room.players.push({ socketId: socket.id, playerId, color: 'green' });
    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;

    console.log(`[Player Joined] Player ${playerId} joined room ${cleanRoomId}`);

    // Notify second player of their assignment
    socket.emit('roomJoined', {
      roomId: cleanRoomId,
      color: 'green',
      pot: room.pot,
      winnerGets: room.winnerGets
    });

    // 3. START GAME - Both players are present
    io.to(cleanRoomId).emit('gameStart', {
      roomId: cleanRoomId,
      pot: room.pot,
      winnerGets: room.winnerGets,
      players: room.players.map(p => ({ playerId: p.playerId, color: p.color })),
      currentTurn: room.players[room.turnIndex].color
    });
  });

  /**
   * 4. ROLL DICE
   * Payload: { roomId: string } (or uses stored socket.roomId)
   */
  socket.on('rollDice', ({ roomId }) => {
    const activeRoomId = roomId || socket.roomId;
    const room = rooms.get(activeRoomId);

    if (!room) {
      return socket.emit('error', { message: 'Active game not found.' });
    }

    // Ensure it's the current player's turn
    const currentPlayer = room.players[room.turnIndex];
    if (currentPlayer.socketId !== socket.id) {
      return socket.emit('error', { message: "It is not your turn to roll!" });
    }

    // Generate random roll 1-6
    const diceValue = Math.floor(Math.random() * 6) + 1;

    console.log(`[Dice Roll] Room ${activeRoomId} | Player (${currentPlayer.color}): ${diceValue}`);

    // Broadcast dice result to all clients in the room
    io.to(activeRoomId).emit('diceResult', {
      player: currentPlayer.color,
      value: diceValue
    });
  });

  /**
   * 5. MOVE TOKEN / SWITCH TURN
   * Payload: { tokenIndex: number }
   */
  socket.on('moveToken', ({ tokenIndex }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const currentPlayer = room.players[room.turnIndex];
    
    // Broadcast token move to opponent
    socket.to(room.roomId).emit('playerMoved', {
      player: currentPlayer.color,
      tokenIndex
    });
  });

  /**
   * 6. END TURN (Switch player)
   */
  socket.on('endTurn', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    // Toggle turn index (0 -> 1 -> 0)
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.turnIndex];

    io.to(room.roomId).emit('turnSwitched', {
      currentTurn: nextPlayer.color
    });
  });

  /**
   * CLEANUP ON DISCONNECT
   */
  socket.on('disconnect', () => {
    console.log(`[Disconnected] Socket ID: ${socket.id}`);
    if (socket.roomId) {
      io.to(socket.roomId).emit('playerDisconnected', {
        message: 'Opponent disconnected.'
      });
      rooms.delete(socket.roomId);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n🚀 Ludo Backend Server running on http://localhost:${PORT}`);
});

