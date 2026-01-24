/**
 * SFU Broadcast Module (client)
 * Creates a "sendonly" RTCPeerConnection and POSTs an SDP offer to the SFU /broadcast endpoint
 * to broadcast local audio/video streams to the room.
 */

// Store the broadcaster peer for later cleanup/renegotiation
let broadcasterPeer = null;

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
 * Broadcast local stream to the SFU.
 * Call this after the user enables camera/mic and joins a room.
 * 
 * @param {MediaStream} localStream - The stream from MediaModule.getLocalStream()
 * @param {string} roomId - The room to broadcast to
 * @param {string} userId - The user's ID
 * @returns {RTCPeerConnection} The peer connection for later cleanup
 */
async function broadcastStream(localStream, roomId, userId) {
  if (!localStream) {
    throw new Error('[SFUBroadcastModule] localStream is required');
  }
  if (!roomId || !userId) {
    throw new Error('[SFUBroadcastModule] roomId and userId are required');
  }

  // Close existing broadcaster if any (renegotiation scenario)
  if (broadcasterPeer) {
    try {
      broadcasterPeer.close();
    } catch (_) {}
  }

  const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
  broadcasterPeer = peer;

  // Add local tracks to the peer connection (sendonly)
  localStream.getTracks().forEach(track => {
    peer.addTrack(track, localStream);
  });

  // Create offer
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  const payload = {
    sdp: peer.localDescription,
    roomId,
    userId
  };

  // POST to /broadcast endpoint
  const url = `${serverProtocol}://${serverUrl}:${serverPort}/broadcast`;
  const answerPayload = await postJson(url, payload);

  if (!answerPayload || !answerPayload.sdp) {
    throw new Error('[SFUBroadcastModule] Invalid /broadcast response');
  }

  await peer.setRemoteDescription(new RTCSessionDescription(answerPayload.sdp));
  console.log('[SFUBroadcastModule] Broadcast SDP exchange completed');

  return peer;
}

/**
 * Stop broadcasting and close the peer connection
 */
async function stopBroadcast() {
  if (broadcasterPeer) {
    try {
      broadcasterPeer.close();
    } catch (_) {}
    broadcasterPeer = null;
    
    // Notify server to cleanup
    const roomId = window.SocketHandler?.getCurrentRoomId();
    const userId = window.SocketHandler?.getUserId();
    if (roomId && userId) {
      try {
        await postJson(`${serverProtocol}://${serverUrl}:${serverPort}/stop-broadcast`, {
          roomId,
          userId
        });
      } catch (err) {
        console.warn('[SFUBroadcastModule] Failed to notify server of stop:', err);
      }
    }
    
    console.log('[SFUBroadcastModule] Broadcast stopped');
  }
}

/**
 * Get the current broadcaster peer (for ICE candidate handling)
 */
function getBroadcasterPeer() {
  return broadcasterPeer;
}

/**
 * Check if currently broadcasting
 */
function isBroadcasting() {
  return broadcasterPeer !== null;
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
  broadcastStream,
  stopBroadcast,
  getBroadcasterPeer,
  isBroadcasting,
  notifyMuteStatus
};