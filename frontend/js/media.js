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
 * 
 * Stream Architecture:
 * - Audio (main): Always broadcast when mic is on
 * - Camera: Local preview + broadcast to SFU for sidebar display
 * - Screen: Broadcast to SFU for main video display
 */

let localStream = null;
let isMicEnabled = false;
let isCameraEnabled = false;
let screenStream = null;

/**
 * Get audio-only stream for broadcasting
 */
function getAudioStream() {
  if (!localStream) return null;
  
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length === 0) return null;
  
  const audioStream = new MediaStream();
  audioTracks.forEach(t => audioStream.addTrack(t));
  return audioStream;
}

/**
 * Get camera video-only stream for broadcasting
 */
function getCameraStream() {
  if (!localStream) return null;
  
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length === 0) return null;
  
  const cameraStream = new MediaStream();
  videoTracks.forEach(t => cameraStream.addTrack(t));
  return cameraStream;
}

/**
 * Broadcast audio to SFU
 */
function broadcastAudioToSFU() {
  if (!window.SFUBroadcastModule) return;
  
  const roomId = window.SocketHandler?.getCurrentRoomId();
  const userId = window.SocketHandler?.getUserId();
  if (!roomId || !userId) return;
  
  const audioStream = getAudioStream();
  if (!audioStream) return;
  
  window.SFUBroadcastModule.broadcastAudio(audioStream, roomId, userId)
    .then(() => console.log('[Media] Audio broadcast started'))
    .catch(err => console.error('[Media] Audio broadcast failed:', err));
}

/**
 * Broadcast camera to SFU
 */
function broadcastCameraToSFU() {
  if (!window.SFUBroadcastModule) return;
  
  const roomId = window.SocketHandler?.getCurrentRoomId();
  const userId = window.SocketHandler?.getUserId();
  if (!roomId || !userId) return;
  
  const cameraStream = getCameraStream();
  if (!cameraStream) return;
  
  window.SFUBroadcastModule.broadcastCamera(cameraStream, roomId, userId)
    .then(() => console.log('[Media] Camera broadcast started'))
    .catch(err => console.error('[Media] Camera broadcast failed:', err));
}

/**
 * Broadcast screen to SFU
 */
function broadcastScreenToSFU() {
  if (!window.SFUBroadcastModule) return;
  if (!screenStream) return;
  
  const roomId = window.SocketHandler?.getCurrentRoomId();
  const userId = window.SocketHandler?.getUserId();
  if (!roomId || !userId) return;
  
  window.SFUBroadcastModule.broadcastScreen(screenStream, roomId, userId)
    .then(() => console.log('[Media] Screen broadcast started'))
    .catch(err => console.error('[Media] Screen broadcast failed:', err));
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
        // Update people frame preview
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
    // Update people frame preview
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
 */
function toggleMicrophone(enabled) {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach(track => {
      track.enabled = enabled;
    });
    isMicEnabled = enabled;
    console.log(`[Media] Microphone ${enabled ? 'enabled' : 'disabled'}`);
    
    if (enabled) {
      // Start audio broadcast if not already broadcasting
      if (!window.SFUBroadcastModule?.isAudioBroadcasting?.()) {
        broadcastAudioToSFU();
      } else {
        window.SFUBroadcastModule?.notifyMuteStatus('audio', false);
      }
    } else {
      window.SFUBroadcastModule?.notifyMuteStatus('audio', true);
    }
  }
}

/**
 * Toggle camera on/off (enable/disable without stopping track)
 * Camera is shown locally AND broadcast to SFU for other users' sidebar
 */
function toggleCamera(enabled) {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
      track.enabled = enabled;
    });
    isCameraEnabled = enabled;
    
    if (enabled) {
      // 1. Show camera preview in people frame (local)
      displayLocalVideo();
      
      // 2. Broadcast camera to SFU for other users
      if (!window.SFUBroadcastModule?.isCameraBroadcasting?.()) {
        broadcastCameraToSFU();
      } else {
        window.SFUBroadcastModule?.notifyMuteStatus('video', false);
      }
    } else {
      // Hide camera preview
      hideLocalVideo();
      
      // Notify mute (don't stop broadcast, just mute the track)
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

    // Show local preview first
    showScreenSharePreview(screenStream);

    const uid = localStorage.getItem('userId');
    if (uid) {
      window.UsersModule?.setScreenShareOn?.(uid, true);
    }

    // UI: make share button green
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
      shareBtn.classList.add('sharing');
    }

    // Broadcast screen share to SFU (separate from audio and camera)
    broadcastScreenToSFU();

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

  // Stop screen broadcast (audio and camera continue separately)
  window.SFUBroadcastModule?.stopScreen?.();

  console.log('[Media] Screen sharing stopped');
}

function isScreenSharing() {
  return !!screenStream;
}

/**
 * Request a remote user to stop their screen share
 * @param {string} targetUserId - The user ID to request stop screen share from
 */
async function requestStopScreenShare(targetUserId) {
  const roomId = window.SocketHandler?.getCurrentRoomId();
  const requesterId = window.SocketHandler?.getUserId();
  
  if (!roomId || !requesterId || !targetUserId) {
    console.warn('[Media] Missing required IDs for stop screenshare request');
    return;
  }
  
  try {
    await fetch(`${serverProtocol}://${serverUrl}:${serverPort}/request-stop-screenshare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, targetUserId, requesterId })
    });
    console.log(`[Media] Requested ${targetUserId} to stop screen share`);
  } catch (err) {
    console.warn('[Media] Failed to send stop screenshare request:', err);
  }
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
    
    // Stop audio broadcast
    window.SFUBroadcastModule?.stopAudio?.();
    
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
    
    // Hide camera preview in people frame
    hideLocalVideo();
    
    // Stop camera broadcast
    window.SFUBroadcastModule?.stopCamera?.();
    
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
 */
function updateVideoGridLayout() {
  const videoGrid = document.getElementById('video-grid');
  if (!videoGrid) return;

  const tiles = Array.from(videoGrid.querySelectorAll('.video-item'));
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
  
  // Stop all SFU broadcasts
  window.SFUBroadcastModule?.stopAllBroadcasts?.();
}

/**
 * Get the local stream
 */
function getLocalStream() {
  return localStream;
}

/**
 * Get the screen share stream
 */
function getScreenStream() {
  return screenStream;
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

// Export module
window.MediaModule = {
  requestMicrophonePermission,
  requestCameraPermission,
  toggleMicrophone,
  toggleCamera,
  startScreenShare,
  stopScreenShare,
  isScreenSharing,
  requestStopScreenShare,
  stopMicrophone,
  stopCamera,
  displayLocalVideo,
  hideLocalVideo,
  stopAllMedia,
  getLocalStream,
  getScreenStream,
  getMicEnabled,
  getCameraEnabled,
  // Expose broadcast functions for external use
  broadcastAudioToSFU,
  broadcastCameraToSFU,
  broadcastScreenToSFU
};
