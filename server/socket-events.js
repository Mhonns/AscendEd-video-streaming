/**
 * Socket.io Event Handlers
 * Handles real-time communication events
 */

const roomsModule = require('./rooms');
const chatModule = require('./chat');
const sfuModule = require('./sfu');
const recorder = require('./recorder');

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

      // Include current recording status so rejoining users sync immediately
      const recStatus = recorder.getStatus(roomId);

      const roomJoinedData = {
        roomId: room.id,
        roomName: room.name,
        participantCount: room.participants.size,
        users: roomUsers,
        chatHistory: chatHistory,
        recordingActive: recStatus.active
      };

      socket.emit('room-joined', roomJoinedData);

      // Notify other users that a new user has joined
      const userJoinedData = {
        userId: userId,
        socketId: socket.id,
        user: userProfile,
        participantCount: room.participants.size
      };

      socket.to(roomId).emit('user-joined', userJoinedData);

      // Send existing users to the new user
      const existingUsers = [];
      socketConnections.forEach((connInfo, sockId) => {
        if (connInfo.roomId === roomId && connInfo.userId !== userId) {
          const existingUser = roomsModule.getUserProfile(connInfo.userId) || { userId: connInfo.userId, name: 'Anonymous' };
          existingUsers.push({
            userId: connInfo.userId,
            socketId: sockId,
            user: {
              ...existingUser,
              name: existingUser.name || 'Anonymous'
            }
          });
        }
      });

      if (existingUsers.length > 0) {
        socket.emit('existing-users', {
          users: existingUsers,
          roomId: roomId
        });

        // Send current media states so the new user can render correct mic/camera/screen icons
        const mediaStates = existingUsers.map(eu => ({
          userId: eu.userId,
          ...roomsModule.getUserMediaState(eu.userId)
        }));
        socket.emit('sync-media-states', { mediaStates });
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

    // Handle hands-up toggle
    socket.on('toggle-handsup', (data) => {
      const { roomId, userId, handsUp } = data;

      if (!roomId || !userId) {
        console.warn('[SocketEvents] Invalid toggle-handsup data:', data);
        return;
      }

      const room = roomsModule.getRoom(roomId);
      if (!room || !room.isActive) {
        return;
      }

      console.log(`[SocketEvents] User ${userId} ${handsUp ? 'raised' : 'lowered'} hand in room ${roomId}`);

      // Persist hands-up state
      roomsModule.setUserMediaState(userId, { handsUp: !!handsUp });

      // Broadcast to all users in the room (including sender for confirmation)
      io.to(roomId).emit('user-handsup-status', {
        userId,
        handsUp: !!handsUp
      });
    });

    // Handle media state update — client sends full state, server persists and broadcasts
    socket.on('request-media-update', (data) => {
      const { roomId, userId, audioOn, videoOn, screenOn } = data;

      if (!roomId || !userId) {
        console.warn('[SocketEvents] Invalid request-media-update data:', data);
        return;
      }

      const room = roomsModule.getRoom(roomId);
      if (!room || !room.isActive) return;

      // Persist the full state on the server
      const state = roomsModule.setUserMediaState(userId, {
        audioOn: !!audioOn,
        videoOn: !!videoOn,
        screenOn: !!screenOn
      });

      console.log(`[SocketEvents] Media update for ${userId} in room ${roomId}: audio=${state.audioOn}, video=${state.videoOn}, screen=${state.screenOn}`);

      // Broadcast the complete state to everyone in the room (including sender)
      io.to(roomId).emit('user-media-update', {
        userId,
        audioOn: state.audioOn,
        videoOn: state.videoOn,
        screenOn: state.screenOn
      });
    });

    // Handle emoji reaction
    socket.on('emoji-reaction', (data) => {
      const { roomId, userId, emoji } = data;

      if (!roomId || !userId || !emoji) {
        console.warn('[SocketEvents] Invalid emoji-reaction data:', data);
        return;
      }

      const room = roomsModule.getRoom(roomId);
      if (!room || !room.isActive) {
        return;
      }

      console.log(`[SocketEvents] User ${userId} reacted with ${emoji} in room ${roomId}`);

      // Broadcast to all users in the room (including sender)
      io.to(roomId).emit('emoji-reaction', {
        userId,
        emoji
      });
    });
  });

  // ── Periodic media-state heartbeat ─────────────────────────────────────
  // Every 60 seconds, re-broadcast the authoritative media state for every
  // participant in every active room. This self-heals icon drift caused by
  // missed events, brief disconnects, or race conditions on join.
  const MEDIA_SYNC_INTERVAL_MS = 60_000;
  setInterval(() => broadcastMediaStateSync(io), MEDIA_SYNC_INTERVAL_MS);
  console.log(`[SocketEvents] Media-state heartbeat started (every ${MEDIA_SYNC_INTERVAL_MS / 1000}s)`);
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
    roomsModule.clearUserMediaState(userId);
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

/**
 * Broadcast authoritative media states for all participants in every active room.
 * Called by the 60-second heartbeat interval and can be invoked directly for
 * on-demand re-sync (e.g. after a recorder session ends).
 */
function broadcastMediaStateSync(io) {
  let roomCount = 0;
  let userCount = 0;

  roomsModule.rooms.forEach((room, roomId) => {
    if (!room.isActive || room.participants.size === 0) return;

    const mediaStates = Array.from(room.participants).map(uid => ({
      userId: uid,
      ...roomsModule.getUserMediaState(uid)
    }));

    io.to(roomId).emit('sync-media-states', { mediaStates });
    roomCount++;
    userCount += mediaStates.length;
  });

  if (roomCount > 0) {
    console.log(`[SocketEvents] Heartbeat: synced media states for ${userCount} user(s) across ${roomCount} room(s)`);
  }
}

module.exports = {
  initSocketEvents,
  broadcastMediaStateSync,
  socketConnections
};

