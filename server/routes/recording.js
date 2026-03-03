/**
 * Recording REST Routes
 * Mounted at /api/recording
 *
 * POST /api/recording/start    — start recording (host only)
 * POST /api/recording/stop     — stop recording
 * GET  /api/recording/status/:roomId — current status
 *
 * Recordings are saved server-side only; no download endpoint is exposed.
 * Socket events 'recording-started' and 'recording-stopped' are broadcast
 * to the whole room so every connected client stays in sync.
 */

'use strict';

const express = require('express');
const router = express.Router();

const roomsModule = require('../rooms');
const recorder = require('../recorder');

// io instance is injected by main.js after Socket.io is initialised
let _io = null;
function setIo(io) { _io = io; }

// POST /api/recording/start
// Body: { roomId, requesterId }
router.post('/start', async (req, res) => {
    const { roomId, requesterId } = req.body;

    if (!roomId || !requesterId) {
        return res.status(400).json({ error: 'roomId and requesterId are required' });
    }

    const room = roomsModule.getRoom(roomId);
    if (!room || !room.isActive) {
        return res.status(404).json({ error: 'Room not found' });
    }

    const status = recorder.getStatus(roomId);
    if (status.active) {
        return res.status(409).json({ error: 'Recording already active' });
    }

    // Use the host as the priority user (video/screen recorded from host only)
    const priorityUserId = room.hostId || requesterId;

    const { iceServers } = require('../sfu');
    const result = await recorder.startRecording(roomId, priorityUserId, iceServers, room.name);

    if (!result.ok) {
        return res.status(500).json({ error: result.error });
    }

    // Broadcast to all room participants so every client updates its UI
    if (_io) {
        _io.to(roomId).emit('recording-started', {
            roomId,
            startedBy: requesterId,
            priorityUserId
        });
    }

    console.log(`[RecordingRoute] Recording started in room ${roomId} by ${requesterId} (priority: ${priorityUserId})`);
    res.json({ success: true, message: 'Recording started' });
});

// POST /api/recording/stop
// Body: { roomId, requesterId }
router.post('/stop', async (req, res) => {
    const { roomId, requesterId } = req.body;

    if (!roomId || !requesterId) {
        return res.status(400).json({ error: 'roomId and requesterId are required' });
    }

    const room = roomsModule.getRoom(roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    const result = await recorder.stopRecording(roomId);

    if (!result.ok) {
        return res.status(400).json({ error: result.error });
    }

    // Broadcast to all room participants
    if (_io) {
        _io.to(roomId).emit('recording-stopped', {
            roomId,
            stoppedBy: requesterId
        });
    }

    const fileName = require('path').basename(result.filePath);
    console.log(`[RecordingRoute] Recording stopped for room ${roomId}: ${fileName}`);
    res.json({ success: true, fileName });
});

// GET /api/recording/status/:roomId
router.get('/status/:roomId', (req, res) => {
    const { roomId } = req.params;
    const status = recorder.getStatus(roomId);
    res.json(status);
});

module.exports = router;
module.exports.setIo = setIo;
