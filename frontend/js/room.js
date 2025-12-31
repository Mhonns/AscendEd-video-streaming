// Socket.io connection
let socket = null;
let userId = null;
let currentRoomId = null;
let SERVER_URL = 'http://localhost:3000';

// Determine server URL - try 192.168.1.54 first, fallback to localhost
async function determineServerURL() {
  const primaryURL = 'http://192.168.1.54:3000';
  const fallbackURL = 'http://localhost:3000';
  
  // Create a timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout')), 2000);
  });
  
  try {
    // Try to connect to primary server with timeout
    const response = await Promise.race([
      fetch(`${primaryURL}/api/rooms/test`, { method: 'GET' }),
      timeoutPromise
    ]);
    
    // If we get any response (even 404), server exists
    SERVER_URL = primaryURL;
    console.log('Using server:', SERVER_URL);
    return SERVER_URL;
  } catch (error) {
    // Primary server not available, use fallback
    console.log('Primary server not available, using fallback:', fallbackURL);
    SERVER_URL = fallbackURL;
    return SERVER_URL;
  }
}

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
  try {
    const response = await fetch(`${SERVER_URL}/api/rooms/${roomId}`);
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      alert(`Room "${roomId}" not found. Please check the room code and try again.`);
      window.location.href = '../index.html';
      return;
    }
  } catch (error) {
    console.error('Error validating room:', error);
    alert('Failed to validate room. Please check if the server is running.');
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
  socket = io(SERVER_URL);

  // Initialize WebRTC module
  WebRTC.initialize(socket, userId);

  socket.on('connect', () => {
    console.log('Connected to server');
    // Join the room
    socket.emit('join-room', {
      roomId: roomId,
      userId: userId
    });
  });

  socket.on('room-joined', (data) => {
    console.log('Successfully joined room:', data);
    document.querySelector('.room-name').textContent = data.roomName;
    
    // Display users in sidebar (filter out anonymous users) and update count
    if (data.users && Array.isArray(data.users)) {
      const loggedInUsers = data.users.filter(user => user.name && user.name !== 'Anonymous');
      displayUsers(loggedInUsers);
      updateUserCount(loggedInUsers.length);
    }
    
    // Show microphone permission modal after room is joined
    showMicPermissionModal();
  });

  socket.on('room-error', (data) => {
    console.error('Room error:', data);
    alert(`Error: ${data.message}`);
    // Redirect back to landing page if room doesn't exist
    window.location.href = '../index.html';
  });

  socket.on('user-joined', (data) => {
    console.log('User joined:', data);
    // Update UI
    if (data.user && data.user.name && data.user.name !== 'Anonymous') {
      addUserToList(data.user);
      updateUserCount(usersList.length);
    }
    // WebRTC connection is handled by the WebRTC module
  });

  socket.on('user-left', (data) => {
    console.log('User left:', data);
    if (data.userId) {
      // Close WebRTC connection with this user
      WebRTC.closePeerConnection(data.userId);
      removeUserFromList(data.userId);
      updateUserCount(usersList.length);
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    // Clean up all WebRTC connections
    WebRTC.cleanup();
  });
  
  // WebRTC signaling events are handled by the WebRTC module
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

// Microphone Permission Modal
function showMicPermissionModal() {
  // Check if getUserMedia is supported first
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.log('getUserMedia not supported, skipping permission modal');
    
    // Show error message instead
    const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    let errorMessage = 'Microphone access is not supported. ';
    if (!isSecureContext && location.protocol === 'http:') {
      errorMessage += 'Please access this site over HTTPS or use localhost (http://localhost:3000).';
    } else {
      errorMessage += 'Please use a modern browser that supports the MediaDevices API.';
    }
    alert(errorMessage);
    return;
  }
  
  // Check if permission was already granted or denied
  const permissionState = localStorage.getItem('micPermissionState');
  
  // Don't show modal if permission was already denied
  if (permissionState === 'denied') {
    console.log('Microphone permission was previously denied, skipping modal');
    return;
  }
  
  // Don't show modal if permission was already granted
  if (permissionState === 'granted' && WebRTC.getStream()) {
    console.log('Microphone permission already granted');
    return;
  }
  
  const modal = document.getElementById('mic-permission-modal');
  if (modal) {
    modal.classList.add('show');
    
    // Setup button handlers
    const allowBtn = document.getElementById('allow-mic-btn');
    const denyBtn = document.getElementById('deny-mic-btn');
    
    if (allowBtn) {
      allowBtn.onclick = async () => {
        try {
          await WebRTC.requestMicrophonePermission();
          // Enable mic button UI after permission granted
          const micBtn = document.getElementById('mic-btn');
          const micIcon = micBtn.querySelector('img');
          if (micBtn && micIcon) {
            micBtn.classList.remove('off');
            micIcon.src = '../assets/icons/mic.svg';
            isMicOn = true;
          }
          hideMicPermissionModal();
        } catch (error) {
          console.error('Error requesting microphone permission:', error);
          // Modal will stay open, user can try again or click "Not Now"
        }
      };
    }
    
    if (denyBtn) {
      denyBtn.onclick = () => {
        localStorage.setItem('micPermissionState', 'denied');
        hideMicPermissionModal();
      };
    }
  }
}

function hideMicPermissionModal() {
  const modal = document.getElementById('mic-permission-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

// Toggle microphone
let isMicOn = false;
const micBtn = document.getElementById('mic-btn');
const micIcon = micBtn.querySelector('img');
micBtn.addEventListener('click', async function() {
  try {
    if (!isMicOn) {
      // Turn mic ON
      const stream = WebRTC.getStream();
      if (!stream) {
        // Request permission if not already granted
        try {
          await WebRTC.getLocalAudioStream();
        } catch (error) {
          // Permission denied or error - show modal again
          showMicPermissionModal();
          return;
        }
      }
      
      // Enable microphone through WebRTC module
      if (WebRTC.enableMicrophone()) {
        this.classList.remove('off');
        micIcon.src = '../assets/icons/mic.svg';
        isMicOn = true;
        console.log('Microphone: ON');
        hideMicPermissionModal(); // Hide modal if it's still showing
      }
    } else {
      // Turn mic OFF
      WebRTC.disableMicrophone();

      this.classList.add('off');
      micIcon.src = '../assets/icons/mic-off.svg';
      isMicOn = false;
      console.log('Microphone: OFF');
    }
  } catch (error) {
    console.error('Error toggling microphone:', error);
    // Keep the UI state consistent
    this.classList.add('off');
    micIcon.src = '../assets/icons/mic-off.svg';
    isMicOn = false;
  }
});

// Toggle camera
let isCameraOn = false;
const cameraBtn = document.getElementById('camera-btn');
const cameraIcon = cameraBtn.querySelector('img');
cameraBtn.addEventListener('click', function() {
  isCameraOn = !isCameraOn;
  if (isCameraOn) {
    this.classList.remove('off');
    cameraIcon.src = '../assets/icons/camera.svg';
  } else {
    this.classList.add('off');
    cameraIcon.src = '../assets/icons/camera-off.svg';
  }
  console.log('Camera:', isCameraOn ? 'ON' : 'OFF');
  // TODO: Implement actual camera toggle
});

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
  
  // Clean up WebRTC connections
  WebRTC.cleanup();
  
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
  // Filter out anonymous users
  const loggedInUsers = users.filter(user => user.name && user.name !== 'Anonymous');
  usersList = loggedInUsers;
  const usersListElement = document.getElementById('users-list');
  if (!usersListElement) return;
  
  usersListElement.innerHTML = '';
  
  // Display all logged-in users
  loggedInUsers.forEach(user => {
    addUserToList(user);
  });
}

function addUserToList(user) {
  // Check if user already exists in the DOM
  const existingItem = document.getElementById(`user-${user.userId}`);
  if (existingItem) {
    return;
  }
  
  // Add to usersList if not already there
  if (!usersList.find(u => u.userId === user.userId)) {
    usersList.push(user);
  }
  
  const usersListElement = document.getElementById('users-list');
  if (!usersListElement) return;
  
  const userItem = document.createElement('div');
  userItem.className = 'user-item';
  userItem.id = `user-${user.userId}`;
  
  const avatar = document.createElement('img');
  avatar.className = 'user-avatar';
  avatar.src = user.profileImage || '../assets/icons/people.svg';
  avatar.alt = user.name;
  
  const name = document.createElement('div');
  name.className = 'user-name';
  name.textContent = user.name || 'Anonymous';
  
  userItem.appendChild(avatar);
  userItem.appendChild(name);
  usersListElement.appendChild(userItem);
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
  // Clean up WebRTC connections
  WebRTC.cleanup();
  
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
          navigator.sendBeacon(`${SERVER_URL}/api/users/leave`, data);
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