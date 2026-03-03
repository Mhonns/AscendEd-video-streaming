/**
 * Recorder Module
 * Server-side recording using wrtc + FFmpeg.
 *
 * Layout:
 *   - Screen share from priority user → fullscreen (fd:3)
 *   - Camera from priority user       → PiP overlay, bottom-right (fd:4)
 *   - Audio from ALL users            → PCM-summed mono mix (fd:5)
 *
 * If the priority user has no screen share, only the camera is recorded fullscreen.
 * Recordings are saved to server/recorder/recordings/ and are NOT downloadable by clients.
 *
 * Only one active recording per room is allowed.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const webrtc = require('wrtc');

const { RTCVideoSink, RTCAudioSink } = webrtc.nonstandard;

// Import SFU internals
const sfuModule = require('../sfu');

// Output directory (auto-created if missing)
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// roomId -> RecordingSession
const activeSessions = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start recording in a given room.
 * @param {string} roomId
 * @param {string} priorityUserId  - video/screen is recorded only from this user
 * @param {object} iceServers
 * @returns {{ ok: boolean, error?: string }}
 */
async function startRecording(roomId, priorityUserId, iceServers, meetingName) {
    if (activeSessions.has(roomId)) {
        return { ok: false, error: 'Recording already active for this room' };
    }

    const session = new RecordingSession(roomId, priorityUserId, iceServers, meetingName);
    activeSessions.set(roomId, session);

    try {
        await session.start();
        return { ok: true };
    } catch (err) {
        activeSessions.delete(roomId);
        session.destroy();
        return { ok: false, error: err.message };
    }
}

/**
 * Stop the active recording for a room.
 * @returns {{ ok: boolean, filePath?: string, error?: string }}
 */
async function stopRecording(roomId) {
    const session = activeSessions.get(roomId);
    if (!session) {
        return { ok: false, error: 'No active recording for this room' };
    }

    activeSessions.delete(roomId);
    const filePath = await session.stop();
    return { ok: true, filePath };
}

/**
 * Return status for a room.
 */
function getStatus(roomId) {
    const session = activeSessions.get(roomId);
    if (!session) return { active: false };
    return {
        active: true,
        startedAt: session.startedAt,
        priorityUserId: session.priorityUserId,
        filePath: session.filePath
    };
}

// ---------------------------------------------------------------------------
// RecordingSession class
// ---------------------------------------------------------------------------

// Mix multiple int16 PCM buffers into one array, clamping to int16 range
function mixPCMBuffers(buffers) {
    if (buffers.length === 0) return Buffer.alloc(0);

    const len = buffers[0].length; // byte length; each sample = 2 bytes
    const sampleCount = len / 2;
    const out = new Int16Array(sampleCount);

    for (const buf of buffers) {
        const view = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
        for (let i = 0; i < sampleCount; i++) {
            // Sum and clamp
            out[i] = Math.max(-32768, Math.min(32767, out[i] + view[i]));
        }
    }

    return Buffer.from(out.buffer);
}

class RecordingSession {
    constructor(roomId, priorityUserId, iceServers, meetingName) {
        this.roomId = roomId;
        this.priorityUserId = priorityUserId;
        this.iceServers = iceServers;
        this.startedAt = new Date();

        // Build filename: meetingName-DD-MM-YYYY.mp4
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const dateStr = `${dd}-${mm}-${yyyy}`;

        // Sanitize meeting name: keep letters, numbers, spaces/dashes/underscores
        const safeName = (meetingName || roomId)
            .replace(/[^\w\s\-]/g, '')   // strip special chars
            .trim()
            .replace(/\s+/g, '_')        // spaces → underscores
            || roomId;

        // Avoid collision if a file with the same name already exists
        let filePath = path.join(RECORDINGS_DIR, `${safeName}-${dateStr}.mp4`);
        let counter = 1;
        while (fs.existsSync(filePath)) {
            filePath = path.join(RECORDINGS_DIR, `${safeName}-${dateStr}-${counter}.mp4`);
            counter++;
        }
        this.filePath = filePath;

        this.peer = null;
        this.ffmpeg = null;

        // Sinks for priority user
        this.screenSink = null;   // priority user screen → fd:3
        this.cameraSink = null;   // priority user camera → fd:4
        // Audio sinks for ALL users: userId -> RTCAudioSink
        this.audioSinks = new Map();

        // Recorded frame dimensions
        this._screenWidth = 1920;
        this._screenHeight = 1080;
        this._cameraWidth = 640;
        this._cameraHeight = 480;
        this._sampleRate = 48000;
        this._channelCount = 1;

        // Ready flags
        this._screenReady = false;
        this._ffmpegStarted = false;

        // Queues before ffmpeg is ready
        this._screenQueue = [];
        this._cameraQueue = [];
        this._audioQueue = [];

        // Per-user latest audio chunk (for mixing)
        this._latestAudioChunks = new Map(); // userId -> Buffer

        // Black frame filler for "camera off" (640x480)
        this._lastCameraFrameTime = 0;
        this._blackFrame = Buffer.concat([
            Buffer.alloc(640 * 480, 16),      // Y (Luma - black is ~16 in limited range)
            Buffer.alloc(640 * 480 / 2, 128)  // U/V (Chroma - 128 is neutral)
        ]);
        this._fillerInterval = null;
    }

    // -------------------------------------------------------------------------
    // start() — open wrtc consumer and wait for tracks
    // -------------------------------------------------------------------------
    async start() {
        const { roomId, priorityUserId, iceServers } = this;

        console.log(`[Recorder] Starting recording for room ${roomId}, priority user ${priorityUserId}`);

        // Build SDP offer (many transceivers to capture all streams in room)
        const peer = new webrtc.RTCPeerConnection({ iceServers });
        this.peer = peer;

        // Add generous number of transceivers: audio for every participant + 2 videos per user
        // Using 8 audio + 8 video as generous headroom
        for (let i = 0; i < 8; i++) {
            peer.addTransceiver('audio', { direction: 'recvonly' });
        }
        for (let i = 0; i < 8; i++) {
            peer.addTransceiver('video', { direction: 'recvonly' });
        }

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        // POST to the SFU /consumer endpoint running on localhost:5000
        const fetch = require('node-fetch');
        const https = require('https');
        const agent = new https.Agent({ rejectUnauthorized: false });

        const botUserId = `recorder_${roomId}`;
        const sfuBaseUrl = 'https://localhost:5000';

        const res = await fetch(`${sfuBaseUrl}/consumer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: peer.localDescription, roomId, userId: botUserId }),
            agent
        });

        if (!res.ok) {
            throw new Error(`[Recorder] /consumer returned ${res.status}`);
        }

        const data = await res.json();

        // Build metadata maps
        // streamId -> { oderId, streamType }
        const streamMeta = new Map();
        if (data.streamMetadata) {
            for (const m of data.streamMetadata) {
                streamMeta.set(m.streamId, { oderId: m.oderId, streamType: m.streamType });
            }
        }

        // Attach track handler before setRemoteDescription
        peer.ontrack = (event) => {
            const track = event.track;
            const stream = event.streams[0];
            if (!stream) return;

            const meta = streamMeta.get(stream.id);
            if (!meta) {
                console.log(`[Recorder] No metadata for stream ${stream.id}, skipping`);
                return;
            }

            const { oderId, streamType } = meta;

            // VIDEO: only from priority user
            if (track.kind === 'video') {
                if (oderId !== priorityUserId) {
                    console.log(`[Recorder] Ignoring video from non-priority user ${oderId}`);
                    return;
                }

                if (streamType === 'screen') {
                    console.log(`[Recorder] Attaching SCREEN sink for priority user ${oderId}`);
                    this._attachScreenSink(track);
                } else if (streamType === 'camera' || streamType === 'media') {
                    console.log(`[Recorder] Attaching CAMERA sink for priority user ${oderId}`);
                    this._attachCameraSink(track);
                }
            }

            // AUDIO: from ALL users
            if (track.kind === 'audio') {
                console.log(`[Recorder] Attaching AUDIO sink for user ${oderId}`);
                this._attachAudioSink(track, oderId);
            }
        };

        await peer.setRemoteDescription(new webrtc.RTCSessionDescription(data.sdp));
        console.log(`[Recorder] Consumer SDP set. Waiting for tracks…`);
    }

    // -------------------------------------------------------------------------
    // Screen sink (priority user screen → fd:3)
    // -------------------------------------------------------------------------
    _attachScreenSink(track) {
        if (this.screenSink) return;
        this.screenSink = new RTCVideoSink(track);

        this.screenSink.addEventListener('frame', ({ frame }) => {
            const { width, height, data } = frame;

            if (!this._ffmpegStarted) {
                this._screenWidth = width;
                this._screenHeight = height;
                this._screenReady = true;
                this._screenQueue.push(Buffer.from(data));
                this._trySpawnFFmpeg();
                return;
            }

            if (this.ffmpeg?.stdio[3]?.writable) {
                try { this.ffmpeg.stdio[3].write(Buffer.from(data)); } catch (_) { }
            }
        });
    }

    // -------------------------------------------------------------------------
    // Camera sink (priority user camera → fd:4)
    // -------------------------------------------------------------------------
    _attachCameraSink(track) {
        if (this.cameraSink) return;
        this.cameraSink = new RTCVideoSink(track);

        this.cameraSink.addEventListener('frame', ({ frame }) => {
            const { width, height, data } = frame;
            this._lastCameraFrameTime = Date.now();

            if (!this._ffmpegStarted) {
                this._cameraWidth = width;
                this._cameraHeight = height;
                this._cameraQueue.push(Buffer.from(data));
                return;
            }

            if (this.ffmpeg?.stdio[this._cameraPipeIdx]?.writable) {
                try { this.ffmpeg.stdio[this._cameraPipeIdx].write(Buffer.from(data)); } catch (_) { }
            }
        });
    }

    // -------------------------------------------------------------------------
    // Audio sink — one per user, all mixed into fd:5
    // -------------------------------------------------------------------------
    _attachAudioSink(track, userId) {
        if (this.audioSinks.has(userId)) return;

        const sink = new RTCAudioSink(track);
        this.audioSinks.set(userId, sink);

        sink.addEventListener('data', ({ samples, sampleRate, channelCount }) => {
            if (!this._ffmpegStarted) {
                this._sampleRate = sampleRate || 48000;
                this._channelCount = channelCount || 1;
                // Store latest chunk per user for mixing
                this._latestAudioChunks.set(userId, Buffer.from(samples.buffer));

                // Try to spawn once screen is ready (audio is optional but nice to have early)
                this._trySpawnFFmpeg();

                // Queue a mixed chunk
                const mixed = mixPCMBuffers(Array.from(this._latestAudioChunks.values()));
                this._audioQueue.push(mixed);
                return;
            }

            // Live mix: collect latest chunk per user, mix, write
            this._latestAudioChunks.set(userId, Buffer.from(samples.buffer));
            const mixed = mixPCMBuffers(Array.from(this._latestAudioChunks.values()));

            if (this.ffmpeg?.stdio[this._audioPipeIdx]?.writable) {
                try { this.ffmpeg.stdio[this._audioPipeIdx].write(mixed); } catch (_) { }
            }
        });
    }

    // -------------------------------------------------------------------------
    // Spawn FFmpeg once any track is ready. 
    // We wait 1000ms for other tracks (camera/audio) to arrive so we can build a dynamic layout.
    // -------------------------------------------------------------------------
    _trySpawnFFmpeg() {
        if (this._ffmpegStarted || this._spawnTimer) return;

        console.log(`[Recorder] First track received, scheduling FFmpeg spawn in 1000ms...`);
        this._spawnTimer = setTimeout(() => {
            this._spawnFFmpeg();
        }, 1000);
    }

    _spawnFFmpeg() {
        if (this._ffmpegStarted) return;
        this._ffmpegStarted = true;
        this._spawnTimer = null;

        const hasScreen = !!this.screenSink;
        const hasCamera = !!this.cameraSink;
        const hasAudio = this.audioSinks.size > 0;

        if (!hasScreen && !hasCamera && !hasAudio) {
            console.log(`[Recorder] No tracks arrived in time. Aborting FFmpeg spawn.`);
            return;
        }

        const sw = this._screenWidth;
        const sh = this._screenHeight;
        const cw = this._cameraWidth;
        const ch = this._cameraHeight;
        const ar = this._sampleRate || 48000;

        const args = ['-loglevel', 'warning'];
        const stdio = ['ignore', 'inherit', 'inherit']; // stdin, stdout, stderr
        let inputCount = 0;
        let videoMap = '';
        let audioMap = '';

        // Input 0: Screen (fd:3)
        if (hasScreen) {
            const pipeIdx = 3 + inputCount;
            args.push('-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${sw}x${sh}`, '-r', '30', '-i', `pipe:${pipeIdx}`);
            stdio.push('pipe');
            this._screenPipeIdx = pipeIdx;
            inputCount++;
        }

        // Input 1: Camera (fd:4 etc)
        if (hasCamera) {
            const pipeIdx = 3 + inputCount;
            args.push('-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${cw}x${ch}`, '-r', '30', '-i', `pipe:${pipeIdx}`);
            stdio.push('pipe');
            this._cameraPipeIdx = pipeIdx;
            inputCount++;
        }

        // Input 2: Audio (fd:5 etc)
        if (hasAudio) {
            const pipeIdx = 3 + inputCount;
            args.push('-f', 's16le', '-ar', String(ar), '-ac', '1', '-i', `pipe:${pipeIdx}`);
            stdio.push('pipe');
            this._audioPipeIdx = pipeIdx;
            audioMap = `${inputCount}:a`; // the 'n' in 'n:a' is the input index (0, 1, or 2)
            inputCount++;
        }

        // Filter Logic: Overlay camera in top-right if both exist
        if (hasScreen && hasCamera) {
            const pipW = Math.round(sw * 0.22);
            const pipH = Math.round(pipW * (ch / cw));
            const margin = 16;
            // Get ffmpeg input indices (0-indexed)
            // If screen is first, it's 0. If camera is next, it's 1.
            const screenIdx = this._screenPipeIdx - 3;
            const cameraIdx = this._cameraPipeIdx - 3;
            args.push('-filter_complex', `[${cameraIdx}:v]scale=${pipW}:${pipH}[cam];[${screenIdx}:v][cam]overlay=W-w-${margin}:${margin}[out]`);
            videoMap = '[out]';
        } else if (hasScreen) {
            videoMap = `${this._screenPipeIdx - 3}:v`;
        } else if (hasCamera) {
            videoMap = `${this._cameraPipeIdx - 3}:v`;
        }

        // Determine audio mapping
        if (hasAudio) {
            audioMap = `${this._audioPipeIdx - 3}:a`;
        }

        if (videoMap) args.push('-map', videoMap);
        if (audioMap) args.push('-map', audioMap);

        // Encoding & Output
        args.push(
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart', '-y', this.filePath
        );

        console.log(`[Recorder] Spawning FFmpeg with ${inputCount} inputs. Screen:${hasScreen}, Camera:${hasCamera}, Audio:${hasAudio}`);
        this.ffmpeg = spawn('ffmpeg', args, { stdio });

        // Start filler interval: if no real camera frames arrive, send black frames to Pipe
        if (hasCamera) {
            this._fillerInterval = setInterval(() => {
                const now = Date.now();
                // If no frame in last 100ms and pipe is writable, send black
                if (now - this._lastCameraFrameTime > 100 && this.ffmpeg?.stdio[this._cameraPipeIdx]?.writable) {
                    try { this.ffmpeg.stdio[this._cameraPipeIdx].write(this._blackFrame); } catch (_) { }
                }
            }, 33); // ~30 fps
        }

        this.ffmpeg.on('close', (code) => {
            console.log(`[Recorder] FFmpeg exited with code ${code}`);
        });

        this.ffmpeg.on('error', (err) => {
            console.error('[Recorder] FFmpeg error:', err.message);
        });

        // Drain queued screen frames
        if (hasScreen) {
            for (const buf of this._screenQueue) {
                try { this.ffmpeg.stdio[this._screenPipeIdx].write(buf); } catch (_) { }
            }
            this._screenQueue = [];
        }

        // Drain queued camera frames
        if (hasCamera) {
            for (const buf of this._cameraQueue) {
                try { this.ffmpeg.stdio[this._cameraPipeIdx].write(buf); } catch (_) { }
            }
            this._cameraQueue = [];
        }

        // Drain queued audio chunks
        if (hasAudio) {
            for (const buf of this._audioQueue) {
                try { this.ffmpeg.stdio[this._audioPipeIdx].write(buf); } catch (_) { }
            }
            this._audioQueue = [];
        }
    }

    // -------------------------------------------------------------------------
    // stop() — finalize ffmpeg and close peer
    // -------------------------------------------------------------------------
    async stop() {
        console.log(`[Recorder] Stopping recording for room ${this.roomId}`);

        // Stop video sinks
        try { this.screenSink?.stop(); } catch (_) { }
        try { this.cameraSink?.stop(); } catch (_) { }

        // Stop all audio sinks
        this.audioSinks.forEach(sink => {
            try { sink.stop(); } catch (_) { }
        });
        this.audioSinks.clear();

        if (this._fillerInterval) {
            clearInterval(this._fillerInterval);
            this._fillerInterval = null;
        }

        if (this.ffmpeg) {
            // Close all input pipes so FFmpeg finalizes the file
            if (this._screenPipeIdx) try { this.ffmpeg.stdio[this._screenPipeIdx]?.end(); } catch (_) { }
            if (this._cameraPipeIdx) try { this.ffmpeg.stdio[this._cameraPipeIdx]?.end(); } catch (_) { }
            if (this._audioPipeIdx) try { this.ffmpeg.stdio[this._audioPipeIdx]?.end(); } catch (_) { }

            // Wait for FFmpeg to finish writing (max 20s)
            await new Promise((resolve) => {
                const timeout = setTimeout(resolve, 20000);
                this.ffmpeg.on('close', () => { clearTimeout(timeout); resolve(); });
            });
        }

        // Close wrtc peer
        try { this.peer?.close(); } catch (_) { }

        console.log(`[Recorder] Recording saved: ${this.filePath}`);
        return this.filePath;
    }

    destroy() {
        try { this.screenSink?.stop(); } catch (_) { }
        try { this.cameraSink?.stop(); } catch (_) { }
        this.audioSinks.forEach(sink => { try { sink.stop(); } catch (_) { } });
        this.audioSinks.clear();
        try { this.ffmpeg?.kill('SIGKILL'); } catch (_) { }
        try { this.peer?.close(); } catch (_) { }
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { startRecording, stopRecording, getStatus, RECORDINGS_DIR };
