/**
 * SFU Consume Module (client)
 * Creates a "recvonly" RTCPeerConnection and POSTs an SDP offer to the SFU /consumer endpoint
 * so the user can consume the current streams in the room.
 */
// Store consumer peer for cleanup
let consumerPeer = null;

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

  const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
  consumerPeer = peer;

  // Handle incoming tracks from broadcasters
  peer.ontrack = (event) => {
    const track = event.track;
    const stream = event.streams[0];
    
    // Play audio tracks
    if (track.kind === 'audio') {
      playRemoteAudio(stream);
    }
    
    // Display video tracks
    if (track.kind === 'video') {
      displayRemoteVideo(stream);
    }
  };

  // Receive-only transceivers: server will add tracks from existing broadcasters.
  peer.addTransceiver('audio', { direction: 'recvonly' });
  peer.addTransceiver('video', { direction: 'recvonly' });

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
  
  await peer.setRemoteDescription(new RTCSessionDescription(answerPayload.sdp));
  console.log('[SFUConsumeModule] Consumer SDP exchange completed');
  
  return peer;
}

/**
 * Play remote audio stream
 */
function playRemoteAudio(stream) {
  const streamId = stream.id;
  let audioEl = document.getElementById(`remote-audio-${streamId}`);
  
  // Create new audio element if it doesn't exist for this stream
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `remote-audio-${streamId}`;
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);
  }
  
  // Clear old data first
  audioEl.pause();
  audioEl.srcObject = null;
  audioEl.load();
  
  // Set new stream
  audioEl.srcObject = stream;
  audioEl.play().catch(err => console.warn('[SFUConsumeModule] Audio play failed:', err));
  
  console.log(`[SFUConsumeModule] Playing audio for stream ${streamId}`);
}

/**
 * Display remote video stream
 */
function displayRemoteVideo(stream) {
  const videoGrid = document.getElementById('video-grid');
  if (!videoGrid) return;
  
  let remoteContainer = document.getElementById('remote-video-container');
  if (!remoteContainer) {
    remoteContainer = document.createElement('div');
    remoteContainer.id = 'remote-video-container';
    remoteContainer.className = 'video-item remote';
    
    const videoEl = document.createElement('video');
    videoEl.id = 'remote-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = 'Remote';
    
    remoteContainer.appendChild(videoEl);
    remoteContainer.appendChild(label);
    videoGrid.appendChild(remoteContainer);
  }
  
  const videoEl = document.getElementById('remote-video');
  if (videoEl) {
    videoEl.srcObject = stream;
  }
  console.log('[SFUConsumeModule] Displaying remote video');
}

window.SFUConsumeModule = {
  requestConsumeCurrentStreams
};


