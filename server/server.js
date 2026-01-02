const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();

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
  // Fallback to HTTP if certificates not available
  const http = require('http');
  server = http.createServer(app);
  console.warn('Running in HTTP mode. For production, ensure SSL certificates are configured.');
}

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

  console.log(`Saving user profile for ${userId}: ${name}`);

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
  
  // Get user profiles for all participants (only include users with saved profiles)
  const roomUsers = Array.from(room.participants)
    .map(userId => users.get(userId))
    .filter(user => user && user.name && user.name !== 'Anonymous');
  
  res.json({
    success: true,
    users: roomUsers
  });
});

// Socket.io connection handling
const socketConnections = new Map();

io.on('connection', (socket) => {
    socket.on('join-room', (data) => {
    const { roomId, userId } = data;
    
    const room = getRoom(roomId);
    
    if (!room || !room.isActive) {
      socket.emit('room-error', { message: 'Room not found or inactive' });
      return;
    }

    socket.join(roomId);
    joinRoom(roomId, userId);
    
    socketConnections.set(socket.id, { roomId, userId });
    
    // Get user profile
    const userProfile = users.get(userId) || { userId, name: 'Anonymous' };
    const userName = userProfile.name || 'Anonymous';
    
    // Welcome log message
    console.log(`\n Welcome ${userName} (${userId}) to room "${room.name}" (${roomId})!`);
    console.log(`   Room has ${room.participants.size} participant(s)`);
    
    // Get all users in the room (only include users with saved profiles)
    const roomUsers = Array.from(room.participants)
      .map(uid => users.get(uid))
      .filter(user => user && user.name && user.name !== 'Anonymous'); // Only include users with saved profiles
    
    const roomJoinedData = {
      roomId: room.id,
      roomName: room.name,
      participantCount: room.participants.size,
      users: roomUsers
    };
    
    socket.emit('room-joined', roomJoinedData);

    // Only notify other users if the joining user has a saved profile
    if (userProfile && userProfile.name && userProfile.name !== 'Anonymous') {
    const userJoinedData = {
      userId: userId,
      socketId: socket.id,
      user: userProfile,
      participantCount: room.participants.size
    };
    
    socket.to(roomId).emit('user-joined', userJoinedData);
    }

    const existingUsers = [];
    socketConnections.forEach((connInfo, sockId) => {
      if (connInfo.roomId === roomId && connInfo.userId !== userId) {
        const existingUser = users.get(connInfo.userId);
        // Only include users with saved profiles
        if (existingUser && existingUser.name && existingUser.name !== 'Anonymous') {
        existingUsers.push({
          userId: connInfo.userId,
          socketId: sockId,
          user: existingUser
        });
        }
      }
    });
    
    if (existingUsers.length > 0) {
      socket.emit('existing-users', {
        users: existingUsers,
        roomId: roomId
      });
    }
  });

  socket.on('leave-room', (data) => {
    const { roomId, userId } = data;
    handleUserLeave(socket, roomId, userId);
  });

  socket.on('disconnect', () => {
    const connectionInfo = socketConnections.get(socket.id);
    
    if (connectionInfo) {
      const { roomId, userId } = connectionInfo;
      handleUserLeave(socket, roomId, userId);
      socketConnections.delete(socket.id);
    }
  });
});

function handleUserLeave(socket, roomId, userId) {
  const room = getRoom(roomId);
  
  if (room) {
    const userProfile = users.get(userId) || { userId, name: 'Anonymous' };
    const userName = userProfile.name || 'Anonymous';
    
    leaveRoom(roomId, userId);
    socket.leave(roomId);
    
    console.log(`👋 ${userName} (${userId}) left room "${room.name}" (${roomId})`);
    console.log(`   Room now has ${room.participants.size} participant(s)`);
    
    socket.to(roomId).emit('user-left', {
      userId: userId,
      user: userProfile,
      participantCount: room.participants.size
    });
  }
}

// Sync room with signaling server
function syncRoomWithSignalingServer(roomId, meetingName, hostId) {
  const signalingHost = process.env.SIGNALING_SERVER_HOST || 'streaming.nathadon.com';
  const signalingPort = process.env.SIGNALING_SERVER_PORT || 10443;
  const useHttps = process.env.SIGNALING_SERVER_HTTPS !== 'false';
  
  const data = JSON.stringify({
    roomId: roomId,
    meetingName: meetingName,
    hostId: hostId
  });
  
  const options = {
    hostname: signalingHost,
    port: signalingPort,
    path: '/api/rooms/sync',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    },
    rejectUnauthorized: false // Allow self-signed certs in dev
  };
  
  const client = useHttps ? https : require('http');
  const req = client.request(options, (res) => {
    // Response handled (ignore errors)
  });
  
  req.on('error', (error) => {
    // Silently fail - signaling server sync is optional
  });
  
  req.write(data);
  req.end();
}

const PORT = process.env.PORT || 8443;
server.listen(PORT, () => {
  const protocol = sslOptions ? 'https' : 'http';
  console.log(`Server running on ${protocol}://localhost:${PORT}`);
  if (sslOptions) {
    console.log(`HTTPS server accessible at: https://streaming.nathadon.com:${PORT}`);
  }
});

