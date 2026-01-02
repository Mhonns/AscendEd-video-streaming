// Socket.io should be loaded via script tag in HTML: <script src="https://cdn.socket.io/4.6.1/socket.io.min.js"></script>
// Then use the global 'io' object

// WebRTC Module - Exported functions for room.js
let rtc_signaling_socket = null;
let peerConnection = null;
let localStream = null;
let isWebRTCInitialized = false;
let isMicEnabled = false;
let isCameraEnabled = false;
let iceCandidateQueue = [];

const pc_config = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302",
        },
    ],
};

// Initialize WebRTC signaling connection
async function initWebRTCSignaling() {
    if (rtc_signaling_socket) {
        return; // Already initialized 
    }
    
    // Get signaling server URL - await the async function to get the actual string URL
    let signalingServerURL = await getSignalingServerURL();
    
    // Ensure we have a string URL, not a Promise or object
    if (!signalingServerURL || typeof signalingServerURL !== 'string') {
        console.error('Invalid signaling server URL:', signalingServerURL);
        // Fallback: build URL directly
        const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
        signalingServerURL = `${protocol}://streaming.nathadon.com:30000`;
    }
    
    console.log('Connecting to signaling server:', signalingServerURL);
    
    rtc_signaling_socket = io(signalingServerURL, {
        transports: ['websocket', 'polling'],
        cors: {
            origin: '*',
            credentials: true
        },
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    // Create peer connection
    peerConnection = new RTCPeerConnection(pc_config);
    
    // Set up socket event handlers
    setupSignalingHandlers();
    
    isWebRTCInitialized = true;
    console.log('WebRTC signaling initialized with URL:', signalingServerURL);
}


// Helper function to add ICE candidate (queues if remote description not set)
const addIceCandidateSafely = async (candidate) => {
    if (!peerConnection) return;
    
    if (peerConnection.remoteDescription) {
        // Remote description is set, add candidate immediately
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log("candidate add success");
        } catch (error) {
            console.error("Error adding ICE candidate:", error);
        }
    } else {
        // Queue candidate for later
        iceCandidateQueue.push(candidate);
        console.log("ICE candidate queued (remote description not set yet)");
    }
};

// Process queued ICE candidates after remote description is set
const processQueuedCandidates = async () => {
    if (!peerConnection) return;
    
    while (iceCandidateQueue.length > 0) {
        const candidate = iceCandidateQueue.shift();
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log("queued candidate add success");
        } catch (error) {
            console.error("Error adding queued ICE candidate:", error);
        }
    }
};

// Signaling functions
const createOffer = (audio = false, video = false) => {
    if (!peerConnection || !rtc_signaling_socket) {
        console.error("WebRTC not initialized");
        return;
    }
    console.log("create offer");
    peerConnection
        .createOffer({offerToReceiveAudio: audio, offerToReceiveVideo: video})
        .then(sdp => {
            peerConnection.setLocalDescription(sdp);
            rtc_signaling_socket.emit("offer", sdp);
        })
        .catch(error => {
            console.error("Error creating offer:", error);
        });
};

const createAnswer = async (sdp, audio = false, video = false) => {
    try {
        await peerConnection.setRemoteDescription(sdp);
        console.log("answer set remote description success");
        // Process any queued ICE candidates
        await processQueuedCandidates();
        
        const sdp1 = await peerConnection.createAnswer({
            offerToReceiveAudio: audio,
            offerToReceiveVideo: video,
        });
        console.log("create answer");
        await peerConnection.setLocalDescription(sdp1);
        rtc_signaling_socket.emit("answer", sdp1);
    } catch (error) {
        console.error("Error creating answer:", error);
    }
};

// Setup signaling socket event handlers
function setupSignalingHandlers() {
    if (!rtc_signaling_socket || !peerConnection) return;
    
    // ICE connection state change
    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", peerConnection.iceConnectionState);
    };
    
    // Socket.io connection
    rtc_signaling_socket.on('connect', () => {
        console.log('Connected to WebRTC signaling server!');
        // Join the signaling room when connected
        const roomId = getRoomId();
        const userId = localStorage.getItem('userId');
        if (roomId && userId) {
            rtc_signaling_socket.emit("join", {
                room: roomId,
                name: userId,
            });
            console.log('Joined signaling room:', roomId);
        }
    });

    rtc_signaling_socket.on("room_users", (data) => {
        console.log("room_users:", data);
        // Create offer when other users are in the room
        if (data && data.length > 0) {
            // Only create offer if we have tracks to send
            createOffer(true, true);
        }
    });

    rtc_signaling_socket.on("getOffer", async (sdp) => {
        try {
            await peerConnection.setRemoteDescription(sdp);
            console.log("offer set remote description success");
            // Process any queued ICE candidates
            await processQueuedCandidates();
            
            const answer = await peerConnection.createAnswer({
                offerToReceiveVideo: true,
                offerToReceiveAudio: true,
            });
            await peerConnection.setLocalDescription(answer);
            rtc_signaling_socket.emit("answer", answer);
            console.log("answer sent");
        } catch (error) {
            console.error("Error handling offer:", error);
        }
    });

    // Handle receiving answer (set remote description)
    rtc_signaling_socket.on("getAnswer", async (sdp) => {
        try {
            await peerConnection.setRemoteDescription(sdp);
            console.log("answer set remote description success");
            // Process any queued ICE candidates
            await processQueuedCandidates();
        } catch (error) {
            console.error("Error handling answer:", error);
        }
    });

    // Handle receiving ICE candidate
    rtc_signaling_socket.on("getCandidate", (candidate) => {
        addIceCandidateSafely(candidate);
    });
    
    // Set up track handler for remote streams
    peerConnection.ontrack = (ev) => {
        console.log("add remotetrack success");
        const remoteVideo = createOrGetRemoteVideoElement();
        if (remoteVideo) {
            remoteVideo.srcObject = ev.streams[0];
        }
    };
}

// Create or get remote video element in video grid
function createOrGetRemoteVideoElement() {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return null;
    
    // Hide placeholder
    const placeholder = document.getElementById('video-placeholder');
    if (placeholder) {
        placeholder.classList.add('hidden');
    }
    
    // Check if remote video element already exists
    let remoteVideo = document.getElementById('remote-video');
    if (!remoteVideo) {
        remoteVideo = document.createElement('video');
        remoteVideo.id = 'remote-video';
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.className = 'video-item';
        videoGrid.appendChild(remoteVideo);
    }
    
    return remoteVideo;
}

// Create or get local video element in video grid
function createOrGetLocalVideoElement() {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return null;
    
    // Hide placeholder
    const placeholder = document.getElementById('video-placeholder');
    if (placeholder) {
        placeholder.classList.add('hidden');
    }
    
    // Check if local video element already exists
    let localVideo = document.getElementById('local-video');
    if (!localVideo) {
        localVideo = document.createElement('video');
        localVideo.id = 'local-video';
        localVideo.autoplay = true;
        localVideo.playsInline = true;
        localVideo.muted = true; // Mute local video to avoid feedback
        localVideo.className = 'video-item';
        videoGrid.appendChild(localVideo);
    }
    
    return localVideo;
}

// Request microphone permission and initialize
async function requestMicrophonePermission() {
    try {
        // Initialize WebRTC if not already done
        if (!isWebRTCInitialized) {
            await initWebRTCSignaling();
        }
        
        // If we already have a video stream, request both audio and video to get a combined stream
        const constraints = isCameraEnabled && localStream 
            ? { audio: true, video: true } 
            : { audio: true };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // If we had a previous stream, stop its tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        localStream = stream;
        isMicEnabled = true;
        
        // Update local video if camera is also enabled
        if (isCameraEnabled) {
            const localVideo = createOrGetLocalVideoElement();
            if (localVideo) {
                localVideo.srcObject = localStream;
            }
        }
        
        // Add audio track to peer connection
        let trackAdded = false;
        if (peerConnection) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                // Check if track already added
                const existingTracks = peerConnection.getSenders().map(sender => sender.track);
                if (!existingTracks.includes(audioTrack)) {
                    peerConnection.addTrack(audioTrack, localStream);
                    trackAdded = true;
                    console.log('Audio track added to peer connection');
                }
            }
        }
        
        // Set up ICE candidate handler if not already set
        if (peerConnection && !peerConnection.onicecandidate) {
            peerConnection.onicecandidate = (e) => {
                if (e.candidate && rtc_signaling_socket) {
                    console.log("onicecandidate");
                    rtc_signaling_socket.emit("candidate", e.candidate);
                }
            };
        }
        
        // Join signaling room (only if not already joined)
        const roomId = getRoomId();
        const userId = localStorage.getItem('userId');
        const wasAlreadyJoined = rtc_signaling_socket && rtc_signaling_socket.connected;
        
        if (rtc_signaling_socket) {
            rtc_signaling_socket.emit("join", {
                room: roomId,
                name: userId,
            });
        }
        
        // If we were already connected and added a track, create a new offer to renegotiate
        // Also create offer if we haven't created one yet (first time enabling mic)
        if (trackAdded) {
            if (wasAlreadyJoined) {
                console.log('Creating new offer after adding microphone track (renegotiation)');
                // Wait a bit for join to complete, then create offer
                setTimeout(() => {
                    createOffer(isMicEnabled, isCameraEnabled);
                }, 500);
            } else {
                // Not yet connected, offer will be created when room_users is received
                console.log('Track added, will create offer when room_users received');
            }
        }
        
        console.log('Microphone permission granted and initialized');
        return true;
    } catch (error) {
        console.error('Error requesting microphone permission:', error);
        alert('Failed to access microphone. Please check your browser permissions.');
        return false;
    }
}

// Request camera permission and initialize
async function requestCameraPermission() {
    try {
        // Initialize WebRTC if not already done
        if (!isWebRTCInitialized) {
            await initWebRTCSignaling();
        }
        
        // If we already have an audio stream, request both audio and video to get a combined stream
        const constraints = isMicEnabled && localStream 
            ? { audio: true, video: true } 
            : { video: true };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // If we had a previous stream, stop its tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        localStream = stream;
        isCameraEnabled = true;
        
        // Display local video
        const localVideo = createOrGetLocalVideoElement();
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        
        // Add video track to peer connection
        let trackAdded = false;
        if (peerConnection) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                // Check if track already added
                const existingTracks = peerConnection.getSenders().map(sender => sender.track);
                if (!existingTracks.includes(videoTrack)) {
                    peerConnection.addTrack(videoTrack, localStream);
                    trackAdded = true;
                    console.log('Video track added to peer connection');
                }
            }
            // Also add audio track if it exists (from combined stream)
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                const existingTracks = peerConnection.getSenders().map(sender => sender.track);
                if (!existingTracks.includes(audioTrack)) {
                    peerConnection.addTrack(audioTrack, localStream);
                    trackAdded = true;
                    console.log('Audio track added to peer connection');
                }
            }
        }
        
        // Set up ICE candidate handler if not already set
        if (peerConnection && !peerConnection.onicecandidate) {
            peerConnection.onicecandidate = (e) => {
                if (e.candidate && rtc_signaling_socket) {
                    console.log("onicecandidate");
                    rtc_signaling_socket.emit("candidate", e.candidate);
                }
            };
        }
        
        // Join signaling room (only if not already joined)
        const roomId = getRoomId();
        const userId = localStorage.getItem('userId');
        const wasAlreadyJoined = rtc_signaling_socket && rtc_signaling_socket.connected;
        
        if (rtc_signaling_socket) {
            rtc_signaling_socket.emit("join", {
                room: roomId,
                name: userId,
            });
        }
        
        // If we were already connected and added a track, create a new offer to renegotiate
        // Also create offer if we haven't created one yet (first time enabling camera)
        if (trackAdded) {
            if (wasAlreadyJoined) {
                console.log('Creating new offer after adding camera track (renegotiation)');
                // Wait a bit for join to complete, then create offer
                setTimeout(() => {
                    createOffer(isMicEnabled, isCameraEnabled);
                }, 500);
            } else {
                // Not yet connected, offer will be created when room_users is received
                console.log('Track added, will create offer when room_users received');
            }
        }
        
        console.log('Camera permission granted and initialized');
        return true;
    } catch (error) {
        console.error('Error requesting camera permission:', error);
        alert('Failed to access camera. Please check your browser permissions.');
        return false;
    }
}

// Toggle microphone on/off
function toggleMicrophone(enabled) {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach(track => {
        track.enabled = enabled;
    });
    isMicEnabled = enabled;
    console.log('Microphone:', enabled ? 'ON' : 'OFF');
}

// Toggle camera on/off
function toggleCamera(enabled) {
    if (!localStream) return;
    
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
        track.enabled = enabled;
    });
    isCameraEnabled = enabled;
    
    const localVideo = document.getElementById('local-video');
    if (localVideo) {
        localVideo.style.display = enabled ? 'block' : 'none';
    }
    console.log('Camera:', enabled ? 'ON' : 'OFF');
}

// Export functions for room.js
window.WebRTCModule = {
    requestMicrophonePermission,
    requestCameraPermission,
    toggleMicrophone,
    toggleCamera,
    initWebRTCSignaling,
    isMicEnabled: () => isMicEnabled,
    isCameraEnabled: () => isCameraEnabled
};
