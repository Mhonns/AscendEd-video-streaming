const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const webrtc = require("wrtc");
const fs = require('fs');
const https = require('https');
const cors = require('cors');

// Enable CORS for all origins
app.use(cors());

// SSL Certificate paths
const SSL_CERT_PATH = '/etc/letsencrypt/live/streaming.nathadon.com/fullchain.pem';
const SSL_KEY_PATH = '/etc/letsencrypt/live/streaming.nathadon.com/privkey.pem';

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
// Queue to track pending broadcasts: roomId -> Set of userIds currently broadcasting
const pendingBroadcasts = new Map();
// Resolvers waiting for queue to empty: roomId -> array of resolve functions
const broadcastWaiters = new Map();

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
    console.log(`[CONSUME] ${userId} -> room ${roomId}`);
    
    // Wait for any pending broadcasts to complete first
    await waitForPendingBroadcasts(roomId);
    
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
    const streamCount = roomStreams ? roomStreams.size : 0;
    const streamUsers = roomStreams ? Array.from(roomStreams.keys()) : [];
    console.log(`[CONSUME] Room ${roomId} has ${streamCount} stream(s): [${streamUsers.join(', ')}]`);
    
    if (roomStreams) {
        let tracksAdded = 0;
        roomStreams.forEach((stream, oderId) => {
            // Don't send user's own stream back (prevents echo)
            if (oderId === userId) {
                console.log(`[CONSUME] Skipping own stream from ${oderId}`);
                return;
            }
            stream.getTracks().forEach(track => {
                console.log(`[CONSUME] Sending track from ${oderId} to ${userId}: { kind: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState} }`);
                peer.addTrack(track, stream);
                tracksAdded++;
            });
        });
        console.log(`[CONSUME] Added ${tracksAdded} track(s) for ${userId}`);
    } else {
        console.log(`[CONSUME] WARNING: No streams in room ${roomId}`);
    }

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    res.json({ sdp: peer.localDescription });
});

app.post('/broadcast', async ({ body }, res) => {
    const { sdp, roomId, userId } = body;  
    console.log(`[BROADCAST] ${userId} -> room ${roomId}`);
    
    // Add to pending queue - consumers will wait for this to complete
    addToPendingBroadcast(roomId, userId);
    
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

    res.json({ sdp: peer.localDescription });
});

app.post('/stop-broadcast', async ({ body }, res) => {
    const { roomId, userId } = body;
    console.log(`[STOP-BROADCAST] ${userId} stopped broadcasting in room ${roomId}`);
    
    removeUserStream(roomId, userId);
    
    res.json({ success: true });
});

// Mute status notification - no re-broadcast needed, just notify other users
app.post('/mute-status', async ({ body }, res) => {
    const { roomId, userId, kind, muted } = body;
    console.log(`[MUTE-STATUS] ${userId} ${kind} ${muted ? 'muted' : 'unmuted'} in room ${roomId}`);
    
    // Notify other users in the room about mute status change
    if (io) {
        io.to(roomId).emit('user-mute-status', { roomId, userId, kind, muted });
    }
    res.json({ success: true });
});

// Add user to pending broadcast queue
function addToPendingBroadcast(roomId, userId) {
    if (!pendingBroadcasts.has(roomId)) {
        pendingBroadcasts.set(roomId, new Set());
    }
    pendingBroadcasts.get(roomId).add(userId);
    console.log(`[QUEUE] Added ${userId} to pending broadcasts in room ${roomId}`);
}

// Remove user from pending broadcast queue and notify waiters
function removeFromPendingBroadcast(roomId, userId) {
    const pending = pendingBroadcasts.get(roomId);
    if (pending) {
        pending.delete(userId);
        console.log(`[QUEUE] Removed ${userId} from pending broadcasts in room ${roomId}`);
        
        // If queue is empty, resolve all waiters
        if (pending.size === 0) {
            const waiters = broadcastWaiters.get(roomId);
            if (waiters) {
                waiters.forEach(resolve => resolve());
                broadcastWaiters.delete(roomId);
                console.log(`[QUEUE] Room ${roomId} queue empty, notified waiters`);
            }
        }
    }
}

// Wait for pending broadcasts to complete
function waitForPendingBroadcasts(roomId) {
    const pending = pendingBroadcasts.get(roomId);
    if (!pending || pending.size === 0) {
        return Promise.resolve(); // Queue already empty
    }
    
    return new Promise(resolve => {
        if (!broadcastWaiters.has(roomId)) {
            broadcastWaiters.set(roomId, []);
        }
        broadcastWaiters.get(roomId).push(resolve);
        console.log(`[QUEUE] Consumer waiting for ${pending.size} pending broadcasts in room ${roomId}`);
    });
}

function handleTrackEvent(e, roomId, userId) {
    const stream = e.streams[0];
    const track = e.track;
    
    console.log(`[TRACK] Received from ${userId}: { kind: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState} }`);
    
    if (!roomUserStreams.has(roomId)) {
        roomUserStreams.set(roomId, new Map());
    }
    roomUserStreams.get(roomId).set(userId, stream);
    
    // Log current streams in room
    const streamCount = roomUserStreams.get(roomId).size;
    const streamUsers = Array.from(roomUserStreams.get(roomId).keys());
    console.log(`[TRACK] Room ${roomId} now has ${streamCount} stream(s): [${streamUsers.join(', ')}]`);
    
    // Remove from pending queue - broadcast is complete
    removeFromPendingBroadcast(roomId, userId);
    
    // Notify other users in the room about the new broadcaster
    if (io) {
        const room = io.sockets.adapter.rooms.get(roomId);
        const socketsInRoom = room ? room.size : 0;
        console.log(`[TRACK] Emitting 'new-broadcaster' for ${userId} to ${socketsInRoom} socket(s) in room ${roomId}`);
        io.to(roomId).emit('new-broadcaster', { roomId, userId });
    }
}

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

// Read SSL certificates
const sslOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH)
};

// Create HTTPS server
https.createServer(sslOptions, app).listen(5000, () => {
    console.log('HTTPS server for SFU socket started on port 5000');
});