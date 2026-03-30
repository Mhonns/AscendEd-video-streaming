function showStartMeeting() {
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('start-view').classList.add('show');
}

function showJoinMeeting() {
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('join-view').classList.add('show');
}

function showMain() {
  document.getElementById('main-view').style.display = 'block';
  document.getElementById('start-view').classList.remove('show');
  document.getElementById('join-view').classList.remove('show');
}

// Use central config for server URL
// Initialize server URL on page load
determineServerURL();

function ensureUserId() {
  let userId = localStorage.getItem('userId');
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('userId', userId);
  }
  return userId;
}

async function startMeeting() {
  // Ensure server URL is determined
  await determineServerURL();

  // Ensure we have a stable userId before creating the room so that
  // the server can use it as hostId — allowing isHost() to work correctly.
  const userId = ensureUserId();

  // Auto-save profile before entering a room (silent / best-effort)
  await saveUserProfile({ silent: true, requireName: false });

  const meetingName = document.getElementById('meeting-name').value || 'Quick Meeting';
  const roomId = generateRoomId();

  // Read password + admin settings from AppSettings (set in the settings modal)
  const s = window.AppSettings?.getAll() || {};
  const password = s.passwordEnabled && s.roomPassword ? s.roomPassword : null;
  const disableChat  = !!s.disableChat;
  const disableEmoji = !!s.disableEmoji;

  try {
    const response = await fetch(`${getAPIURL()}/rooms/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        meetingName,
        hostId: userId,
        password,           // null if no password was configured
        disableChat,
        disableEmoji
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      window.location.href = `room.html?room=${roomId}&name=${encodeURIComponent(meetingName)}`;
    } else {
      alert(`Error creating room: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error creating room:', error);
    alert('Failed to create room. Please check if the server is running.');
  }
}

async function joinMeeting(passwordOverride) {
  // Ensure server URL is determined
  await determineServerURL();

  // Auto-save profile before entering a room (silent / best-effort)
  await saveUserProfile({ silent: true, requireName: false });

  const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

  if (!roomCode) {
    alert('Please enter a room code');
    return;
  }

  try {
    const body = { roomId: roomCode };
    if (passwordOverride) body.password = passwordOverride;

    const response = await fetch(`${getAPIURL()}/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (response.ok && data.success) {
      window.location.href = `room.html?room=${roomCode}&name=${encodeURIComponent(data.room.name)}`;
    } else if (response.status === 401 && data.requiresPassword) {
      // Room requires a password — prompt the user
      const entered = window.prompt(`Room "${roomCode}" is password-protected. Enter the password:`);
      if (entered !== null) {            // null = user pressed Cancel
        joinMeeting(entered.trim());   // retry with the entered password
      }
    } else {
      alert(`Room "${roomCode}" not found. Please check the room code and try again.`);
    }
  } catch (error) {
    console.error('Error joining room:', error);
    alert('Failed to join room. Please check if the server is running.');
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatRecordingDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function viewRecordings() {
  await determineServerURL();
  const modal = document.getElementById('recordings-modal');
  const listEl = document.getElementById('recordings-list');

  // Show modal with spinner
  listEl.innerHTML = `
    <div class="recordings-loading">
      <div class="recordings-spinner"></div>
      <span>Loading recordings\u2026</span>
    </div>`;
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`${getAPIURL()}/recording/list`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      listEl.innerHTML = `<div class="recordings-error">\u26a0 Failed to load recordings: ${data.error || 'Unknown error'}</div>`;
      return;
    }

    const recordings = data.recordings;

    // Update header badge count
    const h2 = modal.querySelector('.recordings-header-left h2');
    h2.innerHTML = 'Recordings' + (recordings.length > 0
      ? `<span class="recording-count-badge">${recordings.length}</span>`
      : '');

    if (recordings.length === 0) {
      listEl.innerHTML = `
        <div class="recordings-empty">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>No recordings found</span>
        </div>`;
      return;
    }

    listEl.innerHTML = recordings.map(rec => `
      <div class="recording-card">
        <div class="recording-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        </div>
        <div class="recording-info">
          <div class="recording-name" title="${rec.name}">${rec.name}</div>
          <div class="recording-meta">
            <span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              ${formatFileSize(rec.size)}
            </span>
            <span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${formatRecordingDate(rec.createdAt)}
            </span>
          </div>
        </div>
        <a class="recording-download-btn"
           href="${getAPIURL()}/recording/download/${encodeURIComponent(rec.name)}"
           download="${rec.name}"
           title="Download ${rec.name}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </a>
      </div>`).join('');

  } catch (err) {
    console.error('Error fetching recordings:', err);
    listEl.innerHTML = `<div class="recordings-error">\u26a0 Could not connect to the server. Check that the server is running.</div>`;
  }
}

function closeRecordings() {
  const modal = document.getElementById('recordings-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}


function showPaymentQR() {
  const modal = document.getElementById('payment-modal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  }
}

function closePaymentQR() {
  const modal = document.getElementById('payment-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

function showSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  }
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = ''; // Restore scrolling
  }
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

// Profile Management
function loadUserProfile() {
  const savedName = localStorage.getItem('userName');
  const savedProfileImage = localStorage.getItem('profileImage');

  if (savedName) {
    const userNameInput = document.getElementById('user-name');
    if (userNameInput) {
      userNameInput.value = savedName;
    }
  }

  if (savedProfileImage) {
    const profileImage = document.getElementById('profile-image');
    if (profileImage) {
      profileImage.src = savedProfileImage;
    }
  }
}

async function saveUserProfile(options = {}) {
  const { silent = false, requireName = true } = options;

  const userName = document.getElementById('user-name')?.value.trim() || '';
  const profileImage = document.getElementById('profile-image')?.src;

  // Always ensure we have a userId for the session
  const userId = ensureUserId();

  // If name is missing, either block (interactive save) or no-op (auto-save)
  if (!userName) {
    if (!silent && requireName) {
      alert('Please enter your name');
    }
    return;
  }

  // Save to localStorage
  localStorage.setItem('userName', userName);
  if (profileImage && profileImage !== '../assets/icons/people.svg') {
    localStorage.setItem('profileImage', profileImage);
  }

  // Send to server
  try {
    // Ensure server URL is determined (only needed for server save)
    await determineServerURL();

    const response = await fetch(`${getAPIURL()}/users/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: userId,
        name: userName
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log('Profile saved successfully');
    } else {
      if (!silent) {
        alert(`Error saving profile: ${data.error || 'Unknown error'}`);
      } else {
        console.warn('Error saving profile:', data.error || 'Unknown error');
      }
    }
  } catch (error) {
    console.error('Error saving profile:', error);
    if (!silent) {
      alert('Failed to save profile. Please check if the server is running.');
    }
  }
}

function handleProfileUpload(event) {
  const file = event.target.files[0];
  if (file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size should be less than 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const profileImage = document.getElementById('profile-image');
      if (profileImage) {
        profileImage.src = e.target.result;
        // Save to localStorage
        localStorage.setItem('profileImage', e.target.result);
      }
    };
    reader.readAsDataURL(file);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  loadUserProfile();
  loadSettingsIntoUI();
  attachSettingsListeners();
});

/**
 * Load persisted settings into every control in the landing settings modal.
 */
function loadSettingsIntoUI() {
  const s = window.AppSettings.getAll();

  // Voice & Video
  setToggle('settings-noise-cancelling', s.noiseCancelling);

  // Room
  setToggle('settings-auto-recording', s.autoRecording);
  setToggle('settings-optimize-video', s.optimizeVideoStreaming);
  setToggle('settings-password-toggle', s.passwordEnabled);

  const passwordInputContainer = document.getElementById('password-input-container');
  const passwordInput = document.getElementById('room-password-input');
  if (passwordInputContainer && passwordInput) {
    if (s.passwordEnabled) {
      passwordInputContainer.style.display = 'flex';
      passwordInput.value = s.roomPassword || '';
    } else {
      passwordInputContainer.style.display = 'none';
    }
  }

  const maxUserInput = document.getElementById('settings-max-user');
  if (maxUserInput) maxUserInput.value = s.maxUser;

  // Admin
  setToggle('settings-force-mute', s.forceMute);
  setToggle('settings-force-camera', s.forceCloseCamera);
  setToggle('settings-disable-chat', s.disableChat);
  setToggle('settings-disable-emoji', s.disableEmoji);
}

function setToggle(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

/**
 * Attach change listeners to every settings control so changes
 * are immediately persisted via AppSettings.
 */
function attachSettingsListeners() {
  // Helper: wire a checkbox to an AppSettings key
  function bindToggle(id, key, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      window.AppSettings.set(key, this.checked);
      if (onChange) onChange(this.checked);
    });
  }

  // Helper: wire a text/number input
  function bindInput(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function () {
      const val = el.type === 'number' ? Number(this.value) : this.value;
      window.AppSettings.set(key, val);
    });
    el.addEventListener('change', function () {
      const val = el.type === 'number' ? Number(this.value) : this.value;
      window.AppSettings.set(key, val);
    });
  }

  // Voice & Video
  bindToggle('settings-noise-cancelling', 'noiseCancelling');

  // Room
  bindToggle('settings-auto-recording', 'autoRecording');
  bindToggle('settings-optimize-video', 'optimizeVideoStreaming');
  bindToggle('settings-password-toggle', 'passwordEnabled', (checked) => {
    const passwordInputContainer = document.getElementById('password-input-container');
    const passwordInput = document.getElementById('room-password-input');
    if (passwordInputContainer && passwordInput) {
      if (checked) {
        passwordInputContainer.style.display = 'flex';
        if (!passwordInput.value) {
          const generated = Math.random().toString(36).substring(2, 10);
          passwordInput.value = generated;
          window.AppSettings.set('roomPassword', generated);
        }
      } else {
        passwordInputContainer.style.display = 'none';
      }
    }
  });
  bindInput('room-password-input', 'roomPassword');
  bindInput('settings-max-user', 'maxUser');

  // Admin
  bindToggle('settings-force-mute', 'forceMute');
  bindToggle('settings-force-camera', 'forceCloseCamera');
  bindToggle('settings-disable-chat', 'disableChat');
  bindToggle('settings-disable-emoji', 'disableEmoji');

  // User name
  const userNameInput = document.getElementById('user-name');
  if (userNameInput) {
    userNameInput.addEventListener('blur', () => saveUserProfile({ silent: true, requireName: false }));
    userNameInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        saveUserProfile({ silent: true, requireName: false });
        this.blur();
      }
    });
  }
}