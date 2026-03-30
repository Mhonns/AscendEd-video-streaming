/**
 * SFU Broadcast Module (client)
 * Manages separate peer connections for different stream types:
 * - main: audio only
 * - camera: camera video only
 * - screen: screen share video only
 */

// Store peers for each stream type
const broadcasterPeers = {
  main: null,    // audio
  camera: null,  // camera video
  screen: null   // screen share video
};

// Store stream keys returned by server
const streamKeys = {
  main: null,
  camera: null,
  screen: null
};

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
 * Generic broadcast function for a specific stream type
 * @param {MediaStream} stream - The stream to broadcast
 * @param {string} roomId - The room to broadcast to
 * @param {string} userId - The user's ID
 * @param {string} streamType - 'main', 'camera', or 'screen'
 * @param {string} endpoint - The server endpoint
 * @returns {RTCPeerConnection} The peer connection
 */
async function broadcastStreamType(stream, roomId, userId, streamType, endpoint) {
  if (!stream) {
    throw new Error(`[SFUBroadcastModule] stream is required for ${streamType}`);
  }
  if (!roomId || !userId) {
    throw new Error('[SFUBroadcastModule] roomId and userId are required');
  }

  // Close existing peer for this stream type if any
  if (broadcasterPeers[streamType]) {
    try {
      broadcasterPeers[streamType].close();
    } catch (_) {}
  }

  const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
  broadcasterPeers[streamType] = peer;

  // Add tracks to the peer connection (sendonly)
  stream.getTracks().forEach(track => {
    peer.addTrack(track, stream);
  });

  // Create offer
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  const payload = {
    sdp: peer.localDescription,
    roomId,
    userId
  };

  // POST to the specific endpoint
  const url = `${serverProtocol}://${serverUrl}:${serverPort}${endpoint}`;
  const answerPayload = await postJson(url, payload);

  if (!answerPayload || !answerPayload.sdp) {
    throw new Error(`[SFUBroadcastModule] Invalid ${endpoint} response`);
  }

  // Store the stream key for ICE candidate handling
  if (answerPayload.streamKey) {
    streamKeys[streamType] = answerPayload.streamKey;
  }

  await peer.setRemoteDescription(new RTCSessionDescription(answerPayload.sdp));
  console.log(`[SFUBroadcastModule] ${streamType} broadcast SDP exchange completed`);

  return peer;
}

/**
 * Broadcast audio (main stream)
 * @param {MediaStream} audioStream - Stream containing audio track(s)
 * @param {string} roomId - The room to broadcast to
 * @param {string} userId - The user's ID
 */
async function broadcastAudio(audioStream, roomId, userId) {
  return broadcastStreamType(audioStream, roomId, userId, 'main', '/broadcast-audio');
}

/**
 * Broadcast camera video
 * @param {MediaStream} cameraStream - Stream containing camera video track
 * @param {string} roomId - The room to broadcast to
 * @param {string} userId - The user's ID
 */
async function broadcastCamera(cameraStream, roomId, userId) {
  return broadcastStreamType(cameraStream, roomId, userId, 'camera', '/broadcast-camera');
}

/**
 * Broadcast screen share video
 * @param {MediaStream} screenStream - Stream containing screen share video track
 * @param {string} roomId - The room to broadcast to
 * @param {string} userId - The user's ID
 */
async function broadcastScreen(screenStream, roomId, userId) {
  return broadcastStreamType(screenStream, roomId, userId, 'screen', '/broadcast-screen');
}

/**
 * Stop a specific stream type
 * @param {string} streamType - 'main', 'camera', or 'screen'
 */
async function stopStreamType(streamType) {
  const peer = broadcasterPeers[streamType];
  if (peer) {
    try {
      peer.close();
    } catch (_) {}
    broadcasterPeers[streamType] = null;
    streamKeys[streamType] = null;
    
    // Notify server to cleanup
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = window.SocketHandler?.getUserId();
    if (roomId && userId) {
      try {
        await postJson(`${serverProtocol}://${serverUrl}:${serverPort}/stop-stream`, {
          roomId,
          userId,
          streamType
        });
      } catch (err) {
        console.warn(`[SFUBroadcastModule] Failed to notify server of ${streamType} stop:`, err);
      }
    }
    
    console.log(`[SFUBroadcastModule] ${streamType} broadcast stopped`);
  }
}

/**
 * Stop audio broadcast
 */
async function stopAudio() {
  return stopStreamType('main');
}

/**
 * Stop camera broadcast
 */
async function stopCamera() {
  return stopStreamType('camera');
}

/**
 * Stop screen broadcast
 */
async function stopScreen() {
  return stopStreamType('screen');
}

/**
 * Stop all broadcasts
 */
async function stopAllBroadcasts() {
  await Promise.all([
    stopStreamType('main'),
    stopStreamType('camera'),
    stopStreamType('screen')
  ]);
  console.log('[SFUBroadcastModule] All broadcasts stopped');
}

/**
 * Legacy broadcast function - broadcasts to 'main' stream type
 * For backward compatibility
 */
async function broadcastStream(localStream, roomId, userId) {
  return broadcastStreamType(localStream, roomId, userId, 'main', '/broadcast');
}

/**
 * Legacy stop function - stops all broadcasts
 */
async function stopBroadcast() {
  return stopAllBroadcasts();
}

/**
 * Get peer for a specific stream type
 */
function getPeer(streamType) {
  return broadcasterPeers[streamType];
}

/**
 * Get stream key for a specific stream type (for ICE candidate handling)
 */
function getStreamKey(streamType) {
  return streamKeys[streamType];
}

/**
 * Legacy function - get main broadcaster peer
 */
function getBroadcasterPeer() {
  return broadcasterPeers.main;
}

/**
 * Check if a specific stream type is broadcasting
 */
function isStreamTypeBroadcasting(streamType) {
  return broadcasterPeers[streamType] !== null;
}

/**
 * Check if any stream is broadcasting
 */
function isBroadcasting() {
  return broadcasterPeers.main !== null || 
         broadcasterPeers.camera !== null || 
         broadcasterPeers.screen !== null;
}

/**
 * Check if audio is broadcasting
 */
function isAudioBroadcasting() {
  return broadcasterPeers.main !== null;
}

/**
 * Check if camera is broadcasting
 */
function isCameraBroadcasting() {
  return broadcasterPeers.camera !== null;
}

/**
 * Check if screen is broadcasting
 */
function isScreenBroadcasting() {
  return broadcasterPeers.screen !== null;
}

/**
 * Notify server of mute status change (no re-broadcast needed)
 */
async function notifyMuteStatus(kind, muted) {
  const roomId = window.SocketHandler?.getCurrentRoomId();
  const userId = window.SocketHandler?.getUserId();
  
  if (!roomId || !userId) return;
  
  try {
    await fetch(`${serverProtocol}://${serverUrl}:${serverPort}/mute-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, userId, kind, muted })
    });
    console.log(`[SFUBroadcastModule] Notified ${kind} ${muted ? 'muted' : 'unmuted'}`);
  } catch (err) {
    console.warn('[SFUBroadcastModule] Failed to notify mute status:', err);
  }
}

window.SFUBroadcastModule = {
  // New stream-type specific functions
  broadcastAudio,
  broadcastCamera,
  broadcastScreen,
  stopAudio,
  stopCamera,
  stopScreen,
  stopAllBroadcasts,
  getPeer,
  getStreamKey,
  isAudioBroadcasting,
  isCameraBroadcasting,
  isScreenBroadcasting,
  isStreamTypeBroadcasting,
  
  // Legacy functions for backward compatibility
  broadcastStream,
  stopBroadcast,
  getBroadcasterPeer,
  isBroadcasting,
  notifyMuteStatus
};
