/**
 * Room Management Module
 * Handles room creation, joining, leaving, and data storage
 */

const chatModule = require('./chat');
const sfuModule = require('./sfu');
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
    sfuModule.removeUserStreams(roomId, userId);
    if (room.participants.size === 0) {
      room.isActive = false;
      chatModule.clearRoomMessages(roomId);
      setTimeout(() => {
        const currentRoom = rooms.get(roomId);
        if (currentRoom && currentRoom.participants.size === 0) {
          destroyRoom(roomId);
        }
      }, 60000);
    }
  }
}

/**
 * Destroy a room and clean up all associated resources
 */
function destroyRoom(roomId) {
  chatModule.clearRoomMessages(roomId);
  sfuModule.destroyRoomStreams(roomId);
  rooms.delete(roomId);
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
  destroyRoom,
  getRoomUsers,
  saveUserProfile,
  getUserProfile,
  isUserInRoom
};

