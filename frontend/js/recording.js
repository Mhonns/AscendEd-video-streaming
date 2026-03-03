/**
 * Recording Module (frontend)
 * Manages recording state and communicates with the server recording API.
 *
 * State is driven by socket events ('recording-started', 'recording-stopped')
 * so ALL clients in the room stay perfectly in sync.
 *
 * Usage (call from room.js after room-joined):
 *   window.RecordingModule.init(roomId, userId, hostId)
 */

const RecordingModule = (() => {
    let _roomId = null;
    let _userId = null;
    let _hostId = null;
    let _active = false;

    // Timer state
    let _timerInterval = null;
    let _timerSeconds = 0;

    function getAPIBase() {
        if (typeof getAPIURL === 'function') return getAPIURL();
        return `${serverProtocol}://${serverUrl}:8443/api`;
    }

    // init — call once after joining a room
    function init(roomId, userId, hostId) {
        _roomId = roomId;
        _userId = userId;
        _hostId = hostId;

        // Show recording button only for host
        const btn = document.getElementById('recording-btn');
        if (btn) {
            btn.style.display = isHost() ? '' : 'none';
        }

        console.log('[Recording] Initialized, host:', isHost());
    }

    // isHost
    function isHost() {
        return !!_hostId && _userId === _hostId;
    }

    // startRecording — called by the host's button click
    async function startRecording() {
        if (!_roomId || !_userId) {
            console.warn('[Recording] Not initialised yet');
            return false;
        }

        try {
            const res = await fetch(`${getAPIBase()}/recording/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId: _roomId, requesterId: _userId })
            });

            const data = await res.json();

            if (!res.ok) {
                console.error('[Recording] Start failed:', data.error);
                alert(`Recording start failed: ${data.error}`);
                return false;
            }

            console.log('[Recording] Recording start request accepted by server');
            return true;
        } catch (err) {
            console.error('[Recording] Network error on start:', err);
            return false;
        }
    }

    // stopRecording — called by the host's button click
    async function stopRecording() {
        if (!_roomId || !_userId) return false;

        try {
            const res = await fetch(`${getAPIBase()}/recording/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId: _roomId, requesterId: _userId })
            });

            const data = await res.json();

            if (!res.ok) {
                console.error('[Recording] Stop failed:', data.error);
                alert(`Recording stop failed: ${data.error}`);
                return false;
            }

            console.log('[Recording] Recording stopped. File saved on server:', data.fileName);
            return true;
        } catch (err) {
            console.error('[Recording] Network error on stop:', err);
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // Socket-driven state sync (called from socket-handler.js)
    // -------------------------------------------------------------------------

    function onRecordingStarted() {
        if (_active) return;
        _active = true;

        // IMPORTANT: show banner FIRST so the DOM element exists before _startTimer's interval fires
        _showRecordingBanner(true);
        _startTimer();
        _setButtonRecording(true);

        console.log('[Recording] Recording STARTED (synced from server)');
    }

    function onRecordingStopped() {
        if (!_active) return;
        _active = false;

        _stopTimer();
        _showRecordingBanner(false);
        _setButtonRecording(false);

        console.log('[Recording] Recording STOPPED (synced from server)');
    }

    // -------------------------------------------------------------------------
    // Button state helpers
    // -------------------------------------------------------------------------

    function _setButtonRecording(recording) {
        const btn = document.getElementById('recording-btn');
        if (!btn) return;

        const icon = btn.querySelector('img');
        if (recording) {
            if (icon) icon.src = '../assets/icons/recording.svg';
            btn.title = 'Stop Recording';
            btn.classList.add('recording');
        } else {
            if (icon) icon.src = '../assets/icons/recording-off.svg';
            btn.title = 'Start Recording';
            btn.classList.remove('recording');
        }
        btn.disabled = false;
    }

    // -------------------------------------------------------------------------
    // Minimal floating REC banner (visible to ALL participants)
    // Uses id="rec-banner-timer" to avoid collision with any other elements
    // -------------------------------------------------------------------------

    function _showRecordingBanner(show) {
        let banner = document.getElementById('rec-banner');

        if (show) {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'rec-banner';
                banner.className = 'rec-banner';
                banner.innerHTML = `
                    <span class="rec-dot"></span>
                    <span id="rec-banner-timer" class="rec-banner-timer">00:00</span>
                `;
                document.body.appendChild(banner);
            }
            banner.style.display = 'flex';
        } else {
            if (banner) {
                // Fade out then hide
                banner.style.opacity = '0';
                setTimeout(() => {
                    banner.style.display = 'none';
                    banner.style.opacity = '';
                }, 300);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Timer helpers — uses 'rec-banner-timer' id to avoid any HTML collision
    // -------------------------------------------------------------------------

    function _startTimer() {
        _timerSeconds = 0;
        _updateTimerDisplay();

        _timerInterval = setInterval(() => {
            _timerSeconds++;
            _updateTimerDisplay();
        }, 1000);
    }

    function _updateTimerDisplay() {
        const el = document.getElementById('rec-banner-timer');
        if (!el) return;

        const h = Math.floor(_timerSeconds / 3600);
        const m = Math.floor((_timerSeconds % 3600) / 60);
        const s = _timerSeconds % 60;

        // Show HH:MM:SS only when past 1 hour, otherwise MM:SS
        if (h > 0) {
            el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
            el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    }

    function _stopTimer() {
        if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
        _timerSeconds = 0;
    }

    // Public API
    return {
        init,
        isHost,
        startRecording,
        stopRecording,
        onRecordingStarted,
        onRecordingStopped,
        isActive: () => _active
    };
})();

window.RecordingModule = RecordingModule;
