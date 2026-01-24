/**
 * Buttons Module
 * Handles all button click events in the room
 */

let isMicOn = false;
let isCameraOn = false;
let isRecording = false; // Start with recording on
let peopleListVisible = true; // Default to visible

const usersSidebar = document.getElementById('users-sidebar');

// Initialize all button handlers
function initButtons() {
  initMicrophoneButton();
  initCameraButton();
  initRecordingButton();
  initShareButton();
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
          console.log('Microphone turned ON');
        }
      } else {
        // Stop microphone completely (releases hardware, turns off indicator)
        isMicOn = false;
        window.MediaModule?.toggleMicrophone(isMicOn);
        this.classList.add('off');
        micIcon.src = '../assets/icons/mic-off.svg';
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
          this.classList.remove('off');
          cameraIcon.src = '../assets/icons/camera.svg';
          console.log('Camera turned ON');
        }
      } else {
        // Stop camera completely (releases hardware, turns off camera light)
        window.MediaModule?.stopCamera();
        isCameraOn = false;
        this.classList.add('off');
        cameraIcon.src = '../assets/icons/camera-off.svg';
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
  
  shareBtn.addEventListener('click', function() {
    console.log('Share screen clicked');
    // TODO: Implement screen sharing
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
  setCameraState: (state) => { isCameraOn = state; }
};