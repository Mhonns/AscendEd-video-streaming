/**
 * Buttons Module
 * Handles all button click events in the room
 */

let isMicOn = false;
let isCameraOn = false;
let peopleListVisible = true; // Default to visible
let isHandRaised = false;

const usersSidebar = document.getElementById('users-sidebar');

/**
 * Emit the complete current media state to server so it can persist and
 * broadcast to all users in the room.  Call this whenever mic, camera, or
 * screen-share status changes locally.
 */
function emitMediaUpdate() {
  const socket = window.SocketHandler?.getSocket();
  const roomId = window.SocketHandler?.getCurrentRoomId();
  const userId = localStorage.getItem('userId');
  if (!socket || !roomId || !userId) return;

  socket.emit('request-media-update', {
    roomId,
    userId,
    audioOn: isMicOn,
    videoOn: isCameraOn,
    screenOn: !!(window.MediaModule?.isScreenSharing?.())
  });
}

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
  initMicCameraTest();
}

// Toggle microphone
function initMicrophoneButton() {
  const micBtn = document.getElementById('mic-btn');
  const micIcon = micBtn ? micBtn.querySelector('img') : null;

  if (micBtn && micIcon) {
    micBtn.addEventListener('click', async function () {
      if (!isMicOn) {
        // Request microphone permission and start mic
        const success = await window.MediaModule?.requestMicrophonePermission();
        if (success) {
          isMicOn = true;
          window.MediaModule?.toggleMicrophone(isMicOn);
          this.classList.remove('off');
          micIcon.src = '../assets/icons/mic.svg';
          emitMediaUpdate();
          console.log('Microphone turned ON');
        }
      } else {
        // Stop microphone completely (releases hardware, turns off indicator)
        isMicOn = false;
        window.MediaModule?.toggleMicrophone(isMicOn);
        this.classList.add('off');
        micIcon.src = '../assets/icons/mic-off.svg';
        emitMediaUpdate();
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
    cameraBtn.addEventListener('click', async function () {
      if (!isCameraOn) {
        // Request camera permission and start camera
        const success = await window.MediaModule?.requestCameraPermission();
        if (success) {
          isCameraOn = true;
          // Toggle camera to broadcast to SFU
          window.MediaModule?.toggleCamera(isCameraOn);
          this.classList.remove('off');
          cameraIcon.src = '../assets/icons/camera.svg';
          emitMediaUpdate();
          console.log('Camera turned ON');
        }
      } else {
        // Stop camera completely (releases hardware, turns off camera light)
        window.MediaModule?.stopCamera();
        isCameraOn = false;
        this.classList.add('off');
        cameraIcon.src = '../assets/icons/camera-off.svg';
        emitMediaUpdate();
        console.log('Camera turned OFF');
      }
    });
  }
}

// Toggle recording
function initRecordingButton() {
  const recordingBtn = document.getElementById('recording-btn');
  if (!recordingBtn) return;

  recordingBtn.addEventListener('click', async function () {
    // Disable during async call to prevent double-clicks
    recordingBtn.disabled = true;

    if (!window.RecordingModule.isActive()) {
      // Start recording — UI updates come via 'recording-started' socket event
      const ok = await window.RecordingModule.startRecording();
      if (!ok) {
        // Re-enable on failure (success re-enables via onRecordingStarted)
        recordingBtn.disabled = false;
      }
    } else {
      // Stop recording — UI updates come via 'recording-stopped' socket event
      const ok = await window.RecordingModule.stopRecording();
      if (!ok) {
        recordingBtn.disabled = false;
      }
    }
  });
}

// Share screen
function initShareButton() {
  const shareBtn = document.getElementById('share-btn');
  if (!shareBtn) return;

  shareBtn.addEventListener('click', async function () {
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

  raiseHandBtn.addEventListener('click', function () {
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
  reactionBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    emojiPicker.classList.toggle('show');
  });

  // Handle emoji selection
  emojiPicker.addEventListener('click', function (e) {
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
  document.addEventListener('click', function (e) {
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

  peopleBtn.addEventListener('click', function () {
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

  toggleUiBtn.addEventListener('click', function () {
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
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings-btn');

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', function () {
      settingsModal.classList.add('show');

      // Show/hide admin section based on host status
      const isHost = typeof window.RecordingModule?.isHost === 'function' ? window.RecordingModule.isHost() : false;
      const adminSection = document.getElementById('admin-settings-section');
      if (adminSection) {
        adminSection.style.display = isHost ? 'flex' : 'none';
      }

      // Load persisted settings into the room modal each time it opens
      _loadRoomSettings();
    });
  }

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', function () {
      settingsModal.classList.remove('show');
      stopMicCameraTest();
      const testBtnEl = document.getElementById('test-mic-camera-btn');
      if (testBtnEl) testBtnEl.textContent = 'Test';
    });
  }

  if (settingsModal) {
    settingsModal.addEventListener('click', function (e) {
      if (e.target === settingsModal) {
        settingsModal.classList.remove('show');
        stopMicCameraTest();
        const testBtnEl = document.getElementById('test-mic-camera-btn');
        if (testBtnEl) testBtnEl.textContent = 'Test';
      }
    });
  }

  // Attach persistent change listeners (only once, on init)
  _attachRoomSettingsListeners();
}

/** Populate all room-settings controls from AppSettings */
function _loadRoomSettings() {
  if (!window.AppSettings) return;
  const s = window.AppSettings.getAll();

  _setToggle('settings-noise-cancelling', s.noiseCancelling);
  _setToggle('settings-auto-recording', s.autoRecording);
  _setToggle('settings-optimize-video', s.optimizeVideoStreaming);
  _setToggle('settings-password-toggle', s.passwordEnabled);
  _setToggle('settings-force-mute', s.forceMute);
  _setToggle('settings-force-camera', s.forceCloseCamera);
  _setToggle('settings-disable-chat', s.disableChat);
  _setToggle('settings-disable-emoji', s.disableEmoji);

  const maxUserInput = document.getElementById('settings-max-user');
  if (maxUserInput) maxUserInput.value = s.maxUser;

  const passwordInputContainer = document.getElementById('password-input-container');
  const passwordInput = document.getElementById('room-password-input');
  if (passwordInputContainer && passwordInput) {
    if (s.passwordEnabled) {
      passwordInputContainer.style.display = 'flex';
      passwordInput.value = s.roomPassword || '';
    } else {
      passwordInputContainer.style.display = 'none';
    }
  }
}

function _setToggle(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

/** Wire every room settings control to AppSettings (runs once on init) */
function _attachRoomSettingsListeners() {
  if (!window.AppSettings) return;

  function bindToggle(id, key, onChangeFn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      window.AppSettings.set(key, this.checked);
      console.log(`[Settings] ${key} = ${this.checked}`);
      if (onChangeFn) onChangeFn(this.checked);
    });
  }

  function bindInput(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const save = () => {
      const val = el.type === 'number' ? Number(el.value) : el.value;
      window.AppSettings.set(key, val);
    };
    el.addEventListener('input', save);
    el.addEventListener('change', save);
  }

  // Voice & Video — noise cancelling is "Developing" / disabled; persist anyway
  bindToggle('settings-noise-cancelling', 'noiseCancelling');

  // Room
  bindToggle('settings-auto-recording', 'autoRecording', (enabled) => {
    // Trigger/stop recording immediately when toggled inside a live room
    if (enabled && !window.RecordingModule?.isActive?.()) {
      window.RecordingModule?.startRecording?.();
    } else if (!enabled && window.RecordingModule?.isActive?.()) {
      window.RecordingModule?.stopRecording?.();
    }
  });

  bindToggle('settings-optimize-video', 'optimizeVideoStreaming');

  bindToggle('settings-password-toggle', 'passwordEnabled', (checked) => {
    const passwordInputContainer = document.getElementById('password-input-container');
    const passwordInput = document.getElementById('room-password-input');
    if (passwordInputContainer && passwordInput) {
      if (checked) {
        passwordInputContainer.style.display = 'flex';
        if (!passwordInput.value) {
          const generated = Math.random().toString(36).substring(2, 10);
          passwordInput.value = generated;
          window.AppSettings.set('roomPassword', generated);
        }
      } else {
        passwordInputContainer.style.display = 'none';
      }
    }
  });

  bindInput('room-password-input', 'roomPassword');
  bindInput('settings-max-user', 'maxUser');

  // Admin
  bindToggle('settings-force-mute', 'forceMute', (enabled) => {
    const socket = window.SocketHandler?.getSocket();
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = localStorage.getItem('userId');
    if (socket && roomId && userId) {
      socket.emit('admin-force-mute', { roomId, userId, enabled });
    }
  });

  bindToggle('settings-force-camera', 'forceCloseCamera', (enabled) => {
    const socket = window.SocketHandler?.getSocket();
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = localStorage.getItem('userId');
    if (socket && roomId && userId) {
      socket.emit('admin-force-camera', { roomId, userId, enabled });
    }
  });

  bindToggle('settings-disable-chat', 'disableChat', (enabled) => {
    const socket = window.SocketHandler?.getSocket();
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = localStorage.getItem('userId');
    if (socket && roomId && userId) {
      // Server will verify host status then broadcast to ALL users (including host)
      // _applyDisableChat in socket-handler.js handles the local UI update for everyone
      socket.emit('admin-disable-chat', { roomId, userId, enabled });
    }
  });

  bindToggle('settings-disable-emoji', 'disableEmoji', (enabled) => {
    const socket = window.SocketHandler?.getSocket();
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = localStorage.getItem('userId');
    if (socket && roomId && userId) {
      // Server will verify host status then broadcast to ALL users (including host)
      // _applyDisableEmoji in socket-handler.js handles the local UI update for everyone
      socket.emit('admin-disable-emoji', { roomId, userId, enabled });
    }
  });
}


// Leave meeting
function initLeaveButton() {
  const leaveBtn = document.getElementById('leave-btn');
  if (!leaveBtn) return;

  leaveBtn.addEventListener('click', function () {
    console.log('Leaving meeting...');

    // Stop media test if still running
    stopMicCameraTest();

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

// ─── Local Mic / Camera Test ───────────────────────────────────────────────
let _testStream = null;
let _testAudioCtx = null;
let _testAnimFrame = null;

function initMicCameraTest() {
  const testBtn = document.getElementById('test-mic-camera-btn');
  const stopBtn = document.getElementById('test-mic-camera-stop-btn');
  if (!testBtn) return;

  testBtn.addEventListener('click', async () => {
    // If already testing, stop first
    stopMicCameraTest();

    testBtn.disabled = true;
    testBtn.textContent = 'Starting…';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      _testStream = stream;

      // Show camera preview
      const video = document.getElementById('test-video');
      if (video) {
        video.srcObject = stream;
      }

      // Volume meter + local echo via Web Audio
      const fill = document.getElementById('test-volume-fill');
      if (fill) {
        _testAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = _testAudioCtx.createMediaStreamSource(stream);
        const analyser = _testAudioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(_testAudioCtx.destination); // echo mic to speakers
        const data = new Uint8Array(analyser.frequencyBinCount);

        function tick() {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((s, v) => s + v, 0) / data.length;
          fill.style.width = Math.min(avg * 2, 100) + '%';
          _testAnimFrame = requestAnimationFrame(tick);
        }
        tick();
      }

      // Expand panel
      const panel = document.getElementById('mic-camera-test-panel');
      if (panel) panel.classList.add('open');

      testBtn.textContent = 'Restart';
      testBtn.disabled = false;

    } catch (err) {
      console.error('[MicCamTest] Error:', err);
      alert('Could not access camera/microphone. Please check your permissions.');
      testBtn.textContent = 'Test';
      testBtn.disabled = false;
    }
  });

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      stopMicCameraTest();
      const testBtnEl = document.getElementById('test-mic-camera-btn');
      if (testBtnEl) testBtnEl.textContent = 'Test';
    });
  }
}

function stopMicCameraTest() {
  // Cancel volume animation
  if (_testAnimFrame) {
    cancelAnimationFrame(_testAnimFrame);
    _testAnimFrame = null;
  }

  // Close AudioContext
  if (_testAudioCtx) {
    _testAudioCtx.close().catch(() => { });
    _testAudioCtx = null;
  }

  // Stop all test tracks
  if (_testStream) {
    _testStream.getTracks().forEach(t => t.stop());
    _testStream = null;
  }

  // Clear video
  const video = document.getElementById('test-video');
  if (video) video.srcObject = null;

  // Reset volume bar
  const fill = document.getElementById('test-volume-fill');
  if (fill) fill.style.width = '0%';

  // Collapse panel
  const panel = document.getElementById('mic-camera-test-panel');
  if (panel) panel.classList.remove('open');
}

// Export functions to global scope
window.ButtonsModule = {
  initButtons,
  getMicState: () => isMicOn,
  getCameraState: () => isCameraOn,
  getRecordingState: () => window.RecordingModule?.isActive?.() ?? false,
  setMicState: (state) => { isMicOn = state; },
  setCameraState: (state) => { isCameraOn = state; },
  showFloatingEmoji,
  emitMediaUpdate
};