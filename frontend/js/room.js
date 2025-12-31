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
function initRoom() {
  const roomId = getRoomId();
  const meetingName = getMeetingName();
  document.querySelector('.room-name').textContent = meetingName;
  document.querySelector('.room-id').textContent = `Room ID: ${roomId}`;
}

// Auto-hide controls
let hideTimeout;
let autoHideEnabled = true;
const topBar = document.getElementById('top-bar');
const bottomControls = document.getElementById('bottom-controls');

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
let isMicOn = false;
document.getElementById('mic-btn').addEventListener('click', function() {
  isMicOn = !isMicOn;
  if (isMicOn) {
    this.classList.remove('off');
  } else {
    this.classList.add('off');
  }
  console.log('Microphone:', isMicOn ? 'ON' : 'OFF');
  // TODO: Implement actual mic toggle
});

// Toggle camera
let isCameraOn = false;
document.getElementById('camera-btn').addEventListener('click', function() {
  isCameraOn = !isCameraOn;
  if (isCameraOn) {
    this.classList.remove('off');
  } else {
    this.classList.add('off');
  }
  console.log('Camera:', isCameraOn ? 'ON' : 'OFF');
  // TODO: Implement actual camera toggle
});

// Share screen
document.getElementById('share-btn').addEventListener('click', function() {
  console.log('Share screen clicked');
  // TODO: Implement screen sharing
});

// Show participants
document.getElementById('people-btn').addEventListener('click', function() {
  console.log('Show participants clicked');
  // TODO: Show participants panel
});

// Open chat
document.getElementById('chat-btn').addEventListener('click', function() {
  console.log('Open chat clicked');
  // TODO: Open chat panel
});

// Toggle auto-hide
document.getElementById('toggle-ui-btn').addEventListener('click', function() {
  autoHideEnabled = !autoHideEnabled;
  
  if (!autoHideEnabled) {
    // Pin controls - keep them visible
    clearTimeout(hideTimeout);
    showControls();
    this.style.background = 'rgba(255, 255, 255, 0.3)';
    console.log('Controls pinned - auto-hide disabled');
  } else {
    // Unpin - resume auto-hide
    showControls();
    this.style.background = 'rgba(255, 255, 255, 0.1)';
    console.log('Controls unpinned - auto-hide enabled');
  }
});

// Leave meeting
document.getElementById('leave-btn').addEventListener('click', function() {
  const confirmLeave = confirm('Are you sure you want to leave the meeting?');
  if (confirmLeave) {
    console.log('Leaving meeting...');
    // TODO: Clean up connections
    window.location.href = '../index.html';
  }
});

// Initialize when page loads
window.addEventListener('DOMContentLoaded', initRoom);