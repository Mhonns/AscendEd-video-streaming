/**
 * REST API Routes
 * Handles HTTP endpoints for rooms and users
 */

const express = require('express');
const router = express.Router();
const roomsModule = require('./rooms');

// ============================================
// Room API Endpoints
// ============================================

/**
 * POST /api/rooms/create
 * Create a new room
 */
router.post('/rooms/create', (req, res) => {
  const { roomId, meetingName } = req.body;
  
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  // Check if room already exists
  if (roomsModule.roomExists(roomId)) {
    return res.status(409).json({ error: 'Room already exists' });
  }

  const hostId = `host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const room = roomsModule.createRoom(roomId, meetingName, hostId);
  
  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      hostId: room.hostId
    }
  });
});

/**
 * POST /api/rooms/join
 * Join an existing room
 */
router.post('/rooms/join', (req, res) => {
  const { roomId } = req.body;
  
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  const room = roomsModule.getRoom(roomId);
  
  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  roomsModule.joinRoom(roomId, userId);
  
  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name
    },
    userId: userId
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

