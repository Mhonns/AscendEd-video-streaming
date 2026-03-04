/**
 * Room Management Module
 * Handles room creation, joining, leaving, and data storage
 */

const chatModule = require('./chat');
const sfuModule = require('./sfu');
const rooms = new Map();
const users = new Map(); // Store user profiles: userId -> { name, profileImage }
const userMediaState = new Map(); // Store media state: userId -> { audioOn, videoOn }

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
    .map(userId => {
      const profile = users.get(userId);
      if (!profile || !profile.name || profile.name === 'Anonymous') return null;
      const media = userMediaState.get(userId) || { audioOn: false, videoOn: false };
      return { ...profile, audioOn: media.audioOn, videoOn: media.videoOn };
    })
    .filter(Boolean);
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

/**
 * Set a user's media state (audioOn / videoOn)
 */
function setUserMediaState(userId, { audioOn, videoOn }) {
  const current = userMediaState.get(userId) || { audioOn: false, videoOn: false };
  userMediaState.set(userId, {
    audioOn: audioOn !== undefined ? !!audioOn : current.audioOn,
    videoOn: videoOn !== undefined ? !!videoOn : current.videoOn
  });
  return userMediaState.get(userId);
}

/**
 * Get a user's media state
 */
function getUserMediaState(userId) {
  return userMediaState.get(userId) || { audioOn: false, videoOn: false };
}

/**
 * Clear a user's media state on leave
 */
function clearUserMediaState(userId) {
  userMediaState.delete(userId);
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
  isUserInRoom,
  setUserMediaState,
  getUserMediaState,
  clearUserMediaState
};

