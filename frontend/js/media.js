/**
 * Media Module
 * Handles local media stream (camera/microphone) management
 */

let localStream = null;
let isMicEnabled = false;
let isCameraEnabled = false;

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
    console.log(`Microphone ${enabled ? 'enabled' : 'disabled'}`);
  }
}

/**
 * Toggle camera on/off (enable/disable without stopping track)
 */
function toggleCamera(enabled) {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
      track.enabled = enabled;
    });
    isCameraEnabled = enabled;
    
    if (enabled) {
      displayLocalVideo();
    } else {
      hideLocalVideo();
    }
    
    console.log(`Camera ${enabled ? 'enabled' : 'disabled'}`);
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
    console.log('Microphone stopped and released');
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
    hideLocalVideo();
    console.log('Camera stopped and released');
  }
}

/**
 * Display local video in the video grid
 */
function displayLocalVideo() {
  if (!localStream) return;
  
  const videoGrid = document.getElementById('video-grid');
  const placeholder = document.getElementById('video-placeholder');
  
  if (!videoGrid) return;
  
  // Hide placeholder
  if (placeholder) {
    placeholder.classList.add('hidden');
  }
  
  // Check if local video element already exists
  let localVideoContainer = document.getElementById('local-video-container');
  
  if (!localVideoContainer) {
    // Create video container
    localVideoContainer = document.createElement('div');
    localVideoContainer.id = 'local-video-container';
    localVideoContainer.className = 'video-item local';
    
    // Create video element
    const videoElement = document.createElement('video');
    videoElement.id = 'local-video';
    videoElement.autoplay = true;
    videoElement.muted = true; // Mute local video to prevent feedback
    videoElement.playsInline = true;
    
    // Create label
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = 'You';
    
    localVideoContainer.appendChild(videoElement);
    localVideoContainer.appendChild(label);
    videoGrid.appendChild(localVideoContainer);
  }
  
  // Set the stream to the video element
  const videoElement = document.getElementById('local-video');
  if (videoElement && localStream) {
    videoElement.srcObject = localStream;
  }
}

/**
 * Hide local video
 */
function hideLocalVideo() {
  const localVideoContainer = document.getElementById('local-video-container');
  const videoGrid = document.getElementById('video-grid');
  const placeholder = document.getElementById('video-placeholder');
  
  if (localVideoContainer) {
    localVideoContainer.remove();
  }
  
  // Show placeholder if no other videos
  if (videoGrid && placeholder) {
    const remainingVideos = videoGrid.querySelectorAll('.video-item');
    if (remainingVideos.length === 0) {
      placeholder.classList.remove('hidden');
    }
  }
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
    console.log('All media stopped');
  }
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

// Export module
window.MediaModule = {
  requestMicrophonePermission,
  requestCameraPermission,
  toggleMicrophone,
  toggleCamera,
  stopMicrophone,
  stopCamera,
  displayLocalVideo,
  hideLocalVideo,
  stopAllMedia,
  getLocalStream,
  getMicEnabled,
  getCameraEnabled
};

