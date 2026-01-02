const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// SSL Certificate paths
const SSL_CERT_PATH = '/etc/letsencrypt/live/streaming.nathadon.com/fullchain.pem';
const SSL_KEY_PATH = '/etc/letsencrypt/live/streaming.nathadon.com/privkey.pem';

// Check if certificate files exist
let sslOptions = null;
try {
  if (fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH)) {
    sslOptions = {
      cert: fs.readFileSync(SSL_CERT_PATH),
      key: fs.readFileSync(SSL_KEY_PATH)
    };
    console.log('SSL certificates loaded successfully');
  } else {
    console.warn('SSL certificates not found. Server will run without HTTPS.');
    console.warn(`Looking for cert: ${SSL_CERT_PATH}`);
    console.warn(`Looking for key: ${SSL_KEY_PATH}`);
  }
} catch (error) {
  console.error('Error loading SSL certificates:', error.message);
  console.warn('Server will run without HTTPS.');
}

// Create HTTPS server if certificates are available, otherwise fallback to HTTP
let server;
if (sslOptions) {
  server = https.createServer(sslOptions, app);
} else {
  server = http.createServer(app);
  console.warn('Running in HTTP mode. For production, ensure SSL certificates are configured.');
}

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Initialize room storage
const socketToRoom = {};
const rooms = {};

io.on("connection", socket => {
  socket.on("join", data => {
      // let a new user join to the room
      const roomId = data.room;
      socket.join(roomId);
      socketToRoom[socket.id] = roomId;

      // Check if user already exists in room (re-join scenario)
      const existingUserIndex = rooms[roomId] ? rooms[roomId].findIndex(user => user.id === socket.id) : -1;
      
      if (existingUserIndex >= 0) {
          // User re-joining, update their info
          rooms[roomId][existingUserIndex] = {id: socket.id, name: data.name};
          console.log("[re-joined] room:" + roomId + " name: " + data.name);
      } else {
          // New user joining
          if (rooms[roomId]) {
              rooms[roomId].push({id: socket.id, name: data.name});
          } else {
              rooms[roomId] = [{id: socket.id, name: data.name}];
          }
          console.log("[joined] room:" + roomId + " name: " + data.name);
      }

      // Always sends a list of joined users (including on re-join for renegotiation)
      const users = rooms[roomId] ? rooms[roomId].filter(user => user.id !== socket.id) : [];
      io.sockets.to(socket.id).emit("room_users", users);
      console.log("Sent room_users to " + socket.id + ": " + users.length + " users");
  });

  socket.on("offer", sdp => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      socket.to(roomId).emit("getOffer", sdp);
      console.log("offer from " + socket.id + " to room " + roomId);
    } else {
      // Fallback to broadcast if room not found
      socket.broadcast.emit("getOffer", sdp);
      console.log("offer: " + socket.id + " (no room)");
    }
  });

  socket.on("answer", sdp => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      socket.to(roomId).emit("getAnswer", sdp);
      console.log("answer from " + socket.id + " to room " + roomId);
    } else {
      // Fallback to broadcast if room not found
      socket.broadcast.emit("getAnswer", sdp);
      console.log("answer: " + socket.id + " (no room)");
    }
  });

  socket.on("candidate", candidate => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      socket.to(roomId).emit("getCandidate", candidate);
      console.log("candidate from " + socket.id + " to room " + roomId);
    } else {
      // Fallback to broadcast if room not found
      socket.broadcast.emit("getCandidate", candidate);
      console.log("candidate: " + socket.id + " (no room)");
    }
  });

  socket.on("disconnect", () => {
    const roomId = socketToRoom[socket.id];
    let room = rooms[roomId];
    if (room) {
        room = room.filter(user => user.id !== socket.id);
        rooms[roomId] = room;
    }
    socket.broadcast.to(room).emit("user_exit", {id: socket.id});
    console.log(`[${socketToRoom[socket.id]}]: ${socket.id} exit`);
  });
});

const PORT = process.env.PORT || 30000;
server.listen(PORT, () => {
  const protocol = sslOptions ? 'https' : 'http';
  console.log(`Server is running on ${protocol}://localhost:${PORT}`);
  if (sslOptions) {
    console.log(`HTTPS server accessible at: https://streaming.nathadon.com:${PORT}`);
  }
});