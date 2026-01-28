/**
 * Buttons Module
 * Handles all button click events in the room
 */

let isMicOn = false;
let isCameraOn = false;
let isRecording = false; // Start with recording on
let peopleListVisible = true; // Default to visible
let isHandRaised = false;

const usersSidebar = document.getElementById('users-sidebar');

// Initialize all button handlers
function initButtons() {
  initMicrophoneButton();
  initCameraButton();
  initRecordingButton();
  initShareButton();
  initRaiseHandButton();
  initReactionButton();
  initPeopleButton();
  initToggleUIButton();
  initFullscreenButton();
  initSettingsButton();
  initLeaveButton();
}

// Toggle microphone
function initMicrophoneButton() {
  const micBtn = document.getElementById('mic-btn');
  const micIcon = micBtn ? micBtn.querySelector('img') : null;

  if (micBtn && micIcon) {
    micBtn.addEventListener('click', async function() {
      if (!isMicOn) {
        // Request microphone permission and start mic
        const success = await window.MediaModule?.requestMicrophonePermission();
        if (success) {
          isMicOn = true;
          window.MediaModule?.toggleMicrophone(isMicOn);
          this.classList.remove('off');
          micIcon.src = '../assets/icons/mic.svg';
          window.UsersModule?.setAudioOn?.(localStorage.getItem('userId'), true);
          console.log('Microphone turned ON');
        }
      } else {
        // Stop microphone completely (releases hardware, turns off indicator)
        isMicOn = false;
        window.MediaModule?.toggleMicrophone(isMicOn);
        this.classList.add('off');
        micIcon.src = '../assets/icons/mic-off.svg';
        window.UsersModule?.setAudioOn?.(localStorage.getItem('userId'), false);
        console.log('Microphone turned OFF');
      }
    });
  }
}

// Toggle camera
function initCameraButton() {
  const cameraBtn = document.getElementById('camera-btn');
  const cameraIcon = cameraBtn ? cameraBtn.querySelector('img') : null;

  if (cameraBtn && cameraIcon) {
    cameraBtn.addEventListener('click', async function() {
      if (!isCameraOn) {
        // Request camera permission and start camera
        const success = await window.MediaModule?.requestCameraPermission();
        if (success) {
          isCameraOn = true;
          // Toggle camera to broadcast to SFU
          window.MediaModule?.toggleCamera(isCameraOn);
          this.classList.remove('off');
          cameraIcon.src = '../assets/icons/camera.svg';
          window.UsersModule?.setVideoOn?.(localStorage.getItem('userId'), true);
          console.log('Camera turned ON');
        }
      } else {
        // Stop camera completely (releases hardware, turns off camera light)
        window.MediaModule?.stopCamera();
        isCameraOn = false;
        this.classList.add('off');
        cameraIcon.src = '../assets/icons/camera-off.svg';
        window.UsersModule?.setVideoOn?.(localStorage.getItem('userId'), false);
        console.log('Camera turned OFF');
      }
    });
  }
}

// Toggle recording
function initRecordingButton() {
  const recordingBtn = document.getElementById('recording-btn');
  if (!recordingBtn) return;
  
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
}

// Share screen
function initShareButton() {
  const shareBtn = document.getElementById('share-btn');
  if (!shareBtn) return;
  
  shareBtn.addEventListener('click', async function() {
    console.log('Share screen clicked');

    if (!window.MediaModule?.startScreenShare || !window.MediaModule?.stopScreenShare) {
      console.warn('[Buttons] MediaModule screen share APIs not available');
      return;
    }

    const currentlySharing = !!window.MediaModule.isScreenSharing?.();

    if (!currentlySharing) {
      await window.MediaModule.startScreenShare();
    } else {
      window.MediaModule.stopScreenShare();
    }
  });
}

// Toggle raise hand
function initRaiseHandButton() {
  const raiseHandBtn = document.getElementById('raise-hand-btn');
  if (!raiseHandBtn) return;

  raiseHandBtn.addEventListener('click', function() {
    isHandRaised = !isHandRaised;
    
    // Toggle button active state (yellow)
    this.classList.toggle('hand-raised', isHandRaised);
    
    // Get socket and room info
    const socket = window.SocketHandler?.getSocket();
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = localStorage.getItem('userId');
    
    if (socket && roomId && userId) {
      // Emit to server
      socket.emit('toggle-handsup', {
        roomId,
        userId,
        handsUp: isHandRaised
      });
      console.log(`Hand ${isHandRaised ? 'raised' : 'lowered'}`);
    }
  });
}

// Emoji reaction
function initReactionButton() {
  const reactionBtn = document.getElementById('reaction-btn');
  const emojiPicker = document.getElementById('emoji-picker');
  if (!reactionBtn || !emojiPicker) return;

  // Toggle emoji picker on button click
  reactionBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    emojiPicker.classList.toggle('show');
  });

  // Handle emoji selection
  emojiPicker.addEventListener('click', function(e) {
    const emojiItem = e.target.closest('.emoji-item');
    if (!emojiItem) return;

    const emoji = emojiItem.dataset.emoji;
    if (!emoji) return;

    // Close picker
    emojiPicker.classList.remove('show');

    // Get socket and room info
    const socket = window.SocketHandler?.getSocket();
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = localStorage.getItem('userId');

    if (socket && roomId && userId) {
      // Emit to server
      socket.emit('emoji-reaction', {
        roomId,
        userId,
        emoji
      });
      console.log(`Sent emoji reaction: ${emoji}`);
    }
  });

  // Close picker when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.emoji-picker') && !e.target.closest('#reaction-btn')) {
      emojiPicker.classList.remove('show');
    }
  });
}

// Show floating emoji animation
function showFloatingEmoji(emoji) {
  const container = document.getElementById('emoji-reactions-container');
  if (!container) return;

  const emojiEl = document.createElement('span');
  emojiEl.className = 'floating-emoji';
  emojiEl.textContent = emoji;

  // Random horizontal position (10% to 90% of container width)
  const randomX = 10 + Math.random() * 80;
  emojiEl.style.left = `${randomX}%`;

  container.appendChild(emojiEl);

  // Remove element after animation completes
  emojiEl.addEventListener('animationend', () => {
    emojiEl.remove();
  });
}

// Check if device is mobile
function isMobileDevice() {
  return window.innerWidth <= 480;
}

// Show/hide participants
function initPeopleButton() {
  const peopleBtn = document.getElementById('people-btn');
  if (!peopleBtn) return;
  
  // Hide people list by default on mobile
  if (isMobileDevice()) {
    peopleListVisible = false;
    if (usersSidebar) {
      usersSidebar.classList.add('hidden');
    }
  } else {
    // Show by default on desktop
    peopleListVisible = true;
    peopleBtn.classList.add('active');
  }
  
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
}

// Toggle auto-hide
function initToggleUIButton() {
  const toggleUiBtn = document.getElementById('toggle-ui-btn');
  if (!toggleUiBtn) return;
  
  toggleUiBtn.addEventListener('click', function() {
    const autoHideEnabled = window.UIControls.getAutoHideEnabled();
    const newState = !autoHideEnabled;
    
    window.UIControls.setAutoHideEnabled(newState);
    
    if (!newState) {
      // Pin controls - keep them visible
      this.classList.add('active');
      console.log('Controls pinned - auto-hide disabled');
    } else {
      // Unpin - resume auto-hide
      this.classList.remove('active');
      console.log('Controls unpinned - auto-hide enabled');
    }
  });
  
  // Set toggle-ui button to active by default (pinned)
  toggleUiBtn.classList.add('active');
}

// Toggle fullscreen
function initFullscreenButton() {
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const fullscreenIcon = fullscreenBtn ? fullscreenBtn.querySelector('img') : null;

  function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement && 
        !document.mozFullScreenElement && !document.msFullscreenElement) {
      // Enter fullscreen
      const element = document.documentElement;
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  function updateFullscreenIcon() {
    if (!fullscreenIcon) return;
    
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || 
                            document.mozFullScreenElement || document.msFullscreenElement);
    
    if (isFullscreen) {
      fullscreenIcon.src = '../assets/icons/fullscreen-exit.svg';
      fullscreenBtn.title = 'Exit Fullscreen';
    } else {
      fullscreenIcon.src = '../assets/icons/fullscreen.svg';
      fullscreenBtn.title = 'Toggle Fullscreen';
    }
  }

  if (fullscreenBtn && fullscreenIcon) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
    document.addEventListener('mozfullscreenchange', updateFullscreenIcon);
    document.addEventListener('MSFullscreenChange', updateFullscreenIcon);
    
    // Update icon on page load
    updateFullscreenIcon();
  }
}

// Settings button
function initSettingsButton() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function() {
      // TODO: Implement settings functionality
      console.log('Settings clicked');
    });
  }
}

// Leave meeting
function initLeaveButton() {
  const leaveBtn = document.getElementById('leave-btn');
  if (!leaveBtn) return;
  
  leaveBtn.addEventListener('click', function() {
    console.log('Leaving meeting...');
    
    // Stop all media streams
    window.MediaModule?.stopAllMedia();
    
    // Notify server that user is leaving
    const socket = window.SocketHandler.getSocket();
    const currentRoomId = window.SocketHandler.getCurrentRoomId();
    const userId = window.SocketHandler.getUserId();
    
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
}

// Export functions to global scope
window.ButtonsModule = {
  initButtons,
  getMicState: () => isMicOn,
  getCameraState: () => isCameraOn,
  getRecordingState: () => isRecording,
  setMicState: (state) => { isMicOn = state; },
  setCameraState: (state) => { isCameraOn = state; },
  showFloatingEmoji
};