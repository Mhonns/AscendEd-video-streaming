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
const path = require('path');
const fs = require('fs');

const RECORDINGS_DIR = path.join(__dirname, 'recordings');

const roomsModule = require('../rooms');
const recorder = require('.');

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
//
// Strategy: validate & dequeue the session immediately, broadcast 'recording-stopped'
// to all clients RIGHT AWAY (so the UI updates instantly), then let FFmpeg finish
// flushing the file in the background — the HTTP response is also sent immediately.
router.post('/stop', async (req, res) => {
    const { roomId, requesterId } = req.body;

    if (!roomId || !requesterId) {
        return res.status(400).json({ error: 'roomId and requesterId are required' });
    }

    const room = roomsModule.getRoom(roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    // Dequeue the session immediately so getStatus() returns inactive right away
    // and no new stop request can race with us. recorder.beginStop() removes the
    // session from activeSessions and returns it (or null if none).
    const session = recorder.dequeueSession(roomId);
    if (!session) {
        return res.status(400).json({ error: 'No active recording for this room' });
    }

    // ── Instant UI update ────────────────────────────────────────────────────
    // Broadcast BEFORE waiting for FFmpeg so every client un-freezes immediately.
    if (_io) {
        _io.to(roomId).emit('recording-stopped', {
            roomId,
            stoppedBy: requesterId
        });
    }

    // Respond to the HTTP caller right away — the file is not ready yet but
    // the client only needs the filename for informational display (not download).
    const fileName = require('path').basename(session.filePath);
    console.log(`[RecordingRoute] Recording stop initiated for room ${roomId}: ${fileName}`);
    res.json({ success: true, fileName });

    // ── Background save ──────────────────────────────────────────────────────
    // Actually stop the sinks, end the FFmpeg pipes, and wait for the process
    // to finish — all without blocking the request/response cycle above.
    session.stop().then(() => {
        console.log(`[RecordingRoute] Recording saved (background): ${fileName}`);
    }).catch((err) => {
        console.error(`[RecordingRoute] Error saving recording (background):`, err.message);
    });
});

// GET /api/recording/status/:roomId
router.get('/status/:roomId', (req, res) => {
    const { roomId } = req.params;
    const status = recorder.getStatus(roomId);
    res.json(status);
});

// GET /api/recording/list
// Returns all recordings in the recordings directory, newest first.
router.get('/list', (req, res) => {
    try {
        if (!fs.existsSync(RECORDINGS_DIR)) {
            return res.json({ success: true, recordings: [] });
        }

        const files = fs.readdirSync(RECORDINGS_DIR)
            .filter(f => f.endsWith('.mp4'))
            .map(f => {
                const filePath = path.join(RECORDINGS_DIR, f);
                const stat = fs.statSync(filePath);
                return {
                    name: f,
                    size: stat.size,
                    createdAt: stat.mtime.toISOString()
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ success: true, recordings: files });
    } catch (err) {
        console.error('[RecordingRoute] Error listing recordings:', err.message);
        res.status(500).json({ error: 'Failed to list recordings' });
    }
});

// GET /api/recording/download/:filename
// Streams an individual recording file as a downloadable attachment.
router.get('/download/:filename', (req, res) => {
    const { filename } = req.params;

    // Basic security: only allow simple filenames, no path traversal
    if (!filename || !/^[\w\-. ]+\.mp4$/i.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(RECORDINGS_DIR, filename);

    // Ensure resolved path is still inside RECORDINGS_DIR
    if (!filePath.startsWith(RECORDINGS_DIR + path.sep) && filePath !== RECORDINGS_DIR) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Recording not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');
    res.sendFile(filePath);
});

module.exports = router;
module.exports.setIo = setIo;

