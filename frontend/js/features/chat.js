/**
 * Chat Module
 * Handles all chat-related functionality for the room
 */

// Chat state
let chatVisible = false;
let chatSocket = null;
let chatUserId = null;
let chatRoomId = null;
let unreadCount = 0;

// DOM elements
let chatBtn = null;
let chatSidebar = null;
let chatCloseBtn = null;
let chatMessages = null;
let chatInput = null;
let chatSendBtn = null;
let chatCountBadge = null;

// Initialize chat module
function initChat(socket, userId, roomId) {
  chatSocket = socket;
  chatUserId = userId;
  chatRoomId = roomId;
  
  // Get DOM elements
  chatBtn = document.getElementById('chat-btn');
  chatSidebar = document.getElementById('chat-sidebar');
  chatMessages = document.getElementById('chat-messages');
  chatInput = document.getElementById('chat-input');
  chatSendBtn = document.getElementById('chat-send-btn');
  chatCountBadge = document.getElementById('chat-count-badge');
  
  if (!chatBtn || !chatSidebar || !chatMessages || !chatInput || !chatSendBtn) {
    console.warn('[Chat] Chat elements not found');
    return;
  }
  
  // Setup event listeners
  chatBtn.addEventListener('click', toggleChat);
  chatSendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
  
  // Listen for incoming chat messages from server
  if (chatSocket) {
    chatSocket.on('chat-message', (data) => {
      // Check if this message already exists (to avoid duplicates)
      const messageId = data.messageId;
      if (messageId && isMessageDisplayed(messageId)) {
        return; // Message already displayed
      }
      
      // Add message (server broadcasts to all users including sender)
      addChatMessage({
        messageId: messageId,
        userId: data.userId,
        userName: data.userName,
        profileImage: data.profileImage,
        message: data.message,
        timestamp: new Date(data.timestamp)
      });
      
      // Increment unread count if chat is not visible and message is from someone else
      const currentUserId = localStorage.getItem('userId') || chatUserId;
      if (!chatVisible && data.userId !== currentUserId) {
        incrementUnreadCount();
      }
    });

    // Listen for chat errors
    chatSocket.on('chat-error', (data) => {
      console.error('[Chat] Chat error:', data.message);
    });
  }
  
  console.log('[Chat] Chat module initialized');
}

// Track displayed message IDs to prevent duplicates
const displayedMessageIds = new Set();

function isMessageDisplayed(messageId) {
  return displayedMessageIds.has(messageId);
}

function markMessageAsDisplayed(messageId) {
  if (messageId) {
    displayedMessageIds.add(messageId);
  }
}

// Toggle chat sidebar
function toggleChat() {
  chatVisible = !chatVisible;
  
  if (chatVisible) {
    chatSidebar.classList.add('visible');
    chatBtn.classList.add('active');
    document.body.classList.add('chat-visible');
    // Focus on input when chat opens
    setTimeout(() => chatInput.focus(), 100);
    // Reset unread count when chat is opened
    resetUnreadCount();
    console.log('[Chat] Chat opened');
  } else {
    chatSidebar.classList.remove('visible');
    chatBtn.classList.remove('active');
    document.body.classList.remove('chat-visible');
    console.log('[Chat] Chat closed');
  }
}

// Increment unread message count
function incrementUnreadCount() {
  unreadCount++;
  updateUnreadBadge();
}

// Reset unread message count
function resetUnreadCount() {
  unreadCount = 0;
  updateUnreadBadge();
}

// Update the unread badge display
function updateUnreadBadge() {
  if (!chatCountBadge) return;
  
  if (unreadCount > 0) {
    chatCountBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    chatCountBadge.classList.add('show');
  } else {
    chatCountBadge.classList.remove('show');
  }
}

// Send message
function sendMessage() {
  const messageText = chatInput.value.trim();
  if (!messageText) return;
  
  // Get current user info
  const userName = localStorage.getItem('userName') || 'Anonymous';
  const profileImage = localStorage.getItem('profileImage') || '../assets/icons/people.svg';
  const currentUserId = localStorage.getItem('userId') || chatUserId;
  
  // Clear input immediately for better UX
  chatInput.value = '';
  
  // Emit message to server (if socket is available)
  // The server will broadcast it back to all users including the sender
  if (chatSocket && chatRoomId) {
    chatSocket.emit('chat-message', {
      roomId: chatRoomId,
      userId: currentUserId,
      userName: userName,
      profileImage: profileImage,
      message: messageText,
      timestamp: new Date().toISOString()
    });
  } else {
    console.error('Cannot send message: socket or room ID not available');
  }
  
  console.log('Message sent:', messageText);
}

// Add chat message to UI
function addChatMessage(messageData) {
  if (!chatMessages) return;
  
  // Mark message as displayed to prevent duplicates
  if (messageData.messageId) {
    if (isMessageDisplayed(messageData.messageId)) {
      return; // Already displayed
    }
    markMessageAsDisplayed(messageData.messageId);
  }
  
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  if (messageData.messageId) {
    messageDiv.setAttribute('data-message-id', messageData.messageId);
  }
  
  // Check if message is from current user
  const currentUserId = localStorage.getItem('userId') || chatUserId;
  const isOwnMessage = messageData.userId === currentUserId;
  
  if (isOwnMessage) {
    messageDiv.classList.add('own-message');
  }
  
  // Format timestamp
  const timestamp = messageData.timestamp instanceof Date 
    ? messageData.timestamp 
    : new Date(messageData.timestamp);
  const timeStr = formatChatTimestamp(timestamp);
  
  messageDiv.innerHTML = `
    <div class="chat-message-avatar">
      <img src="${messageData.profileImage || '../assets/icons/people.svg'}" 
           alt="${messageData.userName || 'User'}" 
           onerror="this.src='../assets/icons/people.svg'">
    </div>
    <div class="chat-message-content">
      <div class="chat-message-header">
        <span class="chat-message-name">${messageData.userName || 'Anonymous'}</span>
        <span class="chat-message-time">${timeStr}</span>
      </div>
      <div class="chat-message-text">${escapeHtml(messageData.message)}</div>
    </div>
  `;
  
  chatMessages.appendChild(messageDiv);
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Load chat history (called when user joins room)
function loadChatHistory(chatHistory) {
  if (!chatHistory || !Array.isArray(chatHistory)) {
    return;
  }

  // Clear existing messages
  if (chatMessages) {
    chatMessages.innerHTML = '';
    displayedMessageIds.clear();
  }

  // Add all messages from history
  chatHistory.forEach(msg => {
    addChatMessage({
      messageId: msg.messageId,
      userId: msg.userId,
      userName: msg.userName,
      profileImage: msg.profileImage,
      message: msg.message,
      timestamp: new Date(msg.timestamp)
    });
  });

  console.log(`Loaded ${chatHistory.length} chat messages from history`);
}

// Format timestamp for chat
function formatChatTimestamp(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  
  if (minutes < 1) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  } else {
    // Show date if older than 24 hours
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


// Update chat socket/room info (for when socket reconnects or room changes)
function updateChatConnection(socket, userId, roomId) {
  chatSocket = socket;
  chatUserId = userId;
  chatRoomId = roomId;
  
  // Re-setup socket listener if socket changed
  if (chatSocket) {
    chatSocket.off('chat-message'); // Remove old listener
    chatSocket.on('chat-message', (data) => {
      const currentUserId = localStorage.getItem('userId') || chatUserId;
      if (data.userId !== currentUserId) {
        addChatMessage({
          userId: data.userId,
          userName: data.userName,
          profileImage: data.profileImage,
          message: data.message,
          timestamp: new Date(data.timestamp)
        });
      }
    });
  }
}

// Export chat module
window.ChatModule = {
  init: initChat,
  updateConnection: updateChatConnection,
  addMessage: addChatMessage,
  loadChatHistory: loadChatHistory,
  incrementUnreadCount,
  resetUnreadCount,
  getUnreadCount: () => unreadCount
};

