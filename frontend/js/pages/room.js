/**
 * Room Main Module
 * Initializes and coordinates all room functionality
 */

// Show name modal for anonymous users
function showNameModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('name-modal');
    const input = document.getElementById('name-input');
    const submitBtn = document.getElementById('name-submit-btn');

    if (!modal || !input || !submitBtn) {
      console.warn('[Room] Name modal elements not found');
      resolve(null);
      return;
    }

    // Show the modal
    modal.classList.add('show');

    // Focus the input after animation
    setTimeout(() => input.focus(), 350);

    // Handle submit
    const handleSubmit = () => {
      const name = input.value.trim();
      if (name) {
        // Save name to localStorage
        localStorage.setItem('userName', name);

        // Also save to server if possible
        const userId = localStorage.getItem('userId') || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (!localStorage.getItem('userId')) {
          localStorage.setItem('userId', userId);
        }

        // Try to save to server (non-blocking)
        fetch(`${getAPIURL()}/users/profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, name })
        }).catch(err => console.warn('[Room] Could not save name to server:', err));

        // Hide modal
        modal.classList.remove('show');

        resolve(name);
      }
    };

    // Button click
    submitBtn.addEventListener('click', handleSubmit);

    // Enter key
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    });

    // Update button state based on input
    input.addEventListener('input', () => {
      submitBtn.disabled = !input.value.trim();
    });

    // Initially disable button
    submitBtn.disabled = true;
  });
}

// Initialize room
async function initRoom() {
  const roomId = window.RoomUtils.getRoomId();
  const meetingName = window.RoomUtils.getMeetingName();

  document.querySelector('.room-name').textContent = meetingName;
  document.querySelector('.room-id').textContent = `Room ID: ${roomId}`;

  // Determine server URL first
  await determineServerURL();

  // Validate room exists before connecting
  const response = await fetch(`${getAPIURL()}/rooms/${roomId}`);
  const data = await response.json();

  if (!response.ok || !data.success) {
    alert(`Room "${roomId}" not found. Please check the room code and try again.`);
    window.location.href = '../index.html';
    return;
  }

  // Check if user has a name set, otherwise prompt
  let userName = localStorage.getItem('userName');
  if (!userName) {
    userName = await showNameModal();
  }

  // Get or generate user ID
  let userId = localStorage.getItem('userId') || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  if (!localStorage.getItem('userId')) {
    localStorage.setItem('userId', userId);
  }

  // Initialize socket connection
  await window.SocketHandler.initSocket(roomId, { userId });

  // Initialize all button handlers
  window.ButtonsModule.initButtons();

  // Initialize recording module (shows/hides the record button based on host status)
  window.RecordingModule?.init?.(roomId, userId, data.room.hostId);

  // Apply settings persisted from the landing page
  applyStartupSettings();

  const copyBtn = document.getElementById('copy-room-id-btn');

  if (copyBtn) {
    copyBtn.addEventListener('click', () => window.RoomUtils.copyRoomId(roomId));
  }
}

/**
 * Apply persistent settings that should take effect as soon as the room loads.
 * Only side-effects that are safe to apply immediately are done here;
 * others (e.g. auto-recording) require the recording module to be ready so
 * we defer them slightly.
 *
 * NOTE: disableChat and disableEmoji are admin room-level controls — they are
 * applied exclusively via the server's adminState in the 'room-joined' event
 * (handled in socket-handler.js) so that only the server is the source of truth.
 */
function applyStartupSettings() {
  if (!window.AppSettings) return;
  const s = window.AppSettings.getAll();

  // Auto-recording — host only, wait a moment for socket & recording module to be ready
  if (s.autoRecording && window.RecordingModule?.isHost?.()) {
    setTimeout(() => {
      if (!window.RecordingModule?.isActive?.()) {
        console.log('[Room] Auto-recording: starting...');
        window.RecordingModule?.startRecording?.();
      }
    }, 2500);
  }

  console.log('[Room] Startup settings applied:', s);
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', () => {
  initRoom();
});