/**
 * REST API Routes
 * Handles HTTP endpoints for rooms and users
 */

const express = require('express');
const router = express.Router();
const roomsModule = require('./rooms');

/**
 * POST /api/rooms/create
 * Create a new room
 */
router.post('/rooms/create', (req, res) => {
  const { roomId, meetingName, hostId: clientHostId, password, disableChat, disableEmoji } = req.body;

  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  // Check if room already exists
  if (roomsModule.roomExists(roomId)) {
    return res.status(409).json({ error: 'Room already exists' });
  }

  const hostId = clientHostId || `host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  // Only store the password if the host actually set one
  const roomPassword = password && password.trim() ? password.trim() : null;

  // Seed adminState from host pre-room settings
  const initialAdminState = {
    chatDisabled:  !!disableChat,
    emojiDisabled: !!disableEmoji
  };

  const room = roomsModule.createRoom(roomId, meetingName, hostId, roomPassword, initialAdminState);

  console.log(`[API] Room "${roomId}" created by host ${hostId} — chatDisabled=${initialAdminState.chatDisabled}, emojiDisabled=${initialAdminState.emojiDisabled}`);

  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      hasPassword: !!room.password
    }
  });
});

/**
 * POST /api/rooms/join
 * Join an existing room
 */
router.post('/rooms/join', (req, res) => {
  const { roomId, password } = req.body;

  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  const room = roomsModule.getRoom(roomId);

  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }

  // Password check
  if (room.password) {
    if (!password || password.trim() !== room.password) {
      return res.status(401).json({ error: 'Incorrect password', requiresPassword: true });
    }
  }

  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name
    }
  });
});

/**
 * GET /api/rooms/:roomId
 * Get room information
 */
router.get('/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = roomsModule.getRoom(roomId);

  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }

  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      hasPassword: !!room.password,
      participantCount: room.participants.size
    }
  });
});

/**
 * GET /api/rooms/:roomId/users
 * Get all users in a room
 */
router.get('/rooms/:roomId/users', (req, res) => {
  const { roomId } = req.params;
  const room = roomsModule.getRoom(roomId);

  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }

  const roomUsers = roomsModule.getRoomUsers(roomId);

  res.json({
    success: true,
    users: roomUsers
  });
});

// ============================================
// User API Endpoints
// ============================================

/**
 * POST /api/users/profile
 * Save user profile
 */
router.post('/users/profile', (req, res) => {
  const { userId, name } = req.body;

  if (!userId || !name) {
    return res.status(400).json({ error: 'User ID and name are required' });
  }

  console.log(`Saving user profile for ${userId}: ${name}`);

  const user = roomsModule.saveUserProfile(userId, name);

  res.json({
    success: true,
    user: user
  });
});

/**
 * GET /api/users/:userId
 * Get user profile
 */
router.get('/users/:userId', (req, res) => {
  const { userId } = req.params;
  const user = roomsModule.getUserProfile(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    success: true,
    user: user
  });
});

module.exports = router;

