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

// Registry of all active screen shares: [{ oderId, stream }] ordered by arrival
const activeScreenShares = [];
let currentScreenShareIndex = 0;

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
    try { consumerPeer.close(); } catch (_) { }
  }

  // Clear stream metadata (will be repopulated from server answer).
  // Do NOT wipe activeScreenShares here — we reconcile it after we get the
  // server answer so existing entries survive mid-session re-consumes.
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

  // Auto-reconnect: when the consumer peer drops, re-consume after a short delay
  peer.oniceconnectionstatechange = () => {
    const state = peer.iceConnectionState;
    console.log(`[SFUConsumeModule] ICE connection state: ${state}`);

    if (state === 'disconnected' || state === 'failed') {
      console.warn(`[SFUConsumeModule] Consumer peer ${state} — scheduling re-consume in 2s`);
      setTimeout(() => {
        // Only retry if this peer is still the active one (not already replaced)
        if (consumerPeer !== peer) return;
        console.log('[SFUConsumeModule] Auto re-consuming after connection drop...');
        requestConsumeCurrentStreams(roomId, userId).catch(err => {
          console.error('[SFUConsumeModule] Auto re-consume failed:', err);
        });
      }, 2000);
    }
  };

  // Dynamically size transceivers based on how many users are in the room.
  // Per user: up to 1 audio stream + 1 camera video + 1 screen video.
  // We add a headroom of +1 per kind so a user joining mid-call still gets slots.
  // Unused transceiver slots are harmless inactive m= sections in the SDP.
  {
    // Try to get the real user count from the server; fall back to the local list.
    let userCount = 2; // safe minimum
    try {
      const infoUrl = `${serverProtocol}://${serverUrl}:${serverPort}/room-streams/${roomId}`;
      const info = await fetch(infoUrl).then(r => r.ok ? r.json() : null).catch(() => null);
      if (info?.userCount) {
        userCount = info.userCount;
      } else {
        userCount = Math.max(window.UsersModule?.getUsersList?.()?.length ?? 2, 2);
      }
    } catch (_) {
      userCount = Math.max(window.UsersModule?.getUsersList?.()?.length ?? 2, 2);
    }

    // slots = N users × 2 video (screen + camera) and N audio, with +1 headroom each
    const videoSlots = Math.max((userCount + 1) * 2, 4);
    const audioSlots = Math.max(userCount + 1, 2);

    console.log(`[SFUConsumeModule] Provisioning ${audioSlots} audio + ${videoSlots} video transceivers for ${userCount} user(s)`);

    for (let i = 0; i < audioSlots; i++) {
      peer.addTransceiver('audio', { direction: 'recvonly' });
    }
    for (let i = 0; i < videoSlots; i++) {
      peer.addTransceiver('video', { direction: 'recvonly' });
    }
  }

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

    // Reconcile activeScreenShares — remove users no longer sharing,
    // but keep valid entries so switching still works mid-session.
    const expectedScreenUserIds = new Set(
      answerPayload.streamMetadata
        .filter(m => m.streamType === 'screen')
        .map(m => m.oderId)
    );
    for (let i = activeScreenShares.length - 1; i >= 0; i--) {
      if (!expectedScreenUserIds.has(activeScreenShares[i].oderId)) {
        const removed = activeScreenShares.splice(i, 1)[0];
        window.UsersModule?.setScreenShareOn?.(removed.oderId, false);
        console.log(`[SFUConsumeModule] Pruned stale screen share for ${removed.oderId}`);
      }
    }
    currentScreenShareIndex = Math.max(0, Math.min(currentScreenShareIndex, activeScreenShares.length - 1));
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
      // Audio-only stream
      if (track.kind === 'audio') {
        playRemoteAudio(stream, oderId);
      }
      break;

    case 'media':
      // Combined audio + camera stream from server
      // Route audio to audio element, video to sidebar
      if (track.kind === 'audio') {
        playRemoteAudio(stream, oderId);
      } else if (track.kind === 'video') {
        displayRemoteCameraInSidebar(stream, oderId);
      }
      break;

    case 'screen':
      // Screen share video → center grid
      if (track.kind === 'video') {
        displayRemoteScreenShare(stream, oderId);
      }
      break;

    case 'camera':
      // Standalone camera video → sidebar
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
 * Fallback handler when no metadata is available.
 * Audio is still played (no harm). Unknown video is dropped — we can't
 * know if it's camera or screen, and guessing wrong puts camera in center.
 */
function handleTrackFallback(track, stream) {
  if (track.kind === 'audio') {
    playRemoteAudio(stream, null);
  } else if (track.kind === 'video') {
    console.warn('[SFUConsumeModule] Dropping unknown video track (no metadata). It will be re-consumed when a new-stream event fires.');
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
 * Display remote screen share — register it and render the current one.
 */
function displayRemoteScreenShare(stream, oderId) {
  if (!oderId) return;

  // Update existing entry or push new one
  const existing = activeScreenShares.findIndex(s => s.oderId === oderId);
  if (existing !== -1) {
    activeScreenShares[existing].stream = stream;
  } else {
    activeScreenShares.push({ oderId, stream });
    // Auto-jump to the newly arrived share (highest-priority = latest)
    currentScreenShareIndex = activeScreenShares.length - 1;
  }

  renderScreenShare();
  // Update user list badge
  window.UsersModule?.setScreenShareOn?.(oderId, true);
  console.log(`[SFUConsumeModule] Registered screen share from ${oderId} (total: ${activeScreenShares.length})`);
}

/**
 * Render the screen share at currentScreenShareIndex into the center grid.
 */
function renderScreenShare() {
  console.log('[SFUConsumeModule] Rendering screen share');
  const videoGrid = document.getElementById('video-grid');
  const placeholder = document.getElementById('video-placeholder');
  if (!videoGrid) return;

  if (activeScreenShares.length === 0) {
    // No shares left — tear down the container
    const container = document.getElementById('main-video-container');
    if (container && !container.classList.contains('screenshare')) {
      container.remove();
    }
    if (placeholder) placeholder.classList.remove('hidden');
    updateScreenNavUI();
    updateVideoGridLayout();
    return;
  }

  // Clamp index
  currentScreenShareIndex = Math.max(0, Math.min(currentScreenShareIndex, activeScreenShares.length - 1));
  const { oderId, stream } = activeScreenShares[currentScreenShareIndex];

  if (placeholder) placeholder.classList.add('hidden');

  // Get or create the main-video-container
  let container = document.getElementById('main-video-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'main-video-container';
    container.className = 'video-item remote screen';
    const label = document.createElement('div');
    label.className = 'video-label';
    container.appendChild(label);
    videoGrid.appendChild(container);
  }
  container.classList.add('remote', 'screen');
  container.dataset.oderId = oderId;

  // Update label
  const label = container.querySelector('.video-label');
  if (label) label.textContent = getBroadcasterName(oderId) + ' (Screen)';

  // Create or get video element
  let videoEl = document.getElementById('remote-video');
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.id = 'remote-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    container.insertBefore(videoEl, container.querySelector('.video-label'));
  }
  videoEl.srcObject = stream;

  updateVideoGridLayout();
}


/**
 * Navigate to next (+1) or previous (-1) screen share.
 */
function navigateScreenShare(direction) {
  currentScreenShareIndex = Math.max(0, Math.min(
    currentScreenShareIndex + direction,
    activeScreenShares.length - 1
  ));
  renderScreenShare();
}

/**
 * Jump directly to a specific user's screen share (called from sidebar click).
 */
function jumpToScreenShare(oderId) {
  const idx = activeScreenShares.findIndex(s => s.oderId === oderId);
  if (idx !== -1) {
    currentScreenShareIndex = idx;
    renderScreenShare();
  }
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
      } catch (_) { }
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
  const broadcaster = users.find(u => u.userId === oderId);
  return broadcaster?.name || oderId;
}

/**
 * Remove a user's screen share from the registry and re-render.
 */
function removeRemoteScreenShare(oderId) {
  const idx = oderId
    ? activeScreenShares.findIndex(s => s.oderId === oderId)
    : activeScreenShares.length - 1; // null = remove current

  if (idx === -1) return;

  activeScreenShares.splice(idx, 1);

  // Notify UsersModule to clear the badge (guard: oderId may be null for legacy call)
  if (oderId) window.UsersModule?.setScreenShareOn?.(oderId, false);

  // Keep index in bounds after removal
  if (currentScreenShareIndex >= activeScreenShares.length) {
    currentScreenShareIndex = Math.max(0, activeScreenShares.length - 1);
  }

  console.log(`[SFUConsumeModule] Removed screen share for ${oderId} (remaining: ${activeScreenShares.length})`);
  renderScreenShare();
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
    } catch (_) { }
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
    case 'media':
      // Combined stream stopped — remove both audio and camera sidebar
      removeRemoteAudio(oderId);
      removeRemoteCameraFromSidebar(oderId);
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
    } catch (_) { }
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
  // No-op: replaced by activeScreenShares registry
}

/**
 * Legacy function - update remote video label
 */
function updateRemoteVideoLabel() {
  const container = document.getElementById('main-video-container');
  if (!container) return;

  const label = container.querySelector('.video-label');
  if (label && container.classList.contains('remote')) {
    const current = activeScreenShares[currentScreenShareIndex];
    const name = current ? getBroadcasterName(current.oderId) : 'Remote';
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
  navigateScreenShare,
  jumpToScreenShare,

  // Audio
  playRemoteAudio,
  removeRemoteAudio,

  // Legacy functions
  setBroadcasterUserId,
  updateRemoteVideoLabel,
  removeRemoteVideo
};
