// SIMPLIFIED WebRTC Module
let rtc_signaling_socket = null;
let peerConnections = new Map(); // socketId -> RTCPeerConnection
let localStream = null;
let mySocketId = null;
let isMicEnabled = false;
let isCameraEnabled = false;

const pc_config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// Initialize signaling connection
async function initWebRTCSignaling() {
    if (rtc_signaling_socket) return;
    
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const signalingServerURL = `${protocol}://streaming.nathadon.com:30000`;
    
    rtc_signaling_socket = io(signalingServerURL, {
        transports: ['websocket', 'polling'],
        reconnection: true
    });
    
    setupSignalingHandlers();
    console.log('WebRTC signaling initialized');
}

// Create peer connection for specific user
function createPeerConnection(socketId) {
    if (peerConnections.has(socketId)) {
        return peerConnections.get(socketId);
    }
    
    const pc = new RTCPeerConnection(pc_config);
    peerConnections.set(socketId, pc);
    
    // Add local tracks if available
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    // Send ICE candidates with target socket ID
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            rtc_signaling_socket.emit("candidate", {
                candidate: e.candidate,
                to: socketId  // WHO should receive this
            });
        }
    };
    
    // Handle incoming remote stream
    pc.ontrack = (ev) => {
        console.log("Received track from", socketId);
        const remoteVideo = createOrGetRemoteVideoElement(socketId);
        if (remoteVideo) {
            remoteVideo.srcObject = ev.streams[0];
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`${socketId} ICE state:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            cleanupPeerConnection(socketId);
        }
    };
    
    console.log('Created peer connection for', socketId);
    return pc;
}

// Clean up a peer connection
function cleanupPeerConnection(socketId) {
    const pc = peerConnections.get(socketId);
    if (pc) {
        pc.close();
        peerConnections.delete(socketId);
        
        const videoElement = document.getElementById(`remote-video-${socketId}`);
        if (videoElement) {
            videoElement.remove();
        }
        console.log('Cleaned up peer connection for', socketId);
    }
}

// Setup signaling handlers
function setupSignalingHandlers() {
    rtc_signaling_socket.on('connect', () => {
        mySocketId = rtc_signaling_socket.id;
        console.log('Connected! My socket ID:', mySocketId);
        
        // Join room
        const roomId = window.RoomUtils?.getRoomId() || 
                      new URLSearchParams(window.location.search).get('room') || 
                      'ABC123XYZ';
        const userId = localStorage.getItem('userId');
        
        rtc_signaling_socket.emit("join", { room: roomId, name: userId });
    });
    
    // When we get list of room users
    rtc_signaling_socket.on("room_users", async (users) => {
        console.log("Room users:", users);
        
        // Create connections and send offers to users with HIGHER socket IDs
        // This prevents offer collisions (both users sending offers simultaneously)
        for (const user of users) {
            if (user.id !== mySocketId && !peerConnections.has(user.id)) {
                const pc = createPeerConnection(user.id);
                
                // Only send offer if they have higher socket ID
                // Users with lower IDs will send offers to us
                if (localStream && mySocketId < user.id) {
                    console.log("Sending offer to", user.id, "(I have lower ID)");
                    await sendOffer(user.id);
                } else if (localStream) {
                    console.log("Waiting for offer from", user.id, "(they have lower ID)");
                }
            }
        }
        
        // Remove connections for users who left
        const currentUserIds = new Set(users.map(u => u.id));
        for (const socketId of peerConnections.keys()) {
            if (!currentUserIds.has(socketId)) {
                cleanupPeerConnection(socketId);
            }
        }
    });
    
    // When a new user joins the room
    rtc_signaling_socket.on("user_joined", async (data) => {
        const { id, name } = data;
        console.log("🆕 New user joined:", id, name);
        console.log("   My ID:", mySocketId);
        console.log("   Have local stream?", !!localStream);
        console.log("   Existing connections:", Array.from(peerConnections.keys()));
        
        // Create connection to new user if we don't have one
        if (id !== mySocketId && !peerConnections.has(id)) {
            const pc = createPeerConnection(id);
            
            // Only send offer if we have lower socket ID (to prevent collision)
            // The other peer will send offer if they have lower ID
            if (localStream && mySocketId < id) {
                console.log("✅ I have lower ID, sending offer to", id);
                // Small delay to ensure connection is ready
                setTimeout(() => sendOffer(id), 100);
            } else if (localStream) {
                console.log("⏳ They have lower ID, waiting for offer from", id);
            } else {
                console.log("⚠️ No local stream yet, cannot establish connection");
            }
        } else if (id !== mySocketId) {
            console.log("⚠️ Already have connection to", id);
        }
    });
    
    // Receive offer from another peer
    rtc_signaling_socket.on("getOffer", async (data) => {
        const { sdp, from } = data;  // MUST have 'from' field
        
        if (!from || from === mySocketId) return;
        
        console.log("📨 Received offer from", from);
        console.log("   Current connections:", Array.from(peerConnections.keys()));
        
        const pc = createPeerConnection(from);
        
        try {
            // sdp is already a plain object { type: 'offer', sdp: '...' }
            // Modern browsers accept plain objects directly
            await pc.setRemoteDescription(sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            // Send answer back with target
            rtc_signaling_socket.emit("answer", {
                sdp: answer,
                to: from  // WHO should receive this answer
            });
            
            console.log("✅ Sent answer to", from);
        } catch (error) {
            console.error("❌ Error handling offer from", from, ":", error);
        }
    });
    
    // Receive answer from another peer
    rtc_signaling_socket.on("getAnswer", async (data) => {
        const { sdp, from } = data;  // MUST have 'from' field
        
        if (!from || from === mySocketId) return;
        
        console.log("Received answer from", from);
        const pc = peerConnections.get(from);
        
        if (pc && !pc.remoteDescription) {
            try {
                // sdp is already a plain object { type: 'answer', sdp: '...' }
                await pc.setRemoteDescription(sdp);
                console.log("Set remote description for", from);
            } catch (error) {
                console.error("Error handling answer from", from, ":", error);
            }
        }
    });
    
    // Receive ICE candidate
    rtc_signaling_socket.on("getCandidate", async (data) => {
        const { candidate, from } = data;  // MUST have 'from' field
        
        if (!from || from === mySocketId) return;
        
        const pc = peerConnections.get(from);
        if (pc) {
            try {
                // candidate is already a plain object - no need to wrap
                await pc.addIceCandidate(candidate);
                console.log("Added ICE candidate from", from);
            } catch (error) {
                console.error("Error adding ICE candidate from", from, ":", error);
            }
        }
    });
}

// Send offer to a specific peer
async function sendOffer(socketId) {
    const pc = peerConnections.get(socketId);
    if (!pc) {
        console.error("❌ Cannot send offer: no peer connection for", socketId);
        return;
    }
    
    console.log("📤 Creating offer for", socketId);
    console.log("   Local tracks:", localStream ? localStream.getTracks().map(t => t.kind) : 'none');
    
    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        
        rtc_signaling_socket.emit("offer", {
            sdp: offer,
            to: socketId  // WHO should receive this offer
        });
        
        console.log("✅ Sent offer to", socketId);
    } catch (error) {
        console.error("❌ Error sending offer to", socketId, ":", error);
    }
}

// Request microphone
async function requestMicrophonePermission() {
    try {
        if (!rtc_signaling_socket) await initWebRTCSignaling();
        
        const constraints = isCameraEnabled ? { audio: true, video: true } : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        localStream = stream;
        isMicEnabled = true;
        
        // Add tracks to all existing connections
        const audioTrack = stream.getAudioTracks()[0];
        peerConnections.forEach((pc, socketId) => {
            if (audioTrack) {
                pc.addTrack(audioTrack, localStream);
                // Renegotiate
                sendOffer(socketId);
            }
        });
        
        if (isCameraEnabled) {
            const localVideo = createOrGetLocalVideoElement();
            if (localVideo) localVideo.srcObject = localStream;
        }
        
        console.log('Microphone enabled');
        return true;
    } catch (error) {
        console.error('Microphone error:', error);
        return false;
    }
}

// Request camera
async function requestCameraPermission() {
    try {
        if (!rtc_signaling_socket) await initWebRTCSignaling();
        
        const constraints = isMicEnabled ? { audio: true, video: true } : { video: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        localStream = stream;
        isCameraEnabled = true;
        
        const localVideo = createOrGetLocalVideoElement();
        if (localVideo) localVideo.srcObject = localStream;
        
        // Add tracks to all existing connections
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        
        peerConnections.forEach((pc, socketId) => {
            if (videoTrack) pc.addTrack(videoTrack, localStream);
            if (audioTrack) pc.addTrack(audioTrack, localStream);
            // Renegotiate
            sendOffer(socketId);
        });
        
        console.log('Camera enabled');
        return true;
    } catch (error) {
        console.error('Camera error:', error);
        return false;
    }
}

// Toggle functions
function toggleMicrophone(enabled) {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(track => track.enabled = enabled);
    isMicEnabled = enabled;
}

function toggleCamera(enabled) {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(track => track.enabled = enabled);
    isCameraEnabled = enabled;
    
    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.style.display = enabled ? 'block' : 'none';
}

// Video element helpers
function createOrGetRemoteVideoElement(socketId) {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return null;
    
    const placeholder = document.getElementById('video-placeholder');
    if (placeholder) placeholder.classList.add('hidden');
    
    const videoId = `remote-video-${socketId}`;
    let video = document.getElementById(videoId);
    
    if (!video) {
        video = document.createElement('video');
        video.id = videoId;
        video.autoplay = true;
        video.playsInline = true;
        video.className = 'video-item';
        videoGrid.appendChild(video);
    }
    
    return video;
}

function createOrGetLocalVideoElement() {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return null;
    
    const placeholder = document.getElementById('video-placeholder');
    if (placeholder) placeholder.classList.add('hidden');
    
    let video = document.getElementById('local-video');
    
    if (!video) {
        video = document.createElement('video');
        video.id = 'local-video';
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.className = 'video-item';
        videoGrid.appendChild(video);
    }
    
    return video;
}

// Export
window.WebRTCModule = {
    requestMicrophonePermission,
    requestCameraPermission,
    toggleMicrophone,
    toggleCamera,
    initWebRTCSignaling,
    isMicEnabled: () => isMicEnabled,
    isCameraEnabled: () => isCameraEnabled
};