const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// In-memory room storage (in production, use a database)
const rooms = new Map();
const users = new Map(); // Store user profiles: userId -> { name, profileImage }

// Room management functions
function createRoom(roomId, meetingName, hostId) {
  const room = {
    id: roomId,
    name: meetingName || 'Untitled Meeting',
    hostId: hostId,
    participants: new Set([hostId]),
    createdAt: new Date(),
    isActive: true
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function joinRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (room && room.isActive) {
    room.participants.add(userId);
    return room;
  }
  return null;
}

function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (room) {
    room.participants.delete(userId);
    // If no participants left, mark room as inactive
    if (room.participants.size === 0) {
      room.isActive = false;
      // Optionally remove the room after a delay
      setTimeout(() => {
        const currentRoom = rooms.get(roomId);
        if (currentRoom && currentRoom.participants.size === 0) {
          rooms.delete(roomId);
        }
      }, 60000); // Remove after 1 minute of being empty
    }
  }
}

// REST API endpoints
app.post('/api/rooms/create', (req, res) => {
  const { roomId, meetingName } = req.body;
  
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  // Check if room already exists
  if (rooms.has(roomId) && rooms.get(roomId).isActive) {
    return res.status(409).json({ error: 'Room already exists' });
  }

  const hostId = `host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const room = createRoom(roomId, meetingName, hostId);
  
  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      hostId: room.hostId
    }
  });
});

app.post('/api/rooms/join', (req, res) => {
  const { roomId } = req.body;
  
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  const room = getRoom(roomId);
  
  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  joinRoom(roomId, userId);
  
  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name
    },
    userId: userId
  });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = getRoom(roomId);
  
  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }
  
  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      participantCount: room.participants.size
    }
  });
});

// Save user profile
app.post('/api/users/profile', (req, res) => {
  const { userId, name } = req.body;
  
  if (!userId || !name) {
    return res.status(400).json({ error: 'User ID and name are required' });
  }

  // Store or update user profile (ignoring profileImage for now)
  users.set(userId, {
    userId: userId,
    name: name,
    updatedAt: new Date()
  });
  
  res.json({
    success: true,
    user: users.get(userId)
  });
});

// Get user profile
app.get('/api/users/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.get(userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({
    success: true,
    user: user
  });
});

// Get all users in a room
app.get('/api/rooms/:roomId/users', (req, res) => {
  const { roomId } = req.params;
  const room = getRoom(roomId);
  
  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }
  
  // Get user profiles for all participants (ignoring profileImage)
  const roomUsers = Array.from(room.participants).map(userId => {
    const user = users.get(userId);
    return user || { userId, name: 'Anonymous' };
  });
  
  res.json({
    success: true,
    users: roomUsers
  });
});

// Socket.io connection handling
// Store socket connection info: socketId -> { roomId, userId }
const socketConnections = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

    socket.on('join-room', (data) => {
    const { roomId, userId } = data;
    console.log('\n=== USER JOINING ROOM ===');
    console.log('Join request:', { roomId, userId });
    
    const room = getRoom(roomId);
    
    if (!room || !room.isActive) {
      console.log('❌ Room not found or inactive');
      socket.emit('room-error', { message: 'Room not found or inactive' });
      return;
    }

    socket.join(roomId);
    joinRoom(roomId, userId);
    
    // Store socket connection info for cleanup on disconnect
    socketConnections.set(socket.id, { roomId, userId });
    
    // Get user profile if exists (ignoring profileImage)
    const userProfile = users.get(userId) || { userId, name: 'Anonymous' };
    
    // Get all users in the room (including the current user)
    const roomUsers = Array.from(room.participants).map(uid => {
      const user = users.get(uid);
      return user || { userId: uid, name: 'Anonymous' };
    });
    
    // Debug: Print room data
    console.log('📊 ROOM DATA:');
    console.log('  Room ID:', room.id);
    console.log('  Room Name:', room.name);
    console.log('  Host ID:', room.hostId);
    console.log('  Is Active:', room.isActive);
    console.log('  Created At:', room.createdAt);
    console.log('  Total Participants:', room.participants.size);
    console.log('  Participant IDs:', Array.from(room.participants));
    console.log('\n👥 USER PROFILES IN ROOM:');
    roomUsers.forEach((user, index) => {
      console.log(`  [${index + 1}] User ID: ${user.userId}`);
      console.log(`      Name: ${user.name}`);
    });
    console.log('\n🔍 JOINING USER PROFILE:');
    console.log('  User ID:', userProfile.userId);
    console.log('  Name:', userProfile.name);
    
    const roomJoinedData = {
      roomId: room.id,
      roomName: room.name,
      participantCount: room.participants.size,
      users: roomUsers
    };
    
    console.log('\n📤 SENDING TO CLIENT (room-joined):');
    console.log(JSON.stringify(roomJoinedData, null, 2));
    
    socket.emit('room-joined', roomJoinedData);

    // Notify other users in the room with user profile and socket ID
    const userJoinedData = {
      userId: userId,
      socketId: socket.id,
      user: userProfile,
      participantCount: room.participants.size
    };
    
    console.log('\n📤 NOTIFYING OTHER USERS (user-joined):');
    console.log(JSON.stringify(userJoinedData, null, 2));
    
    socket.to(roomId).emit('user-joined', userJoinedData);

    // Send existing users' info to the new user for WebRTC connections
    // We need to get socket IDs of existing users
    const existingUsers = [];
    socketConnections.forEach((connInfo, sockId) => {
      if (connInfo.roomId === roomId && connInfo.userId !== userId) {
        const existingUser = users.get(connInfo.userId) || { userId: connInfo.userId, name: 'Anonymous' };
        existingUsers.push({
          userId: connInfo.userId,
          socketId: sockId,
          user: existingUser
        });
      }
    });
    
    if (existingUsers.length > 0) {
      socket.emit('existing-users', {
        users: existingUsers,
        roomId: roomId
      });
    }

    console.log(`✅ User ${userId} successfully joined room ${roomId}`);
    console.log('=== END JOIN ===\n');
  });

  socket.on('leave-room', (data) => {
    const { roomId, userId } = data;
    handleUserLeave(socket, roomId, userId);
  });

  // WebRTC signaling handlers
  socket.on('webrtc-offer', (data) => {
    const { offer, targetSocketId, userId } = data;
    console.log(`WebRTC offer from ${userId} to socket ${targetSocketId}`);
    socket.to(targetSocketId).emit('webrtc-offer', {
      offer: offer,
      fromUserId: userId,
      fromSocketId: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    const { answer, targetSocketId, userId } = data;
    console.log(`WebRTC answer from ${userId} to socket ${targetSocketId}`);
    socket.to(targetSocketId).emit('webrtc-answer', {
      answer: answer,
      fromUserId: userId,
      fromSocketId: socket.id
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const { candidate, targetSocketId, userId } = data;
    socket.to(targetSocketId).emit('webrtc-ice-candidate', {
      candidate: candidate,
      fromUserId: userId,
      fromSocketId: socket.id
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Get connection info for this socket
    const connectionInfo = socketConnections.get(socket.id);
    
    if (connectionInfo) {
      const { roomId, userId } = connectionInfo;
      console.log(`Handling disconnect for user ${userId} in room ${roomId}`);
      
      // Handle user leave (same logic as explicit leave)
      handleUserLeave(socket, roomId, userId);
      
      // Remove from socket connections map
      socketConnections.delete(socket.id);
    } else {
      console.log('No room info found for disconnected socket:', socket.id);
    }
  });
});

// Helper function to handle user leaving (used by both leave-room and disconnect)
function handleUserLeave(socket, roomId, userId) {
  const room = getRoom(roomId);
  
  if (room) {
    leaveRoom(roomId, userId);
    socket.leave(roomId);
    
    // Get user profile for notification
    const userProfile = users.get(userId) || { userId, name: 'Anonymous' };
    
    // Notify other users in the room
    socket.to(roomId).emit('user-left', {
      userId: userId,
      user: userProfile,
      participantCount: room.participants.size
    });
    
    console.log(`User ${userId} left room ${roomId}`);
    console.log(`Remaining participants in room ${roomId}: ${room.participants.size}`);
  } else {
    console.log(`Room ${roomId} not found when user ${userId} tried to leave`);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

