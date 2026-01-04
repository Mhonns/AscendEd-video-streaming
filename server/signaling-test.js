const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// SSL Configuration
const SSL_CERT = '/etc/letsencrypt/live/streaming.nathadon.com/fullchain.pem';
const SSL_KEY = '/etc/letsencrypt/live/streaming.nathadon.com/privkey.pem';

let server;
try {
  const sslOptions = {
    cert: fs.readFileSync(SSL_CERT),
    key: fs.readFileSync(SSL_KEY)
  };
  server = https.createServer(sslOptions, app);
  console.log(' HTTPS server created');
} catch (error) {
  server = http.createServer(app);
  console.warn(' Running HTTP (SSL certs not found)');
}

// Socket.IO setup
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Room storage: { roomId: [{ id, name }, ...] }
const rooms = {};
const socketToRoom = {}; // socketId -> roomId

io.on("connection", socket => {
  console.log(' Client connected:', socket.id);
  
  // User joins a room
  socket.on("join", ({ room, name }) => {
    socket.join(room);
    socketToRoom[socket.id] = room;
    
    // Initialize room if needed
    if (!rooms[room]) {
      rooms[room] = [];
    }
    
    // Add or update user in room
    const existingIndex = rooms[room].findIndex(u => u.id === socket.id);
    if (existingIndex >= 0) {
      rooms[room][existingIndex] = { id: socket.id, name };
      console.log(` ${socket.id} rejoined room: ${room}`);
    } else {
      rooms[room].push({ id: socket.id, name });
      console.log(` ${socket.id} joined room: ${room}`);
    }
    
    // Send ALL users in room to EVERYONE (keeps all clients in sync)
    io.to(room).emit("room_users", rooms[room]);
    
    // Notify others that someone joined
    socket.to(room).emit("user_joined", { id: socket.id, name });
  });
  
  // Forward offer with sender info
  socket.on("offer", ({ sdp, to }) => {
    if (to) {
      // Send to specific peer
      io.to(to).emit("getOffer", {
        sdp,
        from: socket.id
      });
      console.log(` Offer: ${socket.id} → ${to}`);
    } else {
      // Broadcast to room (fallback)
      const room = socketToRoom[socket.id];
      if (room) {
        socket.to(room).emit("getOffer", {
          sdp,
          from: socket.id
        });
        console.log(` Offer: ${socket.id} → room ${room}`);
      }
    }
  });
  
  // Forward answer with sender info
  socket.on("answer", ({ sdp, to }) => {
    if (to) {
      io.to(to).emit("getAnswer", {
        sdp,
        from: socket.id
      });
      console.log(` Answer: ${socket.id} → ${to}`);
    } else {
      // Broadcast to room (fallback)
      const room = socketToRoom[socket.id];
      if (room) {
        socket.to(room).emit("getAnswer", {
          sdp,
          from: socket.id
        });
        console.log(` Answer: ${socket.id} → room ${room}`);
      }
    }
  });
  
  // Forward ICE candidate with sender info
  socket.on("candidate", ({ candidate, to }) => {
    if (to) {
      io.to(to).emit("getCandidate", {
        candidate,
        from: socket.id
      });
      console.log(` ICE: ${socket.id} → ${to}`);
    } else {
      // Broadcast to room (fallback)
      const room = socketToRoom[socket.id];
      if (room) {
        socket.to(room).emit("getCandidate", {
          candidate,
          from: socket.id
        });
        console.log(` ICE: ${socket.id} → room ${room}`);
      }
    }
  });
  
  // Handle disconnect
  socket.on("disconnect", () => {
    const room = socketToRoom[socket.id];
    if (room && rooms[room]) {
      // Remove user from room
      rooms[room] = rooms[room].filter(u => u.id !== socket.id);
      
      // Notify others
      socket.to(room).emit("user_exit", { id: socket.id });
      
      // Clean up empty rooms
      if (rooms[room].length === 0) {
        delete rooms[room];
      }
      
      console.log(` ${socket.id} left room: ${room}`);
    }
    delete socketToRoom[socket.id];
  });
});

const PORT = process.env.PORT || 30000;
server.listen(PORT, () => {
  const protocol = server instanceof https.Server ? 'https' : 'http';
  console.log(`\n Server running on ${protocol}://localhost:${PORT}`);
  if (server instanceof https.Server) {
    console.log(` Public URL: https://streaming.nathadon.com:${PORT}\n`);
  }
});