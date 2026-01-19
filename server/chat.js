/**
 * Chat Module
 * Handles all chat-related logic for rooms
 * Stores messages in-memory using a queue structure
 */

// In-memory storage: roomId -> Array of messages (queue)
const roomMessages = new Map();

// Maximum number of messages to keep per room
const MAX_MESSAGES_PER_ROOM = 100000;

/**
 * Add a message to a room's chat queue
 * @param {string} roomId - The room ID
 * @param {Object} messageData - Message data containing userId, userName, profileImage, message, timestamp
 * @returns {Object} The stored message with messageId
 */
function addMessage(roomId, messageData) {
  if (!roomId || !messageData) {
    throw new Error('Room ID and message data are required');
  }

  // Initialize message queue for room if it doesn't exist
  if (!roomMessages.has(roomId)) {
    roomMessages.set(roomId, []);
  }

  const messageQueue = roomMessages.get(roomId);
  
  // Create message object with unique ID
  const message = {
    messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId: messageData.userId,
    userName: messageData.userName || 'Anonymous',
    profileImage: messageData.profileImage || null,
    message: messageData.message,
    timestamp: messageData.timestamp || new Date().toISOString(),
    createdAt: new Date()
  };

  // Add to queue (FIFO structure)
  messageQueue.push(message);

  // Limit queue size to prevent memory issues (keep last 1000 messages per room)
  if (messageQueue.length > MAX_MESSAGES_PER_ROOM) {
    messageQueue.shift(); // Remove oldest message
  }

  return message;
}

/**
 * Get all messages for a room (chat history)
 * @param {string} roomId - The room ID
 * @returns {Array} Array of messages
 */
function getRoomMessages(roomId) {
  if (!roomId) {
    return [];
  }

  return roomMessages.get(roomId) || [];
}

/**
 * Get messages for a room with optional limit
 * @param {string} roomId - The room ID
 * @param {number} limit - Maximum number of messages to return (optional)
 * @returns {Array} Array of messages
 */
function getRoomMessagesWithLimit(roomId, limit) {
  const messages = getRoomMessages(roomId);
  
  if (limit && limit > 0) {
    // Return the last N messages
    return messages.slice(-limit);
  }
  
  return messages;
}

/**
 * Clear all messages for a room (when room is destroyed)
 * @param {string} roomId - The room ID
 */
function clearRoomMessages(roomId) {
  if (roomId) {
    roomMessages.delete(roomId);
    console.log(`Chat messages cleared for room: ${roomId}`);
  }
}

/**
 * Get message count for a room
 * @param {string} roomId - The room ID
 * @returns {number} Number of messages in the room
 */
function getMessageCount(roomId) {
  const messages = roomMessages.get(roomId);
  return messages ? messages.length : 0;
}

/**
 * Check if a room has messages
 * @param {string} roomId - The room ID
 * @returns {boolean} True if room has messages
 */
function hasMessages(roomId) {
  const messages = roomMessages.get(roomId);
  return messages && messages.length > 0;
}

module.exports = {
  addMessage,
  getRoomMessages,
  getRoomMessagesWithLimit,
  clearRoomMessages,
  getMessageCount,
  hasMessages
};

