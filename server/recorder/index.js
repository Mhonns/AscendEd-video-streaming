/**
 * Recorder Module
 * Server-side recording using wrtc + FFmpeg.
 *
 * Layout (1920×1080 output):
 *   - Screen share from priority user → left 75% of frame  (1440×1080, letterboxed)
 *   - Camera from priority user       → right 25% of frame (480×1080,  letterboxed)
 *   - Audio from ALL users            → PCM-summed mono mix (fd:5)
 *
 * Neither the screen nor the camera panel covers the other.
 * When camera is off the right panel shows black; when screen share stops it shows black.
 * If the priority user has no screen share, only the camera is recorded fullscreen.
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
const sfuModule = require('../sfu/sfu');

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
 * Atomically remove and return the active session without stopping it.
 * The caller is responsible for invoking session.stop() (typically in the background).
 * Returns null when there is no active session for the room.
 */
function dequeueSession(roomId) {
    const session = activeSessions.get(roomId);
    if (!session) return null;
    activeSessions.delete(roomId);
    return session;
}

/**
 * Stop the active recording for a room (awaits full FFmpeg finalization).
 * Prefer dequeueSession() + session.stop() when you want to decouple UI
 * notification from the file-save wait.
 * @returns {{ ok: boolean, filePath?: string, error?: string }}
 */
async function stopRecording(roomId) {
    const session = dequeueSession(roomId);
    if (!session) {
        return { ok: false, error: 'No active recording for this room' };
    }

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

        this.ffmpeg = null;

        // Sinks for priority user
        this.screenSink = null;   // priority user screen → fd:3
        this.cameraSink = null;   // priority user camera → fd:4
        // Audio sinks for ALL users: userId -> RTCAudioSink
        this.audioSinks = new Map();

        // Removed dynamic dimension logic; we strictly fix internal FFmpeg tracks.
        this._screenWidth = 1920;
        this._screenHeight = 1080;
        this._cameraWidth = 1280;
        this._cameraHeight = 720;
        this._expectedScreenFrameSize = this._screenWidth * this._screenHeight * 1.5;
        this._expectedCameraFrameSize = this._cameraWidth * this._cameraHeight * 1.5;

        this._sampleRate = 48000;
        this._channelCount = 1;

        // Ready flags
        this._screenReady = false;
        this._ffmpegStarted = false;

        // Queues before ffmpeg is ready (stores width, height, data)
        this._screenQueue = [];
        this._cameraQueue = [];
        this._audioQueue = [];

        // Per-user latest audio chunk (for mixing)
        this._latestAudioChunks = new Map(); // userId -> Buffer

        // Black frame fillers based on strictly fixed dimensions
        this._lastCameraFrameTime = 0;
        this._blackFrame = Buffer.concat([
            Buffer.alloc(this._cameraWidth * this._cameraHeight, 16),
            Buffer.alloc(this._cameraWidth * this._cameraHeight / 2, 128)
        ]);
        this._fillerInterval = null;

        this._lastScreenFrameTime = 0;
        this._blackScreenFrame = Buffer.concat([
            Buffer.alloc(this._screenWidth * this._screenHeight, 16),
            Buffer.alloc(this._screenWidth * this._screenHeight / 2, 128)
        ]);
        this._screenFillerInterval = null;

        // Silence filler for "mic off" — 10ms of PCM zeros at 48kHz mono s16le = 960 bytes
        this._lastAudioChunkTime = 0;
        this._silenceBuffer = Buffer.alloc(960); // 48000 Hz / 100 * 2 bytes
        this._audioSilenceInterval = null;

        // Scaler processes for dynamic resolution handling
        this._screenScaler = null;
        this._screenScalerWidth = 0;
        this._screenScalerHeight = 0;
        this._screenScalerBytesWritten = 0;

        this._cameraScaler = null;
        this._cameraScalerWidth = 0;
        this._cameraScalerHeight = 0;
        this._cameraScalerBytesWritten = 0;

        this._lastScreenWidth = 0;
        this._lastScreenHeight = 0;
        this._lastScreenFrameData = null;

        this._lastCameraWidth = 0;
        this._lastCameraHeight = 0;
        this._lastCameraFrameData = null;
    }

    _writeVideoFrame(pipeType, pipeIdx, width, height, data, expectedWidth, expectedHeight) {
        if (!this.ffmpeg?.stdio[pipeIdx]?.writable) return;

        // If resolution matches perfectly, write directly to main FFmpeg
        if (width === expectedWidth && height === expectedHeight) {
            if (this[`_${pipeType}Scaler`]) {
                this[`_${pipeType}Scaler`].kill('SIGKILL');

                // Align main pipe to a full frame boundary
                const frameSize = Math.round(expectedWidth * expectedHeight * 1.5);
                const remainder = this[`_${pipeType}ScalerBytesWritten`] % frameSize;
                if (remainder !== 0) {
                    try { this.ffmpeg.stdio[pipeIdx].write(Buffer.alloc(frameSize - remainder, 0)); } catch (_) { }
                }

                this[`_${pipeType}Scaler`] = null;
                this[`_${pipeType}ScalerWidth`] = 0;
                this[`_${pipeType}ScalerHeight`] = 0;
            }
            try { this.ffmpeg.stdio[pipeIdx].write(Buffer.from(data)); } catch (_) { }
            return;
        }

        // Mismatch! Use a dedicated scaler process
        const scalerKey = `_${pipeType}Scaler`;
        const scalerWKey = `_${pipeType}ScalerWidth`;
        const scalerHKey = `_${pipeType}ScalerHeight`;

        if (this[scalerKey]) {
            if (this[scalerWKey] === width && this[scalerHKey] === height) {
                if (this[scalerKey].stdin.writable) {
                    try { this[scalerKey].stdin.write(Buffer.from(data)); } catch (_) { }
                }
                return;
            }
            // Resolution changed! Kill old scaler securely.
            this[scalerKey].kill('SIGKILL');

            // Align main pipe to a full frame boundary
            const frameSize = Math.round(expectedWidth * expectedHeight * 1.5);
            const remainder = this[`${scalerKey}BytesWritten`] % frameSize;
            if (remainder !== 0) {
                try { this.ffmpeg.stdio[pipeIdx].write(Buffer.alloc(frameSize - remainder, 0)); } catch (_) { }
            }
            this[scalerKey] = null;
        }

        this[scalerWKey] = width;
        this[scalerHKey] = height;

        console.log(`[Recorder] Spawning scaler for ${pipeType}: ${width}x${height} -> ${expectedWidth}x${expectedHeight}`);

        this[scalerKey] = spawn('ffmpeg', [
            '-loglevel', 'error',
            '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${width}x${height}`, '-r', '30', '-i', 'pipe:0',
            '-vf', `scale=${expectedWidth}:${expectedHeight}:force_original_aspect_ratio=decrease,pad=${expectedWidth}:${expectedHeight}:(ow-iw)/2:(oh-ih)/2:black`,
            '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'
        ]);

        this[`${scalerKey}BytesWritten`] = 0;
        this[scalerKey].stdout.on('data', chunk => {
            this[`${scalerKey}BytesWritten`] += chunk.length;
            if (this.ffmpeg?.stdio[pipeIdx]?.writable) {
                try { this.ffmpeg.stdio[pipeIdx].write(chunk); } catch (_) { }
            }
        });

        this[scalerKey].on('error', () => { });

        if (this[scalerKey] && this[scalerKey].stdin && this[scalerKey].stdin.writable) {
            try { this[scalerKey].stdin.write(Buffer.from(data)); } catch (_) { }
        }
    }

    // -------------------------------------------------------------------------
    // start() — open wrtc consumer and wait for tracks
    // -------------------------------------------------------------------------
    async start() {
        const { roomId, priorityUserId } = this;
        console.log(`[Recorder] Starting recording for room ${roomId}, priority user ${priorityUserId}`);

        // Listen for internal SFU events unconditionally
        this._newStreamListener = (data) => {
            if (data.roomId === this.roomId) {
                this._handleStream(data.userId, data.streamType, data.stream);
            }
        };

        this._streamStoppedListener = (data) => {
            if (data.roomId === this.roomId) {
                this._handleStreamStopped(data.userId, data.streamType);
            }
        };

        sfuModule.sfuEvents.on('new-stream', this._newStreamListener);
        sfuModule.sfuEvents.on('stream-stopped', this._streamStoppedListener);

        // Capture already existing streams
        const activeStreams = sfuModule.roomUserStreams.get(this.roomId);
        if (activeStreams) {
            activeStreams.forEach((stream, streamKey) => {
                const { userId: streamUserId, streamType } = sfuModule.parseStreamKey(streamKey);
                this._handleStream(streamUserId, streamType, stream);
            });
        }

        console.log(`[Recorder] Captured existing streams. Listening for new tracks.`);
        this._trySpawnFFmpeg();
    }

    _handleStream(userId, streamType, stream) {
        if (!stream) return;

        if (userId === this.priorityUserId) {
            if (streamType === 'screen') {
                const track = stream.getVideoTracks()[0];
                if (track) {
                    console.log(`[Recorder] Attaching SCREEN sink for priority user ${userId}`);
                    this._attachScreenSink(track);
                }
            } else if (streamType === 'camera' || streamType === 'media') {
                const track = stream.getVideoTracks()[0];
                if (track) {
                    console.log(`[Recorder] Attaching CAMERA sink for priority user ${userId}`);
                    this._attachCameraSink(track);
                }
            }
        }

        if (streamType === 'main' || streamType === 'media') {
            const track = stream.getAudioTracks()[0];
            if (track) {
                console.log(`[Recorder] Attaching AUDIO sink for user ${userId}`);
                this._attachAudioSink(track, userId);
            }
        }
    }

    _handleStreamStopped(userId, streamType) {
        if (userId === this.priorityUserId) {
            if (streamType === 'screen' && this.screenSink) {
                try { this.screenSink.stop(); } catch (_) { }
                this.screenSink = null;
                console.log(`[Recorder] Detached SCREEN sink for priority user ${userId}`);
            } else if ((streamType === 'camera' || streamType === 'media') && this.cameraSink) {
                try { this.cameraSink.stop(); } catch (_) { }
                this.cameraSink = null;
                console.log(`[Recorder] Detached CAMERA sink for priority user ${userId}`);
            }
        }

        if (streamType === 'main' || streamType === 'media') {
            const sink = this.audioSinks.get(userId);
            if (sink) {
                try { sink.stop(); } catch (_) { }
                this.audioSinks.delete(userId);
                console.log(`[Recorder] Detached AUDIO sink for user ${userId}`);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Screen sink (priority user screen → fd:3)
    // -------------------------------------------------------------------------
    _attachScreenSink(track) {
        if (this.screenSink) return;
        this.screenSink = new RTCVideoSink(track);

        this.screenSink.addEventListener('frame', ({ frame }) => {
            const { width, height, data } = frame;

            // Mark that a real frame arrived so the screen filler backs off
            this._lastScreenFrameTime = Date.now();

            // Clone the data explicitly because WebRTC buffers are volatile
            this._lastScreenFrameData = Buffer.from(data);

            if (this._lastScreenWidth !== width || this._lastScreenHeight !== height) {
                this._lastScreenWidth = width;
                this._lastScreenHeight = height;
                this._blackScreenFrame = Buffer.concat([
                    Buffer.alloc(width * height, 16),
                    Buffer.alloc(Math.round(width * height / 2), 128)
                ]);
            }

            if (!this._ffmpegStarted) {
                this._screenReady = true;
                this._screenQueue.push({ width, height, data: Buffer.from(data) });
                this._trySpawnFFmpeg();
                return;
            }

            this._writeVideoFrame('screen', this._screenPipeIdx, width, height, data, this._screenWidth, this._screenHeight);
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

            // Clone the data explicitly because WebRTC buffers are volatile
            this._lastCameraFrameData = Buffer.from(data);

            if (this._lastCameraWidth !== width || this._lastCameraHeight !== height) {
                this._lastCameraWidth = width;
                this._lastCameraHeight = height;
                this._blackFrame = Buffer.concat([
                    Buffer.alloc(width * height, 16),
                    Buffer.alloc(Math.round(width * height / 2), 128)
                ]);
            }

            if (!this._ffmpegStarted) {
                this._cameraQueue.push({ width, height, data: Buffer.from(data) });
                this._trySpawnFFmpeg();
                return;
            }

            this._writeVideoFrame('camera', this._cameraPipeIdx, width, height, data, this._cameraWidth, this._cameraHeight);
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
            // Mark that audio is arriving so the silence filler backs off
            this._lastAudioChunkTime = Date.now();

            if (!this._ffmpegStarted) {
                this._sampleRate = sampleRate || 48000;
                this._channelCount = channelCount || 1;
                // Rebuild silence buffer with the actual sample rate / channel count
                const silenceBytes = Math.round((this._sampleRate / 100) * this._channelCount * 2);
                this._silenceBuffer = Buffer.alloc(silenceBytes);
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

        // Force a dual-pane layout structure regardless of what is actually running at the start.
        // We always allocate Pipe 3 for Screen and Pipe 4 for Camera.
        // If they don't logically exist, their respective _fillerIntervals will pump black frames into them.
        let hasScreen = true; // Always reserve screen pipe
        let hasCameraTrack = true; // Always reserve camera pipe
        let hasAudio = this.audioSinks.size > 0;

        if (!hasAudio) {
            hasAudio = true; // Always include audio pipe
        }

        // When screen is present, ALWAYS include a camera PiP pipe — even if no
        // real camera track has arrived yet. The black-frame filler will drive it
        // until (and whenever) the host actually turns their camera on.
        const includeCameraPip = hasScreen;

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
        // Even if the host later stops screen sharing, the _screenFillerInterval
        // will keep sending black frames so FFmpeg's video demuxer never blocks.
        if (hasScreen) {
            const pipeIdx = 3 + inputCount;
            args.push('-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${sw}x${sh}`, '-r', '30', '-i', `pipe:${pipeIdx}`);
            stdio.push('pipe');
            this._screenPipeIdx = pipeIdx;
            inputCount++;
        }

        // Input 1: Camera PiP (fd:4 etc)
        // Always added when screen is present. Real frames OR black filler drive it.
        if (includeCameraPip) {
            const pipeIdx = 3 + inputCount;
            args.push('-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${cw}x${ch}`, '-r', '30', '-i', `pipe:${pipeIdx}`);
            stdio.push('pipe');
            this._cameraPipeIdx = pipeIdx;
            inputCount++;
        } else if (hasCameraTrack) {
            // Camera only (no screen share) — fullscreen camera
            const pipeIdx = 3 + inputCount;
            args.push('-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${cw}x${ch}`, '-r', '30', '-i', `pipe:${pipeIdx}`);
            stdio.push('pipe');
            this._cameraPipeIdx = pipeIdx;
            inputCount++;
        }

        // Input 2: Audio (fd:5 etc)
        // Even if everyone mutes, the _audioSilenceInterval sends PCM zeros so
        // FFmpeg's audio demuxer never blocks and audio track stays in the file.
        if (hasAudio) {
            const pipeIdx = 3 + inputCount;
            args.push('-f', 's16le', '-ar', String(ar), '-ac', '1', '-i', `pipe:${pipeIdx}`);
            stdio.push('pipe');
            this._audioPipeIdx = pipeIdx;
            inputCount++;
        }

        // ── Video Layout ─────────────────────────────────────────────────────────
        // We ALWAYS use the side-by-side composition at 1920×1080:
        //
        //   ┌──────────────────────┬──────────┐
        //   │                      │          │
        //   │   Screen share       │  Camera  │
        //   │   (1440 × 1080, 75%) │  (480 ×  │
        //   │                      │  1080,   │
        //   │                      │   25%)   │
        //   └──────────────────────┴──────────┘
        //
        // If screen is off, the screen filler pumps 1920x1080 black frames which
        // shrink into the 1440x1080 hole.
        // If camera is off, the camera filler pumps 1280x720 black frames which
        // shrink into the 480x1080 hole.
        const outW = 1920, outH = 1080;
        const scrPanelW = Math.round(outW * 0.75); // 1440
        const camPanelW = outW - scrPanelW;        // 480
        const screenIdx = this._screenPipeIdx - 3;
        const cameraIdx = this._cameraPipeIdx - 3;

        // Each scale filter shrinks to fit the panel while preserving aspect ratio,
        // then pad fills any remaining space with black.
        const scrFilter = `[${screenIdx}:v]scale=${scrPanelW}:${outH}:force_original_aspect_ratio=decrease,` +
            `pad=${scrPanelW}:${outH}:(ow-iw)/2:(oh-ih)/2:black[scr]`;
        const camFilter = `[${cameraIdx}:v]scale=${camPanelW}:${outH}:force_original_aspect_ratio=decrease,` +
            `pad=${camPanelW}:${outH}:(ow-iw)/2:(oh-ih)/2:black[cam]`;
        const stackFilter = `[scr][cam]hstack=inputs=2[out]`;

        args.push('-filter_complex', `${scrFilter};${camFilter};${stackFilter}`);
        videoMap = '[out]';

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

        console.log(`[Recorder] Spawning FFmpeg with ${inputCount} inputs. Screen:${hasScreen}, CameraPip:${includeCameraPip || hasCameraTrack}, Audio:${hasAudio}`);
        this.ffmpeg = spawn('ffmpeg', args, { stdio });

        // ── Camera filler ────────────────────────────────────────────────────
        // Sends fallback frames at ~30 fps. If the camera is still on but dropped
        // a frame, it duplicates the last real frame so it doesn't flicker black.
        // If the camera is completely OFF, it sends pure black.
        this._fillerInterval = setInterval(() => {
            const now = Date.now();
            if (now - this._lastCameraFrameTime > 100) {
                const w = this._lastCameraWidth || this._cameraWidth;
                const h = this._lastCameraHeight || this._cameraHeight;
                const fallbackFrame = (this.cameraSink && this._lastCameraFrameData) ? this._lastCameraFrameData : this._blackFrame;
                this._writeVideoFrame('camera', this._cameraPipeIdx, w, h, fallbackFrame, this._cameraWidth, this._cameraHeight);
            }
        }, 33); // ~30 fps

        // ── Screen filler ────────────────────────────────────────────────────
        // Sends fallback frames at ~30 fps. WebRTC Screen sharing is inherently
        // low/variable framerate. If the stream is active, we MUST duplicate
        // the last known frame when idle so the background doesn't turn black.
        this._screenFillerInterval = setInterval(() => {
            const now = Date.now();
            if (now - this._lastScreenFrameTime > 100) {
                const w = this._lastScreenWidth || this._screenWidth;
                const h = this._lastScreenHeight || this._screenHeight;
                const fallbackFrame = (this.screenSink && this._lastScreenFrameData) ? this._lastScreenFrameData : this._blackScreenFrame;
                this._writeVideoFrame('screen', this._screenPipeIdx, w, h, fallbackFrame, this._screenWidth, this._screenHeight);
            }
        }, 33); // ~30 fps

        // ── Audio silence filler ─────────────────────────────────────────────
        // Writes PCM zeros (silence) every 10ms when the host mutes their mic.
        // Without this, muting causes a gap on the audio pipe which can cause
        // FFmpeg's audio demuxer to stall and the A/V to desync.
        if (hasAudio) {
            this._audioSilenceInterval = setInterval(() => {
                const now = Date.now();
                if (now - this._lastAudioChunkTime > 20 && this.ffmpeg?.stdio[this._audioPipeIdx]?.writable) {
                    try { this.ffmpeg.stdio[this._audioPipeIdx].write(this._silenceBuffer); } catch (_) { }
                }
            }, 10); // 10 ms
        }

        this.ffmpeg.on('close', (code) => {
            console.log(`[Recorder] FFmpeg exited with code ${code}`);
        });

        this.ffmpeg.on('error', (err) => {
            console.error('[Recorder] FFmpeg error:', err.message);
        });

        // Drain queued screen frames
        if (hasScreen) {
            for (const item of this._screenQueue) {
                this._writeVideoFrame('screen', this._screenPipeIdx, item.width, item.height, item.data, this._screenWidth, this._screenHeight);
            }
            this._screenQueue = [];
        }

        // Drain queued camera frames
        if (this._cameraPipeIdx != null) {
            for (const item of this._cameraQueue) {
                this._writeVideoFrame('camera', this._cameraPipeIdx, item.width, item.height, item.data, this._cameraWidth, this._cameraHeight);
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

        // Cancel the pending FFmpeg spawn timer if stop() is called before it fires.
        // Without this, FFmpeg would spawn AFTER we've already torn everything down,
        // leaving an empty/corrupt file and zombie processes.
        if (this._spawnTimer) {
            clearTimeout(this._spawnTimer);
            this._spawnTimer = null;
        }

        // Stop all filler/silence intervals before stopping sinks
        if (this._fillerInterval) { clearInterval(this._fillerInterval); this._fillerInterval = null; }
        if (this._screenFillerInterval) { clearInterval(this._screenFillerInterval); this._screenFillerInterval = null; }
        if (this._audioSilenceInterval) { clearInterval(this._audioSilenceInterval); this._audioSilenceInterval = null; }

        // IMPORTANT: Stop all WebRTC sinks FIRST, BEFORE ending the FFmpeg pipes.
        //
        // Why? The sink's frame/data handler is asynchronous — even after you call
        // pipe.end(), the sink can fire one final 'frame' event on the next event-loop
        // tick and write a new (potentially partial) buffer into a pipe that has
        // already signalled EOF. This is exactly what causes:
        //   "Packet corrupt (stream = 0)" and
        //   "Invalid buffer size, packet size N < expected frame_size M"
        //
        // By stopping the sinks first we guarantee that the data producers are
        // silent before we tell FFmpeg the stream is over.
        try { this.screenSink?.stop(); } catch (_) { }
        try { this.cameraSink?.stop(); } catch (_) { }
        this.audioSinks.forEach(sink => {
            try { sink.stop(); } catch (_) { }
        });
        this.audioSinks.clear();

        // Small yield so any in-flight frame callbacks that were already queued
        // in the microtask/event queue finish before we end the pipes.
        await new Promise(resolve => setImmediate(resolve));

        if (this.ffmpeg) {
            // Now it is safe to end the pipes — no more data can arrive from the
            // sinks we just stopped. Ending the pipes signals clean EOF to FFmpeg
            // so it can flush its internal buffers and finalize the container.
            if (this._screenPipeIdx != null) try { this.ffmpeg.stdio[this._screenPipeIdx]?.end(); } catch (_) { }
            if (this._cameraPipeIdx != null) try { this.ffmpeg.stdio[this._cameraPipeIdx]?.end(); } catch (_) { }
            if (this._audioPipeIdx != null) try { this.ffmpeg.stdio[this._audioPipeIdx]?.end(); } catch (_) { }

            // Wait for FFmpeg to finish writing the file (max 20s)
            await new Promise((resolve) => {
                const timeout = setTimeout(resolve, 20000);
                this.ffmpeg.on('close', () => { clearTimeout(timeout); resolve(); });
            });
        }

        sfuModule.sfuEvents.off('new-stream', this._newStreamListener);
        sfuModule.sfuEvents.off('stream-stopped', this._streamStoppedListener);

        console.log(`[Recorder] Recording saved: ${this.filePath}`);
        return this.filePath;
    }

    destroy() {
        if (this._spawnTimer) { clearTimeout(this._spawnTimer); this._spawnTimer = null; }
        if (this._fillerInterval) { clearInterval(this._fillerInterval); this._fillerInterval = null; }
        if (this._screenFillerInterval) { clearInterval(this._screenFillerInterval); this._screenFillerInterval = null; }
        if (this._audioSilenceInterval) { clearInterval(this._audioSilenceInterval); this._audioSilenceInterval = null; }
        try { this.screenSink?.stop(); } catch (_) { }
        try { this.cameraSink?.stop(); } catch (_) { }
        this.audioSinks.forEach(sink => { try { sink.stop(); } catch (_) { } });
        this.audioSinks.clear();
        sfuModule.sfuEvents.off('new-stream', this._newStreamListener);
        sfuModule.sfuEvents.off('stream-stopped', this._streamStoppedListener);
        try { this._screenScaler?.kill('SIGKILL'); } catch (_) { }
        try { this._cameraScaler?.kill('SIGKILL'); } catch (_) { }
        try { this.ffmpeg?.kill('SIGKILL'); } catch (_) { }
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { startRecording, stopRecording, dequeueSession, getStatus, RECORDINGS_DIR };
