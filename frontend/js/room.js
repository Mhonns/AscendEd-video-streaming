// Socket.io connection
let socket = null;
let userId = null;
let currentRoomId = null;

// Use central config for server URL

// Get room ID from URL parameters
function getRoomId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('room') || 'ABC123XYZ';
}

// Get meeting name from URL parameters
function getMeetingName() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('name') || 'Meeting Room';
}

// Initialize room
async function initRoom() {
  const roomId = getRoomId();
  const meetingName = getMeetingName();
  currentRoomId = roomId;
  
  document.querySelector('.room-name').textContent = meetingName;
  document.querySelector('.room-id').textContent = `Room ID: ${roomId}`;
  
  // Setup copy room ID button
  const copyBtn = document.getElementById('copy-room-id-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyRoomId(roomId));
  }

  // Determine server URL first
  await determineServerURL();

  // Validate room exists before connecting
  const response = await fetch(`${getAPIURL()}/rooms/${roomId}`);
  const data = await response.json();
  
  if (!response.ok || !data.success) {
    alert(`Room "${roomId}" not found. Please check the room code and try again.`);
    window.location.href = '../index.html';
    return;
  }

  // Get or generate user ID
  userId = localStorage.getItem('userId') || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  if (!localStorage.getItem('userId')) {
    localStorage.setItem('userId', userId);
  }

  // Get user profile from localStorage
  const userName = localStorage.getItem('userName') || 'Anonymous';
  const profileImage = localStorage.getItem('profileImage') || null;

  // Connect to Socket.io server
  socket = io(getServerURL());

  socket.on('connect', () => {
    console.log('Connected to server');
    // Join the room
    socket.emit('join-room', {
      roomId: roomId,
      userId: userId
    });
  });

  socket.on('room-joined', async (data) => {
    console.log('Successfully joined room:', data);
    document.querySelector('.room-name').textContent = data.roomName;
    
    // Display all users in sidebar and update count
    if (data.users && Array.isArray(data.users)) {
      console.log(`Received ${data.users.length} users from server:`, data.users);
      displayUsers(data.users);
      updateUserCount(data.users.length);
    } else {
      console.warn('No users data received or invalid format:', data);
    }
    
    // Initialize WebRTC signaling connection when room is joined
    if (window.WebRTCModule && typeof window.WebRTCModule.initWebRTCSignaling === 'function') {
      try {
        // Pre-initialize WebRTC signaling connection (without requesting media)
        console.log('Initializing WebRTC signaling connection...');
        await window.WebRTCModule.initWebRTCSignaling();
        console.log('WebRTC signaling initialized successfully');
      } catch (error) {
        console.error('Error initializing WebRTC:', error);
      }
    } else {
      console.warn('WebRTC module not available yet');
    }
  });

  socket.on('room-error', (data) => {
    console.error('Room error:', data);
    alert(`Error: ${data.message}`);
    // Redirect back to landing page if room doesn't exist
    window.location.href = '../index.html';
  });

  socket.on('user-joined', (data) => {
    console.log('User joined:', data);
    // Update UI - show all users
    if (data.user) {
      addUserToList(data.user);
      updateUserCount(usersList.length);
    }
  });

  socket.on('user-left', (data) => {
    console.log('User left:', data);
    if (data.userId) {
      removeUserFromList(data.userId);
      updateUserCount(usersList.length);
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
}

// Auto-hide controls
let hideTimeout;
let autoHideEnabled = false; // Default to disabled (pinned)
let peopleListVisible = true; // Default to visible
const topBar = document.getElementById('top-bar');
const bottomControls = document.getElementById('bottom-controls');
const usersSidebar = document.getElementById('users-sidebar');

function showControls() {
  topBar.classList.add('show');
  bottomControls.classList.add('show');
  document.body.classList.add('show-cursor');
  
  if (autoHideEnabled) {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hideControls, 3000);
  }
}

function hideControls() {
  if (!autoHideEnabled) return;
  
  topBar.classList.remove('show');
  bottomControls.classList.remove('show');
  document.body.classList.remove('show-cursor');
}

// Show controls on mouse move
document.addEventListener('mousemove', showControls);
document.addEventListener('mousedown', showControls);

// Show controls initially
showControls();

// Toggle microphone
const micBtn = document.getElementById('mic-btn');
const micIcon = micBtn ? micBtn.querySelector('img') : null;
let isMicOn = false;

if (micBtn && micIcon) {
  micBtn.addEventListener('click', async function() {
    if (!isMicOn) {
      // Request microphone permission and initialize WebRTC
      const success = await window.WebRTCModule?.requestMicrophonePermission();
      if (success) {
        isMicOn = true;
        this.classList.remove('off');
        micIcon.src = '../assets/icons/mic.svg';
        console.log('Microphone enabled');
      }
    } else {
      // Toggle microphone off
      window.WebRTCModule?.toggleMicrophone(false);
      isMicOn = false;
      this.classList.add('off');
      micIcon.src = '../assets/icons/mic-off.svg';
      console.log('Microphone disabled');
    }
  });
}

// Toggle camera
const cameraBtn = document.getElementById('camera-btn');
const cameraIcon = cameraBtn ? cameraBtn.querySelector('img') : null;
let isCameraOn = false;

if (cameraBtn && cameraIcon) {
  cameraBtn.addEventListener('click', async function() {
    if (!isCameraOn) {
      // Request camera permission and initialize WebRTC
      const success = await window.WebRTCModule?.requestCameraPermission();
      if (success) {
        isCameraOn = true;
        this.classList.remove('off');
        cameraIcon.src = '../assets/icons/camera.svg';
        console.log('Camera enabled');
      }
    } else {
      // Toggle camera off
      window.WebRTCModule?.toggleCamera(false);
      isCameraOn = false;
      this.classList.add('off');
      cameraIcon.src = '../assets/icons/camera-off.svg';
      console.log('Camera disabled');
    }
  });
}

// Toggle recording
let isRecording = false; // Start with recording on
const recordingBtn = document.getElementById('recording-btn');
const recordingIcon = recordingBtn.querySelector('img');
recordingBtn.addEventListener('click', function() {
  isRecording = !isRecording;
  if (isRecording) {
    recordingIcon.src = '../assets/icons/recording.svg';
    this.title = 'Stop Recording';
    this.classList.add('recording');
    console.log('Recording started');
    // TODO: Implement actual recording start
  } else {
    recordingIcon.src = '../assets/icons/recording-off.svg';
    this.title = 'Start Recording';
    this.classList.remove('recording');
    console.log('Recording stopped');
    // TODO: Implement actual recording stop
  }
});

// Share screen
document.getElementById('share-btn').addEventListener('click', function() {
  console.log('Share screen clicked');
  // TODO: Implement screen sharing
});

// Show/hide participants
const peopleBtn = document.getElementById('people-btn');
peopleBtn.addEventListener('click', function() {
  peopleListVisible = !peopleListVisible;
  
  if (peopleListVisible) {
    this.classList.add('active');
    if (usersSidebar) {
      usersSidebar.classList.remove('hidden');
    }
    console.log('Participants list shown');
  } else {
    this.classList.remove('active');
    if (usersSidebar) {
      usersSidebar.classList.add('hidden');
    }
    console.log('Participants list hidden');
  }
});

// Set people button to active by default
peopleBtn.classList.add('active');

// Open chat
document.getElementById('chat-btn').addEventListener('click', function() {
  console.log('Open chat clicked');
  // TODO: Open chat panel
});

// Toggle auto-hide
const toggleUiBtn = document.getElementById('toggle-ui-btn');
toggleUiBtn.addEventListener('click', function() {
  autoHideEnabled = !autoHideEnabled;
  
  if (!autoHideEnabled) {
    // Pin controls - keep them visible
    clearTimeout(hideTimeout);
    showControls();
    this.classList.add('active');
    console.log('Controls pinned - auto-hide disabled');
  } else {
    // Unpin - resume auto-hide
    showControls();
    this.classList.remove('active');
    console.log('Controls unpinned - auto-hide enabled');
  }
});

// Set toggle-ui button to active by default (pinned)
toggleUiBtn.classList.add('active');

// Leave meeting
document.getElementById('leave-btn').addEventListener('click', function() {
  console.log('Leaving meeting...');
  
  // Notify server that user is leaving
  if (socket && currentRoomId && userId) {
    socket.emit('leave-room', {
      roomId: currentRoomId,
      userId: userId
    });
    socket.disconnect();
  }
  
  // Redirect to landing page
  window.location.href = '../index.html';
});

// Users management
let usersList = [];

function displayUsers(users) {
  // Display all users (including anonymous)
  usersList = users || [];
  const usersListElement = document.getElementById('users-list');
  if (!usersListElement) {
    console.warn('Users list element not found');
    return;
  }
  
  usersListElement.innerHTML = '';
  
  // Display all users
  users.forEach(user => {
    addUserToList(user);
  });
  
  console.log(`Displayed ${users.length} users in sidebar`);
}

function addUserToList(user) {
  if (!user || !user.userId) {
    console.warn('Invalid user data:', user);
    return;
  }
  
  // Check if user already exists in the DOM
  const existingItem = document.getElementById(`user-${user.userId}`);
  if (existingItem) {
    console.log(`User ${user.userId} already in list`);
    return;
  }
  
  // Add to usersList if not already there
  if (!usersList.find(u => u.userId === user.userId)) {
    usersList.push(user);
  }
  
  const usersListElement = document.getElementById('users-list');
  if (!usersListElement) {
    console.warn('Users list element not found');
    return;
  }
  
  const userItem = document.createElement('div');
  userItem.className = 'user-item';
  userItem.id = `user-${user.userId}`;
  
  const avatar = document.createElement('img');
  avatar.className = 'user-avatar';
  avatar.src = user.profileImage || '../assets/icons/people.svg';
  avatar.alt = user.name || 'User';
  avatar.onerror = function() {
    this.src = '../assets/icons/people.svg';
  };
  
  const name = document.createElement('div');
  name.className = 'user-name';
  name.textContent = user.name || 'Anonymous';
  
  userItem.appendChild(avatar);
  userItem.appendChild(name);
  usersListElement.appendChild(userItem);
  
  console.log(`Added user to list: ${user.name || 'Anonymous'} (${user.userId})`);
}

function removeUserFromList(userId) {
  usersList = usersList.filter(u => u.userId !== userId);
  
  const userItem = document.getElementById(`user-${userId}`);
  if (userItem) {
    userItem.remove();
  }
}

// Update user count display
function updateUserCount(count) {
  const userCountElement = document.getElementById('user-count-number');
  if (userCountElement) {
    userCountElement.textContent = count;
    console.log(`Updated user count to: ${count}`);
  } else {
    console.warn('User count element not found');
  }
}

// Copy room ID to clipboard
function copyRoomId(roomId) {
  const copyBtn = document.getElementById('copy-room-id-btn');
  const copyIcon = copyBtn ? copyBtn.querySelector('.copy-icon') : null;
  const originalSrc = copyIcon ? copyIcon.src : '';
  
  // Try modern Clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(roomId).then(() => {
      // Success - show visual feedback
      showCopySuccess(copyIcon);
      console.log('Room ID copied to clipboard:', roomId);
    }).catch(err => {
      console.error('Clipboard API failed:', err);
      // Fallback to execCommand
      fallbackCopy(roomId, copyIcon);
    });
  } else {
    // Fallback for browsers without Clipboard API
    fallbackCopy(roomId, copyIcon);
  }
}

// Show success feedback
function showCopySuccess(copyIcon) {
  if (!copyIcon) return;
  
  const originalSrc = copyIcon.src;
  const originalFilter = copyIcon.style.filter;
  
  // Change to checkmark icon (using a simple approach - change opacity and add green tint)
  copyIcon.style.filter = 'invert(1) sepia(1) saturate(5) hue-rotate(90deg)';
  copyIcon.style.opacity = '1';
  
  setTimeout(() => {
    copyIcon.style.filter = originalFilter || 'invert(1)';
    copyIcon.style.opacity = '';
  }, 1000);
}

// Fallback copy method using execCommand
function fallbackCopy(roomId, copyIcon) {
  const textArea = document.createElement('textarea');
  textArea.value = roomId;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  
  try {
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    
    if (successful) {
      // Success - show visual feedback
      showCopySuccess(copyIcon);
      console.log('Room ID copied to clipboard (fallback):', roomId);
    } else {
      throw new Error('execCommand copy failed');
    }
  } catch (err) {
    console.error('Fallback copy failed:', err);
    alert('Failed to copy room ID. Please copy manually: ' + roomId);
  } finally {
    document.body.removeChild(textArea);
  }
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

// Initialize when page loads
window.addEventListener('DOMContentLoaded', initRoom);