/**
 * Socket Handler Module
 * Manages Socket.io connection and event handlers
 */

let socket = null;
let userId = null;
let currentRoomId = null;

function getSocket() {
  return socket;
}

function getUserId() {
  return userId;
}

function getCurrentRoomId() {
  return currentRoomId;
}

function setUserId(id) {
  userId = id;
}

function setCurrentRoomId(roomId) {
  currentRoomId = roomId;
}

// Initialize socket connection
async function initSocket(roomId, userData) {
  currentRoomId = roomId;
  userId = userData.userId;
  
  // Connect to Socket.io server
  socket = io(getServerURL());

  socket.on('connect', () => {
    console.log('[SocketHandler] Connected to server');
    // Join the room
    socket.emit('join-room', {
      roomId: roomId,
      userId: userId
    });
  });

  socket.on('room-joined', async (data) => {
    console.log('[SocketHandler] Successfully joined room:', data);
    document.querySelector('.room-name').textContent = data.roomName;
    
    // Display all users in sidebar and update count
    if (data.users && Array.isArray(data.users)) {
      console.log(`[SocketHandler] Received ${data.users.length} users from server:`, data.users);
      window.UsersModule.displayUsers(data.users);
      window.UsersModule.updateUserCount(data.users.length);
    } else {
      console.warn('[SocketHandler] No users data received or invalid format:', data);
    }
    
    // Load chat history if available
    if (data.chatHistory && Array.isArray(data.chatHistory) && window.ChatModule) {
      window.ChatModule.loadChatHistory(data.chatHistory);
    }

    // SFU: on join, POST to /consumer to consume current streams from other users
    if (window.SFUConsumeModule && typeof window.SFUConsumeModule.requestConsumeCurrentStreams === 'function') {
      try {
        await window.SFUConsumeModule.requestConsumeCurrentStreams(currentRoomId, userId);
      } catch (error) {
        console.error('[SocketHandler] Failed to request SFU consume on join:', error);
      }
    }
  });

  socket.on('room-error', (data) => {
    console.error('[SocketHandler] Room error:', data);
    alert(`Error: ${data.message}`);
    // Redirect back to landing page if room doesn't exist
    window.location.href = '../';
  });

  socket.on('user-joined', (data) => {
    console.log('[SocketHandler] User joined:', data);
    // Update UI - show all users
    if (data.user) {
      window.UsersModule.addUserToList(data.user);
      window.UsersModule.updateUserCount(window.UsersModule.getUsersList().length);
    }
  });

  socket.on('user-left', (data) => {
    console.log('[SocketHandler] User left:', data);
    if (data.userId) {
      window.UsersModule.removeUserFromList(data.userId);
      window.UsersModule.updateUserCount(window.UsersModule.getUsersList().length);
    }
  });

  socket.on('disconnect', () => {
    console.log('[SocketHandler] Disconnected from server');
  });
  
  // SFU: when a NEW user starts broadcasting for the first time, consume their stream
  socket.on('new-broadcaster', async (data) => {
    console.log(`[SocketHandler] New broadcaster event received: ${data.userId} (my userId: ${userId})`);
    
    // Don't consume if it's our own broadcast
    if (data.userId === userId) {
      console.log('[SocketHandler] Skipping - this is my own broadcast');
      return;
    }
    
    console.log('[SocketHandler] Will re-consume to get new broadcaster stream...');
    if (window.SFUConsumeModule && typeof window.SFUConsumeModule.requestConsumeCurrentStreams === 'function') {
      try {
        await window.SFUConsumeModule.requestConsumeCurrentStreams(currentRoomId, userId);
        console.log('[SocketHandler] Successfully consumed streams from new broadcaster');
      } catch (error) {
        console.error('[SocketHandler] Failed to consume from new broadcaster:', error);
      }
    } else {
      console.error('[SocketHandler] SFUConsumeModule not available!');
    }
  });

  // SFU: user mute status changed (for UI updates, audio continues via WebRTC)
  socket.on('user-mute-status', (data) => {
    console.log('[SocketHandler] User mute status:', data);
    // The actual audio muting happens automatically via WebRTC track.enabled
  });
  
  // Initialize chat module
  if (window.ChatModule) {
    window.ChatModule.init(socket, userId, roomId);
  }
  
  return socket;
}

// Disconnect socket when user leaves the page
function disconnectOnLeave() {
  if (socket && socket.connected) {
    // Try to notify server that user is leaving (non-blocking)
    if (currentRoomId && userId) {
      try {
        // Use sendBeacon for more reliable delivery on page unload
        const data = JSON.stringify({
          roomId: currentRoomId,
          userId: userId
        });
        
        // Try to send via beacon API (more reliable for page unload)
        if (navigator.sendBeacon) {
          navigator.sendBeacon(`${getAPIURL()}/users/leave`, data);
        }
        
        // Also try socket emit (may not complete, but server will handle via disconnect)
        socket.emit('leave-room', {
          roomId: currentRoomId,
          userId: userId
        });
      } catch (error) {
        console.error('Error sending leave notification:', error);
      }
    }
    
    // Disconnect socket (server will handle cleanup via disconnect event)
    try {
      socket.disconnect();
      console.log('Socket disconnected due to page leave');
    } catch (error) {
      console.error('Error disconnecting socket:', error);
    }
  }
}

// Handle page unload events - use pagehide for better reliability
window.addEventListener('pagehide', (event) => {
  // pagehide fires for both tab closes and navigation
  disconnectOnLeave();
});

// Fallback for browsers that don't support pagehide well
window.addEventListener('beforeunload', (event) => {
  // Note: beforeunload may not fire reliably for tab closes in modern browsers
  // But we'll try anyway as a fallback
  disconnectOnLeave();
});

// Handle visibility change - when tab becomes hidden
document.addEventListener('visibilitychange', () => {
  // Don't disconnect on visibility change (tab switch, minimize)
  // Only the server-side disconnect handler will clean up when connection is lost
  // This allows the connection to persist when user switches tabs
});

// Export functions to global scope
window.SocketHandler = {
  initSocket,
  getSocket,
  getUserId,
  getCurrentRoomId,
  disconnectOnLeave
};

