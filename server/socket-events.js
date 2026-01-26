/**
 * Socket.io Event Handlers
 * Handles real-time communication events
 */

const roomsModule = require('./rooms');
const chatModule = require('./chat');
const sfuModule = require('./sfu');

// Track socket connections
const socketConnections = new Map();

/**
 * Initialize socket event handlers
 */
function initSocketEvents(io) {
  io.on('connection', (socket) => {
    
    // Handle user joining a room
    socket.on('join-room', (data) => {
      const { roomId, userId } = data;
      
      const room = roomsModule.getRoom(roomId);
      
      if (!room || !room.isActive) {
        socket.emit('room-error', { message: 'Room not found or inactive' });
        return;
      }

      socket.join(roomId);
      roomsModule.joinRoom(roomId, userId);
      
      socketConnections.set(socket.id, { roomId, userId });
      
      // Get user profile
      const userProfile = roomsModule.getUserProfile(userId) || { userId, name: 'Anonymous' };
      const userName = userProfile.name || 'Anonymous';
      
      // Welcome log message
      console.log(`\n Welcome ${userName} (${userId}) to room "${room.name}" (${roomId})!`);
      console.log(`   Room has ${room.participants.size} participant(s)`);
      
      // Get all users in the room
      const roomUsers = roomsModule.getRoomUsers(roomId);
      
      // Get chat history for the room
      const chatHistory = chatModule.getRoomMessages(roomId);
      
      const roomJoinedData = {
        roomId: room.id,
        roomName: room.name,
        participantCount: room.participants.size,
        users: roomUsers,
        chatHistory: chatHistory
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

      // Send existing users to the new user
      const existingUsers = [];
      socketConnections.forEach((connInfo, sockId) => {
        if (connInfo.roomId === roomId && connInfo.userId !== userId) {
          const existingUser = roomsModule.getUserProfile(connInfo.userId);
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

    // Handle user leaving a room
    socket.on('leave-room', (data) => {
      const { roomId, userId } = data;
      handleUserLeave(socket, roomId, userId);
    });

    // Handle socket disconnection
    socket.on('disconnect', () => {
      const connectionInfo = socketConnections.get(socket.id);
      
      if (connectionInfo) {
        const { roomId, userId } = connectionInfo;
        handleUserLeave(socket, roomId, userId);
        socketConnections.delete(socket.id);
      }
    });

    // Handle chat messages
    socket.on('chat-message', (data) => {
      handleChatMessage(socket, io, data);
    });
    
    // Handle ICE candidate from client
    socket.on('ice-candidate', async (data) => {
      const { roomId, userId, candidate, type, streamKey } = data;
      if (roomId && userId && candidate) {
        await sfuModule.addIceCandidate(roomId, userId, candidate, type, streamKey);
      }
    });
  });
}

/**
 * Handle user leaving a room
 */
function handleUserLeave(socket, roomId, userId) {
  const room = roomsModule.getRoom(roomId);
  
  if (room) {
    const userProfile = roomsModule.getUserProfile(userId) || { userId, name: 'Anonymous' };
    const userName = userProfile.name || 'Anonymous';
    
    roomsModule.leaveRoom(roomId, userId);
    socket.leave(roomId);
    
    // Clean up all SFU streams for this user
    sfuModule.removeUserStreams(roomId, userId);
    
    console.log(` ${userName} (${userId}) left room "${room.name}" (${roomId})`);
    console.log(`  Room now has ${room.participants.size} participant(s)`);
    
    socket.to(roomId).emit('user-left', {
      userId: userId,
      user: userProfile,
      participantCount: room.participants.size
    });
  }
}

/**
 * Handle chat message
 */
function handleChatMessage(socket, io, data) {
  const { roomId, userId, userName, profileImage, message, timestamp } = data;
  
  // Validate required fields
  if (!roomId || !userId || !message) {
    socket.emit('chat-error', { message: 'Invalid message data' });
    return;
  }

  // Verify room exists and is active
  const room = roomsModule.getRoom(roomId);
  if (!room || !room.isActive) {
    socket.emit('chat-error', { message: 'Room not found or inactive' });
    return;
  }

  // Verify user is in the room
  if (!roomsModule.isUserInRoom(roomId, userId)) {
    socket.emit('chat-error', { message: 'User not in room' });
    return;
  }

  try {
    // Add message to chat queue
    const savedMessage = chatModule.addMessage(roomId, {
      userId,
      userName: userName || 'Anonymous',
      profileImage: profileImage || null,
      message: message.trim(),
      timestamp: timestamp || new Date().toISOString()
    });

    // Broadcast message to all users in the room (including sender)
    io.to(roomId).emit('chat-message', savedMessage);
    
    console.log(`Chat message from ${userName || 'Anonymous'} (${userId}) in room "${room.name}" (${roomId}): ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
  } catch (error) {
    console.error('Error handling chat message:', error);
    socket.emit('chat-error', { message: 'Failed to send message' });
  }
}

module.exports = {
  initSocketEvents,
  socketConnections
};

