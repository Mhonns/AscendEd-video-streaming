const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const webrtc = require("wrtc");

// ICE servers configuration with STUN and TURN
const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    // TURN servers - using free public servers for testing
    // For production, use your own TURN server or a service like Twilio/Xirsys
    {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
    },
    {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
    },
    {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject"
    }
];

// Map to store room -> user streams mapping
const roomUserStreams = new Map();
// Map to track broadcaster peer connections: roomId -> userId -> peer
const broadcasterPeers = new Map();
// Map to track consumer peer connections: roomId -> userId -> peer
const consumerPeers = new Map();

// Socket.io instance for real-time notifications
let io = null;
function setIo(socketIo) {
    io = socketIo;
}

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


app.post("/consumer", async ({ body }, res) => {    
    const { sdp, roomId, userId } = body;
    const peer = new webrtc.RTCPeerConnection({ iceServers });
    
    // Track consumer peer connection by userId
    if (!consumerPeers.has(roomId)) {
        consumerPeers.set(roomId, new Map());
    }
    consumerPeers.get(roomId).set(userId, peer);
    
    // Send ICE candidates to client via Socket.io
    peer.onicecandidate = (event) => {
        if (event.candidate && io) {
            io.to(roomId).emit('ice-candidate', {
                candidate: event.candidate,
                userId,
                type: 'consumer'
            });
        }
    };
    
    // Auto-cleanup on disconnect
    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'disconnected' || 
            peer.iceConnectionState === 'failed' ||
            peer.iceConnectionState === 'closed') {
            removeConsumer(roomId, userId);
        }
    };
    
    const desc = new webrtc.RTCSessionDescription(sdp);
    await peer.setRemoteDescription(desc);

    const roomStreams = roomUserStreams.get(roomId);
    if (roomStreams) {
        roomStreams.forEach((stream, _oderId) => {
            stream.getTracks().forEach(track => peer.addTrack(track, stream));
        });
    }

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    const payload = {
        sdp: peer.localDescription
    }

    res.json(payload);
});

app.post('/broadcast', async ({ body }, res) => {
    const { sdp, roomId, userId } = body;  
    const peer = new webrtc.RTCPeerConnection({ iceServers });
    
    // Track broadcaster peer connection
    if (!broadcasterPeers.has(roomId)) {
        broadcasterPeers.set(roomId, new Map());
    }
    broadcasterPeers.get(roomId).set(userId, peer);
    
    // Send ICE candidates to client via Socket.io
    peer.onicecandidate = (event) => {
        if (event.candidate && io) {
            io.to(roomId).emit('ice-candidate', {
                candidate: event.candidate,
                userId,
                type: 'broadcaster'
            });
        }
    };
    
    // Auto-cleanup on disconnect
    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'disconnected' || 
            peer.iceConnectionState === 'failed' ||
            peer.iceConnectionState === 'closed') {
            removeUserStream(roomId, userId);
        }
    };
    
    peer.ontrack = (e) => handleTrackEvent(e, roomId, userId);
    const desc = new webrtc.RTCSessionDescription(sdp);
    await peer.setRemoteDescription(desc);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    const payload = {
        sdp: peer.localDescription
    }

    res.json(payload);
});

function handleTrackEvent(e, roomId, userId) {
    const stream = e.streams[0];
    if (!roomUserStreams.has(roomId)) {
        roomUserStreams.set(roomId, new Map());
    }
    roomUserStreams.get(roomId).set(userId, stream);
    
    // Notify other users in the room about the new broadcaster
    if (io) {
        io.to(roomId).emit('new-broadcaster', { roomId, userId });
    }
};

function destroyRoomStreams(roomId) {
    if (roomUserStreams.has(roomId)) {
        roomUserStreams.delete(roomId);
    }
    // Close all broadcaster peer connections for this room
    const roomBroadcasters = broadcasterPeers.get(roomId);
    if (roomBroadcasters) {
        roomBroadcasters.forEach((peer) => peer.close());
        broadcasterPeers.delete(roomId);
    }
    // Close all consumer peer connections for this room
    const roomConsumers = consumerPeers.get(roomId);
    if (roomConsumers) {
        roomConsumers.forEach((peer) => peer.close());
        consumerPeers.delete(roomId);
    }
}

function removeUserStream(roomId, userId) {
    const roomStreams = roomUserStreams.get(roomId);
    if (roomStreams) {
        roomStreams.delete(userId);
    }
    // Close broadcaster peer connection
    const roomBroadcasters = broadcasterPeers.get(roomId);
    if (roomBroadcasters) {
        const peer = roomBroadcasters.get(userId);
        if (peer) {
            peer.close();
            roomBroadcasters.delete(userId);
        }
    }
    // Notify other users in the room that broadcaster left
    if (io) {
        io.to(roomId).emit('broadcaster-left', { roomId, userId });
    }
}

function removeConsumer(roomId, userId) {
    const roomConsumers = consumerPeers.get(roomId);
    if (roomConsumers) {
        const peer = roomConsumers.get(userId);
        if (peer) {
            peer.close();
            roomConsumers.delete(userId);
        }
    }
}

async function addIceCandidate(roomId, userId, candidate, type) {
    let peer = null;
    
    if (type === 'broadcaster') {
        const roomBroadcasters = broadcasterPeers.get(roomId);
        if (roomBroadcasters) {
            peer = roomBroadcasters.get(userId);
        }
    } else if (type === 'consumer') {
        const roomConsumers = consumerPeers.get(roomId);
        if (roomConsumers) {
            peer = roomConsumers.get(userId);
        }
    }
    
    if (peer && candidate) {
        try {
            await peer.addIceCandidate(new webrtc.RTCIceCandidate(candidate));
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
}

module.exports = {
    roomUserStreams,
    destroyRoomStreams,
    removeUserStream,
    removeConsumer,
    addIceCandidate,
    iceServers,
    setIo
};

app.listen(5000, () => console.log('server started'));