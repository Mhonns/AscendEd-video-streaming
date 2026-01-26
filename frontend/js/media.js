const serverUrl = `streaming.nathadon.com`;
const serverPort = 5000;
const serverProtocol = 'https';

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

/**
 * Media Module
 * Handles local media stream (camera/microphone) management
 */

let localStream = null;
let isMicEnabled = false;
let isCameraEnabled = false;
let screenStream = null;

/**
 * Build the stream we should broadcast to the SFU right now.
 * - If screen sharing is active: broadcast screen video + microphone audio (if present)
 * - Otherwise: broadcast localStream (camera/mic)
 */
function getCurrentBroadcastStream() {
  // Screen share takes precedence for the outgoing video track
  if (screenStream) {
    const out = new MediaStream();

    // Add mic audio tracks if we have them
    if (localStream) {
      localStream.getAudioTracks().forEach(t => out.addTrack(t));
    }

    // Add screen video track
    const screenVideo = screenStream.getVideoTracks && screenStream.getVideoTracks()[0];
    if (screenVideo) {
      out.addTrack(screenVideo);
    }

    return out;
  }

  return localStream;
}

function broadcastCurrentToSFU() {
  if (!window.SFUBroadcastModule) return;

  const roomId = window.SocketHandler?.getCurrentRoomId();
  const userId = window.SocketHandler?.getUserId();
  if (!roomId || !userId) return;

  const streamToSend = getCurrentBroadcastStream();
  if (!streamToSend) return;

  window.SFUBroadcastModule.broadcastStream(streamToSend, roomId, userId)
    .catch(err => console.error('[Media] Broadcast failed:', err));
}

/**
 * Request microphone permission and get audio stream
 */
async function requestMicrophonePermission() {
  try {
    // If we already have a stream with audio, just enable the track
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = true;
        isMicEnabled = true;
        console.log('Microphone enabled');
        return true;
      }
    }

    // Request new audio stream
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    if (localStream) {
      // Add audio track to existing stream
      stream.getAudioTracks().forEach(track => {
        localStream.addTrack(track);
      });
    } else {
      localStream = stream;
    }
    
    isMicEnabled = true;
    console.log('Microphone permission granted');
    return true;
  } catch (error) {
    console.error('Error requesting microphone permission:', error);
    alert('Could not access microphone. Please check your permissions.');
    return false;
  }
}

/**
 * Request camera permission and get video stream
 */
async function requestCameraPermission() {
  try {
    // If we already have a stream with video, just enable the track
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = true;
        isCameraEnabled = true;
        console.log('Camera enabled');
        // Update people frame preview (no center tile)
        displayLocalVideo();
        return true;
      }
    }

    // Request new video stream
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      } 
    });
    
    if (localStream) {
      // Add video track to existing stream
      stream.getVideoTracks().forEach(track => {
        localStream.addTrack(track);
      });
    } else {
      localStream = stream;
    }
    
    isCameraEnabled = true;
    console.log('Camera permission granted');
    // Update people frame preview (no center tile)
    displayLocalVideo();
    return true;
  } catch (error) {
    console.error('Error requesting camera permission:', error);
    alert('Could not access camera. Please check your permissions.');
    return false;
  }
}

/**
 * Toggle microphone on/off (enable/disable without stopping track)
 * Uses mute notification instead of re-broadcast for smooth audio
 */
function toggleMicrophone(enabled) {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach(track => {
      track.enabled = enabled;
    });
    isMicEnabled = enabled;
    console.log(`[Media] Microphone ${enabled ? 'enabled' : 'disabled'}`);
    
    if (enabled && !window.SFUBroadcastModule?.isBroadcasting()) {
      broadcastToSFU();
    } else {
      window.SFUBroadcastModule?.notifyMuteStatus('audio', !enabled);
    }
  }
}

/**
 * Toggle camera on/off (enable/disable without stopping track)
 * Uses mute notification instead of re-broadcast for smooth video
 */
function toggleCamera(enabled) {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
      track.enabled = enabled;
    });
    isCameraEnabled = enabled;
    
    if (enabled) {
      // Show camera preview in people frame (no center tile)
      displayLocalVideo();
      // If not broadcasting yet, start broadcast. Otherwise just notify mute status.
      if (!window.SFUBroadcastModule?.isBroadcasting()) {
        broadcastToSFU();
      } else {
        window.SFUBroadcastModule?.notifyMuteStatus('video', false);
      }
    } else {
      // Hide camera preview in people frame (no center tile)
      hideLocalVideo();
      window.SFUBroadcastModule?.notifyMuteStatus('video', true);
    }
    
    console.log(`[Media] Camera ${enabled ? 'enabled' : 'disabled'}`);
  }
}

/**
 * Start screen sharing and preview it in the main video frame (#video-grid).
 * This is independent of the camera preview (which lives in the people frame).
 */
async function startScreenShare() {
  if (screenStream) {
    return screenStream;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert('Screen sharing is not supported in this browser.');
    return null;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    // Auto-stop when user ends sharing from browser UI
    const track = screenStream.getVideoTracks && screenStream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        stopScreenShare();
      };
    }

    showScreenSharePreview(screenStream);

    const uid = localStorage.getItem('userId');
    if (uid) {
      window.UsersModule?.setScreenShareOn?.(uid, true);
    }

    // UI: make share button green while sharing (also covers the "Stop sharing" browser UI path)
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
      shareBtn.classList.add('sharing');
    }

    // Stream the screen share to SFU (screen video + mic audio if present).
    // This will "renegotiate" by recreating the broadcaster peer (see SFUBroadcastModule).
    broadcastCurrentToSFU();

    console.log('[Media] Screen sharing started');
    return screenStream;
  } catch (error) {
    console.error('[Media] Error starting screen share:', error);
    screenStream = null;
    return null;
  }
}

function stopScreenShare() {
  if (!screenStream) return;

  try {
    screenStream.getTracks().forEach(t => t.stop());
  } catch (_) {}

  screenStream = null;

  hideScreenSharePreview();

  const uid = localStorage.getItem('userId');
  if (uid) {
    window.UsersModule?.setScreenShareOn?.(uid, false);
  }

  // UI: reset share button color
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.classList.remove('sharing');
  }

  // Revert broadcast back to normal camera/mic (or stop if nothing is enabled)
  if (window.SFUBroadcastModule?.isBroadcasting?.()) {
    if ((isMicEnabled || isCameraEnabled) && localStream) {
      broadcastCurrentToSFU(); // now uses localStream since screenStream is null
    } else {
      window.SFUBroadcastModule.stopBroadcast?.();
    }
  }

  console.log('[Media] Screen sharing stopped');
}

function isScreenSharing() {
  return !!screenStream;
}

function showScreenSharePreview(stream) {
  const videoGrid = document.getElementById('video-grid');
  const placeholder = document.getElementById('video-placeholder');
  if (!videoGrid) return;

  if (placeholder) {
    placeholder.classList.add('hidden');
  }

  let container = document.getElementById('main-video-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'main-video-container';
    container.className = 'video-item local screenshare';
    const uid = localStorage.getItem('userId');
    if (uid) container.dataset.userId = uid;

    const videoEl = document.createElement('video');
    videoEl.id = 'main-video';
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = 'You (Screen)';

    container.appendChild(videoEl);
    container.appendChild(label);
    videoGrid.appendChild(container);
  }

  const videoEl = document.getElementById('main-video');
  if (videoEl) {
    videoEl.srcObject = stream;
    videoEl.play?.().catch?.(() => {});
  }

  updateVideoGridLayout();
  window.UsersModule?.reorderUserItemsAndVideos?.();
}

function hideScreenSharePreview() {
  const container = document.getElementById('main-video-container');
  const videoGrid = document.getElementById('video-grid');
  const placeholder = document.getElementById('video-placeholder');

  if (container) {
    // Only clear the main-video (local screen share), leave remote-video if present
    const mainVideoEl = document.getElementById('main-video');
    if (mainVideoEl) {
      try {
        mainVideoEl.pause();
        mainVideoEl.srcObject = null;
      } catch (_) {}
      mainVideoEl.remove();
    }
    // Update label
    const label = container.querySelector('.video-label');
    if (label) label.textContent = 'Remote';
    // Remove screenshare class, keep remote if remote video exists
    container.classList.remove('local', 'screenshare');
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
      container.classList.add('remote');
    } else {
      // No remote video either, remove the whole container
      container.remove();
    }
  }

  updateVideoGridLayout();
  window.UsersModule?.reorderUserItemsAndVideos?.();

  // If there are no other video tiles left, show placeholder
  if (videoGrid && placeholder) {
    const remaining = videoGrid.querySelectorAll('.video-item');
    if (remaining.length === 0) {
      placeholder.classList.remove('hidden');
    }
  }
}

/**
 * Stop microphone completely (turns off mic, releases hardware)
 */
function stopMicrophone() {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach(track => {
      track.stop();
      localStream.removeTrack(track);
    });
    isMicEnabled = false;
    console.log('[Media] Microphone stopped and released');
  }
}

/**
 * Stop camera completely (turns off camera light, releases hardware)
 */
function stopCamera() {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
      track.stop();
      localStream.removeTrack(track);
    });
    isCameraEnabled = false;
    // Hide camera preview in people frame (no center tile)
    hideLocalVideo();
    console.log('[Media] Camera stopped and released');
  }
}

/**
 * Display local video (people frame preview only; no center/grid tile)
 */
function displayLocalVideo() {
  // Re-render people list so the local user's avatar swaps to a camera preview
  window.UsersModule?.reorderUserItemsAndVideos?.();
}

/**
 * Hide local video (people frame preview only; no center/grid tile)
 */
function hideLocalVideo() {
  // Re-render people list so the local user's camera preview swaps back to avatar
  window.UsersModule?.reorderUserItemsAndVideos?.();
}

/**
 * Toggle layout mode based on number of visible video tiles.
 * When there's only one tile (typically just local video), fill the whole video area.
 */
function updateVideoGridLayout() {
  const videoGrid = document.getElementById('video-grid');
  if (!videoGrid) return;

  const tiles = Array.from(videoGrid.querySelectorAll('.video-item'));
  // Count only visible tiles (others may be hidden by priority/selection logic)
  const visibleTiles = tiles.filter(el => el.style.display !== 'none');
  videoGrid.classList.toggle('single-video', visibleTiles.length === 1);
}

/**
 * Stop all media tracks and release stream
 */
function stopAllMedia() {
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });
    localStream = null;
    isMicEnabled = false;
    isCameraEnabled = false;
    hideLocalVideo();
    console.log('[Media] All media stopped');
  }

  // Also stop screen share if active
  stopScreenShare();
}

/**
 * Get the local stream
 */
function getLocalStream() {
  return localStream;
}

/**
 * Check if microphone is enabled
 */
function getMicEnabled() {
  return isMicEnabled;
}

/**
 * Check if camera is enabled
 */
function getCameraEnabled() {
  return isCameraEnabled;
}

/**
 * Broadcast local stream to SFU
 */
function broadcastToSFU() {
  
  if (!localStream) return;
  if (!window.SFUBroadcastModule) return;
  
  const roomId = window.SocketHandler?.getCurrentRoomId();
  const userId = window.SocketHandler?.getUserId();
  
  if (!roomId || !userId) return;
  
  window.SFUBroadcastModule.broadcastStream(localStream, roomId, userId)
    .catch(err => console.error('[Media] Broadcast failed:', err));
}

// Export module
window.MediaModule = {
  requestMicrophonePermission,
  requestCameraPermission,
  toggleMicrophone,
  toggleCamera,
  startScreenShare,
  stopScreenShare,
  isScreenSharing,
  stopMicrophone,
  stopCamera,
  displayLocalVideo,
  hideLocalVideo,
  stopAllMedia,
  getLocalStream,
  getMicEnabled,
  getCameraEnabled
};

