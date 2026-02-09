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

/**
 * Stream Types:
 * - main: audio only (always broadcast when mic is on)
 * - camera: camera video only (for sidebar display)
 * - screen: screen share video only
 * - media: combined audio + camera stream (auto-created from main + camera)
 * 
 * Storage key format: "userId:streamType" (e.g., "user123:main", "user123:camera")
 * 
 * Audio (main) and camera tracks are automatically combined into a single "media" stream per user.
 * This allows consumers to receive one stream with both audio and video tracks instead of separate streams.
 * Screen shares remain as separate streams.
 */

// Map to store room -> stream key -> MediaStream
// Key format: "userId:streamType" where streamType is 'main', 'screen', 'camera', or 'media'
const roomUserStreams = new Map();

// Map to store combined media streams: roomId -> userId -> MediaStream
// This combines audio (main) and camera tracks into one stream
const roomCombinedStreams = new Map();

// Map to track broadcaster peer connections: roomId -> streamKey -> peer
const broadcasterPeers = new Map();

// Map to track consumer peer connections: roomId -> oderId -> peer
const consumerPeers = new Map();

// Queue to track pending broadcasts: roomId -> Set of streamKeys currently broadcasting
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

/**
 * Helper to create stream key
 */
function makeStreamKey(userId, streamType) {
    return `${userId}:${streamType}`;
}

/**
 * Helper to parse stream key
 */
function parseStreamKey(streamKey) {
    const [userId, streamType] = streamKey.split(':');
    return { userId, streamType };
}

/**
 * Consumer endpoint - receives all streams from the room
 * Returns metadata about which streams belong to which users
 * 
 * Sends combined "media" streams (audio + camera) when available,
 * and separate "screen" streams for screen shares.
 */
app.post("/consumer", async ({ body }, res) => {    
    const { sdp, roomId, userId } = body;
    console.log(`[CONSUME] ${userId} -> room ${roomId}`);
    
    // Wait for any pending broadcasts to complete first
    await waitForPendingBroadcasts(roomId);
    
    const peer = new webrtc.RTCPeerConnection({ iceServers });
    
    // Track consumer peer connection by oderId (the user consuming streams)
    if (!consumerPeers.has(roomId)) {
        consumerPeers.set(roomId, new Map());
    }
    consumerPeers.get(roomId).set(userId, peer);
    
    // Send ICE candidates to client via Socket.io
    peer.onicecandidate = (event) => {
        if (event.candidate && io) {
            io.to(roomId).emit('ice-candidate', {
                candidate: event.candidate,
                oderId: userId,
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
    const streamKeys = roomStreams ? Array.from(roomStreams.keys()) : [];
    console.log(`[CONSUME] Room ${roomId} has ${streamCount} stream(s): [${streamKeys.join(', ')}]`);
    
    // Build metadata about streams for the client
    const streamMetadata = [];
    
    // Store the consuming user's ID for the loop
    const consumerId = userId;
    
    // Track which users we've already sent combined streams for
    const sentCombinedFor = new Set();
    
    if (roomStreams) {
        let tracksAdded = 0;
        
        // First pass: send combined "media" streams (audio + camera)
        roomStreams.forEach((stream, streamKey) => {
            const { userId: streamUserId, streamType } = parseStreamKey(streamKey);
            
            // Don't send user's own streams back (prevents echo)
            if (streamUserId === consumerId) {
                console.log(`[CONSUME] Skipping own stream ${streamKey}`);
                return;
            }
            
            // For combined "media" streams, send them and mark user as handled
            if (streamType === 'media') {
                sentCombinedFor.add(streamUserId);
                
                // Add metadata for this stream
                streamMetadata.push({
                    streamId: stream.id,
                    oderId: streamUserId,
                    streamType: 'media'
                });
                
                stream.getTracks().forEach(track => {
                    console.log(`[CONSUME] Sending combined track from ${streamKey} to ${consumerId}: { kind: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState} }`);
                    peer.addTrack(track, stream);
                    tracksAdded++;
                });
            }
        });
        
        // Second pass: send screen shares and any standalone audio/camera (if no combined stream)
        roomStreams.forEach((stream, streamKey) => {
            const { userId: streamUserId, streamType } = parseStreamKey(streamKey);
            
            // Don't send user's own streams back
            if (streamUserId === consumerId) {
                return;
            }
            
            // Screen shares are always sent separately
            if (streamType === 'screen') {
                streamMetadata.push({
                    streamId: stream.id,
                    oderId: streamUserId,
                    streamType: 'screen'
                });
                
                stream.getTracks().forEach(track => {
                    console.log(`[CONSUME] Sending screen track from ${streamKey} to ${consumerId}: { kind: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState} }`);
                    peer.addTrack(track, stream);
                    tracksAdded++;
                });
            }
            
            // Only send standalone main/camera if no combined stream exists for this user
            if ((streamType === 'main' || streamType === 'camera') && !sentCombinedFor.has(streamUserId)) {
                streamMetadata.push({
                    streamId: stream.id,
                    oderId: streamUserId,
                    streamType
                });
                
                stream.getTracks().forEach(track => {
                    console.log(`[CONSUME] Sending standalone track from ${streamKey} to ${consumerId}: { kind: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState} }`);
                    peer.addTrack(track, stream);
                    tracksAdded++;
                });
            }
        });
        
        console.log(`[CONSUME] Added ${tracksAdded} track(s) for ${consumerId}`);
    } else {
        console.log(`[CONSUME] WARNING: No streams in room ${roomId}`);
    }

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    // Return both SDP answer and stream metadata
    res.json({ 
        sdp: peer.localDescription,
        streamMetadata 
    });
});

/**
 * Generic broadcast handler - used by all stream type endpoints
 */
async function handleBroadcast(sdp, roomId, userId, streamType) {
    const streamKey = makeStreamKey(userId, streamType);
    console.log(`[BROADCAST-${streamType.toUpperCase()}] ${userId} -> room ${roomId} (key: ${streamKey})`);
    
    // Add to pending queue - consumers will wait for this to complete
    addToPendingBroadcast(roomId, streamKey);
    
    const peer = new webrtc.RTCPeerConnection({ iceServers });
    
    // Track broadcaster peer connection by streamKey
    if (!broadcasterPeers.has(roomId)) {
        broadcasterPeers.set(roomId, new Map());
    }
    
    // Close existing peer for this stream type if any
    const existingPeer = broadcasterPeers.get(roomId).get(streamKey);
    if (existingPeer) {
        try { existingPeer.close(); } catch (_) {}
    }
    
    broadcasterPeers.get(roomId).set(streamKey, peer);
    
    // Send ICE candidates to client via Socket.io
    peer.onicecandidate = (event) => {
        if (event.candidate && io) {
            io.to(roomId).emit('ice-candidate', {
                candidate: event.candidate,
                userId,
                streamType,
                streamKey,
                type: 'broadcaster'
            });
        }
    };
    
    // Auto-cleanup on disconnect
    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'disconnected' || 
            peer.iceConnectionState === 'failed' ||
            peer.iceConnectionState === 'closed') {
            removeStream(roomId, userId, streamType);
        }
    };
    
    peer.ontrack = (e) => handleTrackEvent(e, roomId, userId, streamType);
    
    const desc = new webrtc.RTCSessionDescription(sdp);
    await peer.setRemoteDescription(desc);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    return { sdp: peer.localDescription, streamKey };
}

/**
 * Broadcast audio (main stream)
 */
app.post('/broadcast-audio', async ({ body }, res) => {
    const { sdp, roomId, userId } = body;
    try {
        const result = await handleBroadcast(sdp, roomId, userId, 'main');
        res.json(result);
    } catch (error) {
        console.error('[BROADCAST-AUDIO] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Broadcast camera video
 */
app.post('/broadcast-camera', async ({ body }, res) => {
    const { sdp, roomId, userId } = body;
    try {
        const result = await handleBroadcast(sdp, roomId, userId, 'camera');
        res.json(result);
    } catch (error) {
        console.error('[BROADCAST-CAMERA] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Broadcast screen share video
 */
app.post('/broadcast-screen', async ({ body }, res) => {
    const { sdp, roomId, userId } = body;
    try {
        const result = await handleBroadcast(sdp, roomId, userId, 'screen');
        res.json(result);
    } catch (error) {
        console.error('[BROADCAST-SCREEN] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Legacy broadcast endpoint - maps to 'main' stream type for backward compatibility
 */
app.post('/broadcast', async ({ body }, res) => {
    const { sdp, roomId, userId } = body;
    console.log(`[BROADCAST-LEGACY] ${userId} -> room ${roomId} (using 'main' type)`);
    try {
        const result = await handleBroadcast(sdp, roomId, userId, 'main');
        res.json(result);
    } catch (error) {
        console.error('[BROADCAST-LEGACY] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Stop a specific stream type
 */
app.post('/stop-stream', async ({ body }, res) => {
    const { roomId, userId, streamType } = body;
    console.log(`[STOP-STREAM] ${userId} stopped ${streamType} in room ${roomId}`);
    
    removeStream(roomId, userId, streamType);
    
    res.json({ success: true });
});

/**
 * Legacy stop-broadcast endpoint - stops all streams for user
 */
app.post('/stop-broadcast', async ({ body }, res) => {
    const { roomId, userId } = body;
    console.log(`[STOP-BROADCAST] ${userId} stopped all broadcasting in room ${roomId}`);
    
    // Remove all stream types for this user
    ['main', 'screen', 'camera'].forEach(streamType => {
        removeStream(roomId, userId, streamType);
    });
    
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

// Request remote user to stop screen share
app.post('/request-stop-screenshare', async ({ body }, res) => {
    const { roomId, targetUserId, requesterId } = body;
    console.log(`[STOP-SCREENSHARE-REQUEST] ${requesterId} requested ${targetUserId} to stop screen share in room ${roomId}`);
    
    if (io) {
        io.to(roomId).emit('stop-screenshare-request', { 
            roomId, 
            targetUserId, 
            requesterId 
        });
    }
    res.json({ success: true });
});

// Add streamKey to pending broadcast queue
function addToPendingBroadcast(roomId, streamKey) {
    if (!pendingBroadcasts.has(roomId)) {
        pendingBroadcasts.set(roomId, new Set());
    }
    pendingBroadcasts.get(roomId).add(streamKey);
    console.log(`[QUEUE] Added ${streamKey} to pending broadcasts in room ${roomId}`);
}

// Remove streamKey from pending broadcast queue and notify waiters
function removeFromPendingBroadcast(roomId, streamKey) {
    const pending = pendingBroadcasts.get(roomId);
    if (pending) {
        pending.delete(streamKey);
        console.log(`[QUEUE] Removed ${streamKey} from pending broadcasts in room ${roomId}`);
        
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
        return Promise.resolve();
    }
    
    return new Promise(resolve => {
        if (!broadcastWaiters.has(roomId)) {
            broadcastWaiters.set(roomId, []);
        }
        broadcastWaiters.get(roomId).push(resolve);
        console.log(`[QUEUE] Consumer waiting for ${pending.size} pending broadcasts in room ${roomId}`);
    });
}

/**
 * Get or create combined media stream for a user (audio + camera)
 */
function getCombinedStream(roomId, userId) {
    if (!roomCombinedStreams.has(roomId)) {
        roomCombinedStreams.set(roomId, new Map());
    }
    
    const userStreams = roomCombinedStreams.get(roomId);
    if (!userStreams.has(userId)) {
        // Create a new MediaStream for combining audio + camera
        const combinedStream = new webrtc.MediaStream();
        userStreams.set(userId, combinedStream);
        console.log(`[COMBINED] Created new combined stream for ${userId} in room ${roomId}`);
    }
    
    return userStreams.get(userId);
}

/**
 * Add track to user's combined media stream
 */
function addToCombinedStream(roomId, userId, track) {
    const combinedStream = getCombinedStream(roomId, userId);
    
    // Remove existing track of same kind to prevent duplicates
    if (track.kind === 'video') {
        combinedStream.getVideoTracks().forEach(t => {
            combinedStream.removeTrack(t);
            console.log(`[COMBINED] Removed old video track from ${userId}'s combined stream`);
        });
    }
    if (track.kind === 'audio') {
        combinedStream.getAudioTracks().forEach(t => {
            combinedStream.removeTrack(t);
            console.log(`[COMBINED] Removed old audio track from ${userId}'s combined stream`);
        });
    }
    
    // Add the new track
    combinedStream.addTrack(track);
    console.log(`[COMBINED] Added ${track.kind} track to ${userId}'s combined stream`);
    
    // Store the combined stream in roomUserStreams for consumers to access
    const combinedKey = makeStreamKey(userId, 'media');
    if (!roomUserStreams.has(roomId)) {
        roomUserStreams.set(roomId, new Map());
    }
    roomUserStreams.get(roomId).set(combinedKey, combinedStream);
    
    // Log combined stream status
    const audioTracks = combinedStream.getAudioTracks().length;
    const videoTracks = combinedStream.getVideoTracks().length;
    console.log(`[COMBINED] ${userId}'s combined stream now has ${audioTracks} audio, ${videoTracks} video tracks`);
    
    return combinedStream;
}

/**
 * Remove track from user's combined media stream
 */
function removeFromCombinedStream(roomId, userId, trackKind) {
    const userStreams = roomCombinedStreams.get(roomId);
    if (!userStreams) return;
    
    const combinedStream = userStreams.get(userId);
    if (!combinedStream) return;
    
    if (trackKind === 'video') {
        combinedStream.getVideoTracks().forEach(t => {
            combinedStream.removeTrack(t);
        });
        console.log(`[COMBINED] Removed video from ${userId}'s combined stream`);
    }
    if (trackKind === 'audio') {
        combinedStream.getAudioTracks().forEach(t => {
            combinedStream.removeTrack(t);
        });
        console.log(`[COMBINED] Removed audio from ${userId}'s combined stream`);
    }
    
    // If combined stream is empty, remove it entirely
    if (combinedStream.getTracks().length === 0) {
        userStreams.delete(userId);
        const combinedKey = makeStreamKey(userId, 'media');
        const roomStreams = roomUserStreams.get(roomId);
        if (roomStreams) {
            roomStreams.delete(combinedKey);
        }
        console.log(`[COMBINED] Removed empty combined stream for ${userId}`);
    }
}

function handleTrackEvent(e, roomId, userId, streamType) {
    const stream = e.streams[0];
    const track = e.track;
    const streamKey = makeStreamKey(userId, streamType);
    
    console.log(`[TRACK] Received from ${streamKey}: { kind: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState} }`);
    
    if (!roomUserStreams.has(roomId)) {
        roomUserStreams.set(roomId, new Map());
    }
    
    // Store the original stream (for reference/debugging)
    roomUserStreams.get(roomId).set(streamKey, stream);
    
    // For audio (main) and camera streams, also add to combined stream
    if (streamType === 'main' || streamType === 'camera') {
        addToCombinedStream(roomId, userId, track);
    }
    
    // Log current streams in room
    const streamCount = roomUserStreams.get(roomId).size;
    const streamKeys = Array.from(roomUserStreams.get(roomId).keys());
    console.log(`[TRACK] Room ${roomId} now has ${streamCount} stream(s): [${streamKeys.join(', ')}]`);
    
    // Remove from pending queue - broadcast is complete
    removeFromPendingBroadcast(roomId, streamKey);
    
    // Notify other users in the room about the new stream
    if (io) {
        const room = io.sockets.adapter.rooms.get(roomId);
        const socketsInRoom = room ? room.size : 0;
        console.log(`[TRACK] Emitting 'new-stream' for ${streamKey} to ${socketsInRoom} socket(s) in room ${roomId}`);
        io.to(roomId).emit('new-stream', { 
            roomId, 
            userId, 
            streamType,
            streamKey,
            streamId: stream.id
        });
    }
}

function destroyRoomStreams(roomId) {
    if (roomUserStreams.has(roomId)) {
        roomUserStreams.delete(roomId);
    }
    // Clean up combined streams map
    if (roomCombinedStreams.has(roomId)) {
        roomCombinedStreams.delete(roomId);
    }
    // Close all broadcaster peer connections for this room
    const roomBroadcasters = broadcasterPeers.get(roomId);
    if (roomBroadcasters) {
        roomBroadcasters.forEach((peer) => {
            try { peer.close(); } catch (_) {}
        });
        broadcasterPeers.delete(roomId);
    }
    // Close all consumer peer connections for this room
    const roomConsumers = consumerPeers.get(roomId);
    if (roomConsumers) {
        roomConsumers.forEach((peer) => {
            try { peer.close(); } catch (_) {}
        });
        consumerPeers.delete(roomId);
    }
}

/**
 * Remove a specific stream type for a user
 */
function removeStream(roomId, userId, streamType) {
    const streamKey = makeStreamKey(userId, streamType);
    
    const roomStreams = roomUserStreams.get(roomId);
    if (roomStreams) {
        roomStreams.delete(streamKey);
    }
    
    // Close broadcaster peer connection for this stream
    const roomBroadcasters = broadcasterPeers.get(roomId);
    if (roomBroadcasters) {
        const peer = roomBroadcasters.get(streamKey);
        if (peer) {
            try { peer.close(); } catch (_) {}
            roomBroadcasters.delete(streamKey);
        }
    }
    
    // For audio (main) and camera streams, also remove from combined stream
    if (streamType === 'main') {
        removeFromCombinedStream(roomId, userId, 'audio');
    } else if (streamType === 'camera') {
        removeFromCombinedStream(roomId, userId, 'video');
    }
    
    // Notify other users in the room that stream stopped
    if (io) {
        io.to(roomId).emit('stream-stopped', { 
            roomId, 
            userId, 
            streamType,
            streamKey 
        });
    }
    
    console.log(`[REMOVE-STREAM] Removed ${streamKey} from room ${roomId}`);
}

/**
 * Remove all streams for a user (when they leave)
 */
function removeUserStreams(roomId, userId) {
    ['main', 'screen', 'camera'].forEach(streamType => {
        removeStream(roomId, userId, streamType);
    });
    
    // Also clean up combined stream entry directly
    const userStreams = roomCombinedStreams.get(roomId);
    if (userStreams) {
        userStreams.delete(userId);
    }
}

function removeConsumer(roomId, oderId) {
    const roomConsumers = consumerPeers.get(roomId);
    if (roomConsumers) {
        const peer = roomConsumers.get(oderId);
        if (peer) {
            try { peer.close(); } catch (_) {}
            roomConsumers.delete(oderId);
        }
    }
}

async function addIceCandidate(roomId, oderId, candidate, type, streamKey) {
    let peer = null;
    
    if (type === 'broadcaster' && streamKey) {
        const roomBroadcasters = broadcasterPeers.get(roomId);
        if (roomBroadcasters) {
            peer = roomBroadcasters.get(streamKey);
        }
    } else if (type === 'consumer') {
        const roomConsumers = consumerPeers.get(roomId);
        if (roomConsumers) {
            peer = roomConsumers.get(oderId);
        }
    }
    
    if (peer && candidate) {
        try {
            await peer.addIceCandidate(new webrtc.RTCIceCandidate(candidate));
            console.log(`[ICE] Added candidate for ${type} ${streamKey || oderId}`);
        } catch (error) {
            console.error('[ICE] Error adding ICE candidate:', error);
        }
    }
}

module.exports = {
    roomUserStreams,
    destroyRoomStreams,
    removeStream,
    removeUserStreams,
    removeConsumer,
    addIceCandidate,
    iceServers,
    setIo,
    makeStreamKey,
    parseStreamKey
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
