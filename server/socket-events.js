/**
 * Socket.io Event Handlers
 * Handles real-time communication events
 */

const roomsModule = require('./rooms');
const chatModule = require('./chat');
const webrtcSFU = require('./webrtc-sfu');

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

    // WebRTC SFU Events
    // Get router RTP capabilities for the room
    socket.on('webrtc:get-router-capabilities', async (data, callback) => {
      try {
        const { roomId } = data;
        const rtpCapabilities = await webrtcSFU.getRouterRtpCapabilities(roomId);
        callback({ rtpCapabilities });
      } catch (error) {
        console.error('Error getting router capabilities:', error);
        callback({ error: error.message });
      }
    });

    // Create WebRTC transport
    socket.on('webrtc:create-transport', async (data, callback) => {
      try {
        const { roomId, peerId, direction } = data;
        const transportParams = await webrtcSFU.createWebRtcTransport(roomId, peerId, direction);
        callback(transportParams);
      } catch (error) {
        console.error('Error creating transport:', error);
        callback({ error: error.message });
      }
    });

    // Connect transport (DTLS handshake)
    socket.on('webrtc:connect-transport', async (data, callback) => {
      try {
        const { peerId, direction, dtlsParameters } = data;
        await webrtcSFU.connectTransport(peerId, direction, dtlsParameters);
        callback({ success: true });
      } catch (error) {
        console.error('Error connecting transport:', error);
        callback({ error: error.message });
      }
    });

    // Create producer (publish media)
    socket.on('webrtc:produce', async (data, callback) => {
      try {
        const { roomId, peerId, kind, rtpParameters, appData } = data;
        const { id: producerId } = await webrtcSFU.createProducer(peerId, kind, rtpParameters, appData);
        
        // Notify other participants about new producer
        socket.to(roomId).emit('webrtc:new-producer', {
          producerId,
          peerId,
          kind
        });
        
        callback({ producerId });
      } catch (error) {
        console.error('Error creating producer:', error);
        callback({ error: error.message });
      }
    });

    // Get existing producers in room
    socket.on('webrtc:get-producers', async (data, callback) => {
      try {
        const { roomId, peerId } = data;
        const producers = webrtcSFU.getRoomProducers(roomId, peerId);
        callback({ producers });
      } catch (error) {
        console.error('Error getting producers:', error);
        callback({ error: error.message });
      }
    });

    // Create consumer (receive media)
    socket.on('webrtc:consume', async (data, callback) => {
      try {
        const { roomId, consumerPeerId, producerId, rtpCapabilities } = data;
        const consumerParams = await webrtcSFU.createConsumer(
          roomId,
          consumerPeerId,
          producerId,
          rtpCapabilities
        );
        callback(consumerParams);
      } catch (error) {
        console.error('Error creating consumer:', error);
        callback({ error: error.message });
      }
    });

    // Resume consumer
    socket.on('webrtc:resume-consumer', async (data, callback) => {
      try {
        const { consumerId } = data;
        await webrtcSFU.resumeConsumer(consumerId);
        callback({ success: true });
      } catch (error) {
        console.error('Error resuming consumer:', error);
        callback({ error: error.message });
      }
    });

    // Handle WebRTC peer disconnection
    socket.on('webrtc:disconnect', async (data) => {
      try {
        const { peerId, roomId } = data;
        await webrtcSFU.closePeer(peerId);
        
        // Notify other participants
        socket.to(roomId).emit('webrtc:peer-closed', { peerId });
      } catch (error) {
        console.error('Error disconnecting WebRTC peer:', error);
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

