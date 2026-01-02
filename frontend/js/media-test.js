// Socket.io should be loaded via script tag in HTML: <script src="https://cdn.socket.io/4.6.1/socket.io.min.js"></script>
// Then use the global 'io' object

// Variables
const socket = io('https://streaming.nathadon.com:30000', {
    transports: ['websocket', 'polling', 'flashsocket'],
    cors: {
        origin: "https://streaming.nathadon.com:30000",
        credentials: true
    },
    withCredentials: true
});

const pc_config = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302",
        },
    ],
};

const peerConnection = new RTCPeerConnection(pc_config);

// Queue for ICE candidates received before remote description is set
const iceCandidateQueue = [];

// Helper function to add ICE candidate (queues if remote description not set)
const addIceCandidateSafely = async (candidate) => {
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
const createOffer = () => {
    console.log("create offer");
    peerConnection
        .createOffer({offerToReceiveAudio: true, offerToReceiveVideo: true})
        .then(sdp => {
            peerConnection.setLocalDescription(sdp);
            socket.emit("offer", sdp);
        })
        .catch(error => {
            console.log(error);
        });
};

const createAnswer = async (sdp) => {
    try {
        await peerConnection.setRemoteDescription(sdp);
        console.log("answer set remote description success");
        // Process any queued ICE candidates
        await processQueuedCandidates();
        
        const sdp1 = await peerConnection.createAnswer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: true,
        });
        console.log("create answer");
        await peerConnection.setLocalDescription(sdp1);
        socket.emit("answer", sdp1);
    } catch (error) {
        console.error("Error creating answer:", error);
    }
};

// ICE candidate handler (will be set in init function)
peerConnection.oniceconnectionstatechange = e => {
    console.log("ICE connection state:", peerConnection.iceConnectionState);
};

// Socket.io functions
socket.on('connect', () => {
    console.log('Hello, successfully connected to the signaling server!');
});

socket.on("room_users", (data) => {
    console.log("room_users:", data);
    // Create offer when other users are in the room
    if (data && data.length > 0) {
        createOffer();
    }
});

// Handle receiving offer (set remote description and create answer)
socket.on("getOffer", async (sdp) => {
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
        socket.emit("answer", answer);
        console.log("answer sent");
    } catch (error) {
        console.error("Error handling offer:", error);
    }
});

// Handle receiving answer (set remote description)
socket.on("getAnswer", async (sdp) => {
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
socket.on("getCandidate", (candidate) => {
    addIceCandidateSafely(candidate);
});

async function init(e) {
    console.log("render videos");
    try {
        navigator.mediaDevices
            .getUserMedia({
                video: true,
                audio: true,
            })
            .then(stream => {
                if (localVideo) localVideo.srcObject = stream;

                stream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, stream);
                });
                
                // Set up ICE candidate handler
                peerConnection.onicecandidate = e => {
                    if (e.candidate) {
                        console.log("onicecandidate");
                        socket.emit("candidate", e.candidate);
                    }
                };

                // Set up track handler
                peerConnection.ontrack = ev => {
                    console.log("add remotetrack success");
                    if (remoteVideo) {
                        remoteVideo.srcObject = ev.streams[0];
                    }
                };

                socket.emit("join", {
                    room: "1234",
                    name: "skydoves@getstream.io",
                });
            })
            .catch(error => {
                console.log(`getUserMedia error: ${error}`);
            });
    } catch (e) {
        console.log(e);
    }
}

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
document.querySelector('#join').addEventListener('click', e => init(e));
