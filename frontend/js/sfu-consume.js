/**
 * SFU Consume Module (client)
 * Creates a "recvonly" RTCPeerConnection and POSTs an SDP offer to the SFU /consumer endpoint
 * to consume streams from other users in the room.
 * 
 * Stream Types:
 * - main: audio only → played through audio element
 * - screen: screen share video → displayed in main video grid
 * - camera: camera video → displayed in user-media element (sidebar)
 */

// Store consumer peer for cleanup
let consumerPeer = null;

// Map streamId -> metadata { oderId (the broadcaster's userId), streamType }
const streamMetadataMap = new Map();

// Track current screen share broadcaster
let currentScreenBroadcasterId = null;

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`);
  }

  return await res.json();
}

/**
 * Store stream metadata for later lookup
 */
function setStreamMetadata(streamId, metadata) {
  streamMetadataMap.set(streamId, metadata);
  console.log(`[SFUConsumeModule] Stored metadata for stream ${streamId}:`, metadata);
}

/**
 * Get stream metadata by streamId
 */
function getStreamMetadata(streamId) {
  return streamMetadataMap.get(streamId);
}

/**
 * Clear all stream metadata
 */
function clearStreamMetadata() {
  streamMetadataMap.clear();
}

/**
 * Call this after the user joins a room to consume existing streams.
 * Returns the created RTCPeerConnection for later ICE wiring / cleanup.
 */
async function requestConsumeCurrentStreams(roomId, userId) {
  if (!roomId || !userId) {
    throw new Error('[SFUConsumeModule] roomId and userId are required');
  }

  // Close existing consumer peer if any
  if (consumerPeer) {
    try { consumerPeer.close(); } catch (_) {}
  }

  // Clear previous metadata
  clearStreamMetadata();

  const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
  consumerPeer = peer;

  // Handle incoming tracks from broadcasters
  peer.ontrack = (event) => {
    const track = event.track;
    const stream = event.streams[0];
    const streamId = stream?.id;
    
    console.log(`[SFUConsumeModule] Received track: kind=${track.kind}, streamId=${streamId}`);
    
    // Look up metadata for this stream
    const metadata = getStreamMetadata(streamId);
    
    if (metadata) {
      handleTrackWithMetadata(track, stream, metadata);
    } else {
      // Fallback: handle based on track kind alone
      console.warn(`[SFUConsumeModule] No metadata for stream ${streamId}, using fallback`);
      handleTrackFallback(track, stream);
    }
  };

  // Add multiple transceivers for receiving different stream types
  // We may receive: audio (main), video (screen), video (camera) from multiple users
  peer.addTransceiver('audio', { direction: 'recvonly' });
  peer.addTransceiver('video', { direction: 'recvonly' });
  peer.addTransceiver('video', { direction: 'recvonly' }); // Second video for camera

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  const payload = {
    sdp: peer.localDescription,
    roomId,
    userId
  };

  const url = `${serverProtocol}://${serverUrl}:${serverPort}/consumer`;
  const answerPayload = await postJson(url, payload);
  
  if (!answerPayload || !answerPayload.sdp) {
    throw new Error('[SFUConsumeModule] Invalid /consumer response');
  }
  
  // Store stream metadata from server response
  if (answerPayload.streamMetadata && Array.isArray(answerPayload.streamMetadata)) {
    answerPayload.streamMetadata.forEach(meta => {
      setStreamMetadata(meta.streamId, {
        oderId: meta.oderId,
        streamType: meta.streamType
      });
    });
  }
  
  await peer.setRemoteDescription(new RTCSessionDescription(answerPayload.sdp));
  console.log('[SFUConsumeModule] Consumer SDP exchange completed');
  
  return peer;
}

/**
 * Handle track with known metadata
 */
function handleTrackWithMetadata(track, stream, metadata) {
  const { oderId, streamType } = metadata;
  
  console.log(`[SFUConsumeModule] Handling ${streamType} track from ${oderId}`);
  
  switch (streamType) {
    case 'main':
      // Audio stream
      if (track.kind === 'audio') {
        playRemoteAudio(stream, oderId);
      }
      break;
      
    case 'screen':
      // Screen share video
      if (track.kind === 'video') {
        displayRemoteScreenShare(stream, oderId);
      }
      break;
      
    case 'camera':
      // Camera video for sidebar
      if (track.kind === 'video') {
        displayRemoteCameraInSidebar(stream, oderId);
      }
      break;
      
    default:
      console.warn(`[SFUConsumeModule] Unknown stream type: ${streamType}`);
      handleTrackFallback(track, stream);
  }
}

/**
 * Fallback handler when no metadata is available
 */
function handleTrackFallback(track, stream) {
  if (track.kind === 'audio') {
    playRemoteAudio(stream, null);
  } else if (track.kind === 'video') {
    // Default to screen share display
    displayRemoteScreenShare(stream, null);
  }
}

/**
 * Play remote audio stream
 */
function playRemoteAudio(stream, oderId) {
  const streamId = stream.id;
  const audioId = oderId ? `remote-audio-${oderId}` : `remote-audio-${streamId}`;
  
  let audioEl = document.getElementById(audioId);
  
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = audioId;
    audioEl.autoplay = true;
    audioEl.dataset.oderId = oderId || '';
    document.body.appendChild(audioEl);
  }
  
  // Clear old data first
  audioEl.pause();
  audioEl.srcObject = null;
  audioEl.load();
  
  // Set new stream
  audioEl.srcObject = stream;
  audioEl.play().catch(err => console.warn('[SFUConsumeModule] Audio play failed:', err));
  
  console.log(`[SFUConsumeModule] Playing audio from ${oderId || streamId}`);
}

/**
 * Display remote screen share in main video grid
 */
function displayRemoteScreenShare(stream, oderId) {
  const videoGrid = document.getElementById('video-grid');
  const placeholder = document.getElementById('video-placeholder');
  if (!videoGrid) return;

  if (placeholder) {
    placeholder.classList.add('hidden');
  }

  currentScreenBroadcasterId = oderId;

  // Get or create the main-video-container
  let container = document.getElementById('main-video-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'main-video-container';
    container.className = 'video-item remote screen';
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = getBroadcasterName(oderId) + ' (Screen)';

    container.appendChild(label);
    videoGrid.appendChild(container);
  }

  container.classList.add('remote', 'screen');
  container.dataset.oderId = oderId || '';

  // Update label
  const label = container.querySelector('.video-label');
  if (label) {
    label.textContent = getBroadcasterName(oderId) + ' (Screen)';
  }

  // Create or get the remote-video element
  let videoEl = document.getElementById('remote-video');
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.id = 'remote-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    const labelEl = container.querySelector('.video-label');
    container.insertBefore(videoEl, labelEl);
  }

  videoEl.srcObject = stream;
  console.log(`[SFUConsumeModule] Displaying screen share from ${oderId}`);
  
  // Update layout
  updateVideoGridLayout();
}

/**
 * Display remote camera in the user's sidebar element (user-media)
 */
function displayRemoteCameraInSidebar(stream, oderId) {
  if (!oderId) {
    console.warn('[SFUConsumeModule] Cannot display camera without oderId');
    return;
  }
  
  // Find the user-item element for this user
  const userItem = document.querySelector(`.user-item[data-user-id="${oderId}"]`);
  if (!userItem) {
    console.warn(`[SFUConsumeModule] User item not found for ${oderId}`);
    // Store stream for later when user item is created
    pendingCameraStreams.set(oderId, stream);
    return;
  }
  
  // Find or create the user-media element
  let userMedia = userItem.querySelector('.user-media');
  if (!userMedia) {
    userMedia = document.createElement('div');
    userMedia.className = 'user-media';
    
    // Insert before user-info or at the start
    const userInfo = userItem.querySelector('.user-info');
    if (userInfo) {
      userItem.insertBefore(userMedia, userInfo);
    } else {
      userItem.prepend(userMedia);
    }
  }
  
  // Create or get video element
  let videoEl = userMedia.querySelector('video');
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.muted = true; // Mute camera video (audio comes from main stream)
    videoEl.playsInline = true;
    videoEl.className = 'user-camera-video';
    userMedia.appendChild(videoEl);
  }
  
  videoEl.srcObject = stream;
  
  // Hide avatar, show video
  const avatar = userItem.querySelector('.user-avatar');
  if (avatar) {
    avatar.style.display = 'none';
  }
  userMedia.style.display = 'block';
  
  // Mark user as having camera on
  window.UsersModule?.setVideoOn?.(oderId, true);
  
  console.log(`[SFUConsumeModule] Displaying camera in sidebar for ${oderId}`);
}

// Store pending camera streams for users not yet in DOM
const pendingCameraStreams = new Map();

/**
 * Check and apply pending camera stream for a user
 * Call this when a new user-item is added to the DOM
 */
function applyPendingCameraStream(oderId) {
  const stream = pendingCameraStreams.get(oderId);
  if (stream) {
    displayRemoteCameraInSidebar(stream, oderId);
    pendingCameraStreams.delete(oderId);
  }
}

/**
 * Remove remote camera from sidebar
 */
function removeRemoteCameraFromSidebar(oderId) {
  const userItem = document.querySelector(`.user-item[data-user-id="${oderId}"]`);
  if (!userItem) return;
  
  const userMedia = userItem.querySelector('.user-media');
  if (userMedia) {
    const videoEl = userMedia.querySelector('video');
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.srcObject = null;
      } catch (_) {}
      videoEl.remove();
    }
    userMedia.style.display = 'none';
  }
  
  // Show avatar again
  const avatar = userItem.querySelector('.user-avatar');
  if (avatar) {
    avatar.style.display = '';
  }
  
  // Clear pending stream if any
  pendingCameraStreams.delete(oderId);
  
  console.log(`[SFUConsumeModule] Removed camera from sidebar for ${oderId}`);
}

/**
 * Get the broadcaster's display name from UsersModule
 */
function getBroadcasterName(oderId) {
  if (!oderId) return 'Remote';
  
  const users = window.UsersModule?.getUsersList?.() || [];
  const broadcaster = users.find(u => u.oderId === oderId);
  return broadcaster?.name || 'Remote';
}

/**
 * Remove remote screen share when broadcaster stops sharing
 */
function removeRemoteScreenShare(oderId) {
  // Only remove if it matches the current screen broadcaster
  if (oderId && currentScreenBroadcasterId && oderId !== currentScreenBroadcasterId) {
    return;
  }
  
  const videoEl = document.getElementById('remote-video');
  if (videoEl) {
    try {
      videoEl.pause();
      videoEl.srcObject = null;
    } catch (_) {}
    videoEl.remove();
  }
  
  // Clean up the container if it's only for remote video (not local screen share)
  const container = document.getElementById('main-video-container');
  if (container && !container.classList.contains('screenshare')) {
    container.remove();
  }
  
  // Show placeholder if no videos left
  const videoGrid = document.getElementById('video-grid');
  const placeholder = document.getElementById('video-placeholder');
  if (videoGrid && placeholder) {
    const remaining = videoGrid.querySelectorAll('.video-item');
    if (remaining.length === 0) {
      placeholder.classList.remove('hidden');
    }
  }
  
  currentScreenBroadcasterId = null;
  
  console.log(`[SFUConsumeModule] Remote screen share removed`);
  updateVideoGridLayout();
}

/**
 * Remove all remote audio for a user
 */
function removeRemoteAudio(oderId) {
  const audioEl = document.getElementById(`remote-audio-${oderId}`);
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.srcObject = null;
    } catch (_) {}
    audioEl.remove();
  }
  console.log(`[SFUConsumeModule] Remote audio removed for ${oderId}`);
}

/**
 * Handle stream stopped event from server
 */
function handleStreamStopped(oderId, streamType) {
  console.log(`[SFUConsumeModule] Stream stopped: ${oderId} ${streamType}`);
  
  switch (streamType) {
    case 'main':
      removeRemoteAudio(oderId);
      break;
    case 'screen':
      removeRemoteScreenShare(oderId);
      break;
    case 'camera':
      removeRemoteCameraFromSidebar(oderId);
      break;
  }
}

/**
 * Remove all streams for a user (when they leave)
 */
function removeAllUserStreams(oderId) {
  removeRemoteAudio(oderId);
  removeRemoteScreenShare(oderId);
  removeRemoteCameraFromSidebar(oderId);
  
  // Clear from metadata map
  streamMetadataMap.forEach((meta, streamId) => {
    if (meta.oderId === oderId) {
      streamMetadataMap.delete(streamId);
    }
  });
}

/**
 * Legacy function - remove remote video (for backward compatibility)
 */
function removeRemoteVideo() {
  removeRemoteScreenShare(null);
  
  // Also remove all audio
  document.querySelectorAll('audio[id^="remote-audio-"]').forEach(audioEl => {
    try {
      audioEl.pause();
      audioEl.srcObject = null;
    } catch (_) {}
    audioEl.remove();
  });
}

/**
 * Update video grid layout
 */
function updateVideoGridLayout() {
  const videoGrid = document.getElementById('video-grid');
  if (!videoGrid) return;

  const tiles = Array.from(videoGrid.querySelectorAll('.video-item'));
  const visibleTiles = tiles.filter(el => el.style.display !== 'none');
  videoGrid.classList.toggle('single-video', visibleTiles.length === 1);
}

/**
 * Legacy function - set broadcaster userId (for backward compatibility)
 */
function setBroadcasterUserId(oderId) {
  currentScreenBroadcasterId = oderId;
}

/**
 * Legacy function - update remote video label
 */
function updateRemoteVideoLabel() {
  const container = document.getElementById('main-video-container');
  if (!container) return;
  
  const label = container.querySelector('.video-label');
  if (label && container.classList.contains('remote')) {
    const name = getBroadcasterName(currentScreenBroadcasterId);
    if (container.classList.contains('screen')) {
      label.textContent = name + ' (Screen)';
    } else {
      label.textContent = name;
    }
  }
}

/**
 * Get the consumer peer connection
 */
function getConsumerPeer() {
  return consumerPeer;
}

window.SFUConsumeModule = {
  // Main functions
  requestConsumeCurrentStreams,
  getConsumerPeer,
  
  // Stream metadata
  setStreamMetadata,
  getStreamMetadata,
  
  // Stream type handlers
  handleStreamStopped,
  removeAllUserStreams,
  
  // Camera in sidebar
  displayRemoteCameraInSidebar,
  removeRemoteCameraFromSidebar,
  applyPendingCameraStream,
  
  // Screen share in main grid
  displayRemoteScreenShare,
  removeRemoteScreenShare,
  
  // Audio
  playRemoteAudio,
  removeRemoteAudio,
  
  // Legacy functions
  setBroadcasterUserId,
  updateRemoteVideoLabel,
  removeRemoteVideo
};
