/**
 * Room Management Module
 * Handles room creation, joining, leaving, and data storage
 */

const chatModule = require('./chat');

// In-memory room storage (in production, use a database)
const rooms = new Map();
const users = new Map(); // Store user profiles: userId -> { name, profileImage }

/**
 * Create a new room
 */
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

/**
 * Get a room by ID
 */
function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * Check if a room exists and is active
 */
function roomExists(roomId) {
  const room = rooms.get(roomId);
  return room && room.isActive;
}

/**
 * Join a user to a room
 */
function joinRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (room && room.isActive) {
    room.participants.add(userId);
    return room;
  }
  return null;
}

/**
 * Remove a user from a room
 */
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
          // Clear chat messages when room is destroyed
          chatModule.clearRoomMessages(roomId);
        }
      }, 60000); // Remove after 1 minute of being empty
    }
  }
}

/**
 * Get all users in a room
 */
function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  
  return Array.from(room.participants)
    .map(userId => users.get(userId))
    .filter(user => user && user.name && user.name !== 'Anonymous');
}

/**
 * Save or update a user profile
 */
function saveUserProfile(userId, name) {
  users.set(userId, {
    userId: userId,
    name: name,
    updatedAt: new Date()
  });
  return users.get(userId);
}

/**
 * Get a user profile by ID
 */
function getUserProfile(userId) {
  return users.get(userId);
}

/**
 * Check if user is in a room
 */
function isUserInRoom(roomId, userId) {
  const room = rooms.get(roomId);
  return room && room.participants.has(userId);
}

module.exports = {
  rooms,
  users,
  createRoom,
  getRoom,
  roomExists,
  joinRoom,
  leaveRoom,
  getRoomUsers,
  saveUserProfile,
  getUserProfile,
  isUserInRoom
};

