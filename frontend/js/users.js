/**
 * Users Management Module
 * Handles user list display and management
 */

// Per-user state for this client (priority is local/client-side)
const userStateById = new Map(); // userId -> { userId, name, profileImage, priority, pinned, screenShareOn, videoOn, audioOn }
let selectedUserId = null; // user selected in people frame (overrides "top priority" for main video)

function getLocalUserId() {
  return localStorage.getItem('userId') || null;
}

function ensureLocalUserInState() {
  const userId = getLocalUserId();
  if (!userId) return;

  const name = localStorage.getItem('userName') || 'You';
  const profileImage = localStorage.getItem('profileImage') || '../assets/icons/people.svg';

  const existing = userStateById.get(userId);
  if (existing) {
    existing.name = existing.name || name;
    existing.profileImage = existing.profileImage || profileImage;
    return;
  }

  userStateById.set(userId, {
    userId,
    name,
    profileImage,
    priority: 0,
    pinned: false,
    screenShareOn: false,
    videoOn: false,
    audioOn: false
  });
}

function getUsersSorted() {
  return Array.from(userStateById.values()).sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : 0;
    const pb = Number.isFinite(b.priority) ? b.priority : 0;
    if (pb !== pa) return pb - pa;
    const an = (a.name || '').toLowerCase();
    const bn = (b.name || '').toLowerCase();
    return an.localeCompare(bn);
  });
}

function getTopPriorityUserId() {
  const sorted = getUsersSorted();
  return sorted.length ? sorted[0].userId : null;
}

function getPrimaryVideoUserId() {
  return selectedUserId || getTopPriorityUserId() || getLocalUserId();
}

function getPriority(userId) {
  const u = userStateById.get(userId);
  return u && Number.isFinite(u.priority) ? u.priority : 0;
}

function setUserItemActive(userId, active) {
  const el = document.getElementById(`user-${userId}`);
  if (!el) return;
  el.classList.toggle('active', !!active);
}

function createUserItemElement(user) {
  const userItem = document.createElement('div');
  userItem.className = 'user-item';
  userItem.id = `user-${user.userId}`;
  userItem.dataset.userId = user.userId;
  userItem.dataset.priority = String(user.priority || 0);

  // Avatar (will be hidden when local camera is on)
  const avatar = document.createElement('img');
  avatar.className = 'user-avatar';
  avatar.src = user.profileImage || '../assets/icons/people.svg';
  avatar.alt = user.name || 'User';
  avatar.onerror = function () {
    this.src = '../assets/icons/people.svg';
  };

  // For local user: show live camera preview in the avatar slot when camera is enabled
  const isLocalUser = user.userId === getLocalUserId();
  const localStream = isLocalUser ? window.MediaModule?.getLocalStream?.() : null;
  const localVideoTrack = localStream && localStream.getVideoTracks ? localStream.getVideoTracks()[0] : null;
  const shouldShowCameraPreview = !!(isLocalUser && localVideoTrack && localVideoTrack.enabled);

  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'user-media';

  if (shouldShowCameraPreview) {
    avatar.style.display = 'none';

    const videoPreview = document.createElement('video');
    videoPreview.className = 'user-video-preview';
    videoPreview.autoplay = true;
    videoPreview.muted = true;
    videoPreview.playsInline = true;
    videoPreview.srcObject = localStream;

    // Best-effort play (can fail without gesture in some browsers)
    setTimeout(() => {
      videoPreview.play?.().catch?.(() => {});
    }, 0);

    mediaWrap.appendChild(videoPreview);
  }

  mediaWrap.appendChild(avatar);

  const name = document.createElement('div');
  name.className = 'user-name';
  name.textContent = user.name || 'Anonymous';

  // Create action buttons container
  const actions = document.createElement('div');
  actions.className = 'user-actions';

  // Mute button
  const muteBtn = document.createElement('button');
  muteBtn.className = 'user-action-btn mute-btn';
  muteBtn.title = 'Mute User';
  muteBtn.innerHTML = `<img src="../assets/icons/mic-off.svg" alt="Mute">`;
  muteBtn.onclick = (e) => {
    e.stopPropagation();
    handleMuteUser(user.userId);
  };

  // Pin button (affects local priority ordering only)
  const pinBtn = document.createElement('button');
  pinBtn.className = 'user-action-btn pin-btn';
  pinBtn.title = 'Pin User';
  pinBtn.innerHTML = `<img src="../assets/icons/pin.svg" alt="Pin">`;
  if (user.pinned) pinBtn.classList.add('pinned');
  pinBtn.onclick = (e) => {
    e.stopPropagation();
    handlePinUser(user.userId, pinBtn);
  };

  // Kick button
  const kickBtn = document.createElement('button');
  kickBtn.className = 'user-action-btn kick-btn';
  kickBtn.title = 'Kick User';
  kickBtn.innerHTML = `<img src="../assets/icons/leave.svg" alt="Kick">`;
  kickBtn.onclick = (e) => {
    e.stopPropagation();
    handleKickUser(user.userId);
  };

  actions.appendChild(muteBtn);
  actions.appendChild(pinBtn);
  actions.appendChild(kickBtn);

  // Click selects this user for the main screen (unless deselected)
  userItem.onclick = () => {
    // Close other active items
    document.querySelectorAll('.user-item.active').forEach(item => {
      if (item !== userItem) item.classList.remove('active');
    });

    const willBeActive = !userItem.classList.contains('active');
    userItem.classList.toggle('active', willBeActive);

    selectedUserId = willBeActive ? user.userId : null;
    reorderUserItemsAndVideos();
  };

  userItem.appendChild(mediaWrap);
  userItem.appendChild(name);
  userItem.appendChild(actions);

  return userItem;
}

function renderUsersList() {
  const usersListElement = document.getElementById('users-list');
  if (!usersListElement) {
    console.warn('[Users] Users list element not found');
    return;
  }

  const usersSorted = getUsersSorted();
  const currentUserIds = new Set(usersSorted.map(u => u.userId));
  
  // Remove elements for users no longer in the list
  const existingItems = usersListElement.querySelectorAll('.user-item');
  existingItems.forEach(item => {
    const userId = item.dataset.userId;
    if (!currentUserIds.has(userId)) {
      item.remove();
    }
  });
  
  // Reorder only if needed
  usersSorted.forEach((u, targetIndex) => {
    let userItem = document.getElementById(`user-${u.userId}`);
    
    if (!userItem) {
      // Create new element
      userItem = createUserItemElement(u);
      // Insert at correct position
      const refNode = usersListElement.children[targetIndex];
      if (refNode) {
        usersListElement.insertBefore(userItem, refNode);
      } else {
        usersListElement.appendChild(userItem);
      }
    } else {
      // Update existing element
      userItem.dataset.priority = String(u.priority || 0);
      updateLocalCameraPreview(userItem, u.userId);
      
      // Only move if position is wrong
      const currentIndex = Array.from(usersListElement.children).indexOf(userItem);
      if (currentIndex !== targetIndex) {
        const refNode = usersListElement.children[targetIndex];
        if (refNode && refNode !== userItem) {
          usersListElement.insertBefore(userItem, refNode);
        } else if (currentIndex > targetIndex) {
          // Element needs to move earlier
          usersListElement.insertBefore(userItem, usersListElement.children[targetIndex]);
        }
      }
    }
  });

  // Restore selection UI if still present
  if (selectedUserId) {
    setUserItemActive(selectedUserId, true);
  }
}

function reorderVideoItems() {
  const videoGrid = document.getElementById('video-grid');
  if (!videoGrid) return;

  const placeholder = document.getElementById('video-placeholder');
  const items = Array.from(videoGrid.querySelectorAll('.video-item'));

  // Sort only by known userId. Unknown items are kept at the end in original order.
  const known = [];
  const unknown = [];
  for (const el of items) {
    const uid = el.dataset.userId;
    if (uid) known.push(el);
    else unknown.push(el);
  }

  known.sort((a, b) => getPriority(b.dataset.userId) - getPriority(a.dataset.userId));

  // Re-append to DOM in order (keeping placeholder untouched)
  for (const el of [...known, ...unknown]) {
    videoGrid.appendChild(el);
  }

  // Main screen: show only the primary (top priority or selected) video tile
  const primaryUserId = getPrimaryVideoUserId();
  const videoItems = Array.from(videoGrid.querySelectorAll('.video-item'));
  let anyShown = false;
  const matchedPrimary = primaryUserId
    ? videoItems.find(el => el.dataset.userId === primaryUserId)
    : null;

  for (const el of videoItems) {
    const uid = el.dataset.userId;
    const shouldShow = matchedPrimary
      ? uid === primaryUserId
      : (videoItems.length ? el === videoItems[0] : true);
    el.style.display = shouldShow ? '' : 'none';
    if (shouldShow) anyShown = true;
  }

  // Placeholder visibility (only if there are no visible video tiles)
  if (placeholder) {
    placeholder.classList.toggle('hidden', anyShown);
  }
}

function displayUsers(users) {
  ensureLocalUserInState();

  (users || []).forEach((user) => {
    if (!user || !user.userId) return;

    const existing = userStateById.get(user.userId);
    if (existing) {
      existing.name = user.name || existing.name;
      existing.profileImage = user.profileImage || existing.profileImage;
      if (!Number.isFinite(existing.priority)) existing.priority = 0;
    } else {
      userStateById.set(user.userId, {
        userId: user.userId,
        name: user.name || 'Anonymous',
        profileImage: user.profileImage || '../assets/icons/people.svg',
        priority: 0,
        pinned: false,
        screenShareOn: false,
        videoOn: false,
        audioOn: false
      });
    }
  });

  renderUsersList();
  reorderVideoItems();

  console.log(`[Users] Displayed ${userStateById.size} users in sidebar`);
}

/**
 * Update local user's camera preview on existing element
 */
function updateLocalCameraPreview(userItem, userId) {
  const isLocalUser = userId === getLocalUserId();
  if (!isLocalUser) return;
  
  const localStream = window.MediaModule?.getLocalStream?.();
  const localVideoTrack = localStream?.getVideoTracks?.()?.[0];
  const shouldShowCameraPreview = !!(localVideoTrack && localVideoTrack.enabled);
  
  const mediaWrap = userItem.querySelector('.user-media');
  const avatar = userItem.querySelector('.user-avatar');
  let videoPreview = mediaWrap?.querySelector('.user-video-preview');
  
  if (shouldShowCameraPreview) {
    // Show camera preview
    if (avatar) avatar.style.display = 'none';
    
    if (!videoPreview && mediaWrap) {
      videoPreview = document.createElement('video');
      videoPreview.className = 'user-video-preview';
      videoPreview.autoplay = true;
      videoPreview.muted = true;
      videoPreview.playsInline = true;
      mediaWrap.insertBefore(videoPreview, avatar);
    }
    
    if (videoPreview && videoPreview.srcObject !== localStream) {
      videoPreview.srcObject = localStream;
      videoPreview.play?.().catch?.(() => {});
    }
  } else {
    // Hide camera preview, show avatar
    if (avatar) avatar.style.display = '';
    if (videoPreview) {
      videoPreview.srcObject = null;
      videoPreview.remove();
    }
  }
}

function addUserToList(user) {
  if (!user || !user.userId) {
    console.warn('[Users] Invalid user data:', user);
    return;
  }

  ensureLocalUserInState();

  const existing = userStateById.get(user.userId);
  if (existing) {
    existing.name = user.name || existing.name;
    existing.profileImage = user.profileImage || existing.profileImage;
  } else {
    userStateById.set(user.userId, {
      userId: user.userId,
      name: user.name || 'Anonymous',
      profileImage: user.profileImage || '../assets/icons/people.svg',
      priority: 0,
      pinned: false,
      screenShareOn: false,
      videoOn: false,
      audioOn: false
    });
  }

  renderUsersList();
  reorderVideoItems();
}

// User action handlers
function handleMuteUser(userId) {
  console.log('[Users] Mute user:', userId);
  const socket = window.SocketHandler?.getSocket();
  if (socket) {
    socket.emit('mute-user', { targetUserId: userId });
  }
}

function handlePinUser(userId, btnElement) {
  console.log('[Users] Pin user:', userId);
  const isPinned = btnElement.classList.toggle('pinned');
  setPinned(userId, isPinned);
}

function handleKickUser(userId) {
  if (confirm('Are you sure you want to kick this user?')) {
    console.log('[Users] Kick user:', userId);
    const socket = window.SocketHandler?.getSocket();
    if (socket) {
      socket.emit('kick-user', { targetUserId: userId });
    }
  }
}

function removeUserFromList(userId) {
  userStateById.delete(userId);

  const userItem = document.getElementById(`user-${userId}`);
  if (userItem) {
    userItem.remove();
  }

  if (selectedUserId === userId) {
    selectedUserId = null;
  }

  reorderUserItemsAndVideos();
}

// Update user count display
function updateUserCount(count) {
  const userCountElement = document.getElementById('user-count-number');
  if (userCountElement) {
    userCountElement.textContent = count;
    console.log(`[Users] Updated user count to: ${count}`);
  } else {
    console.warn('[Users] User count element not found');
  }
}

// Close active user items when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-item')) {
    document.querySelectorAll('.user-item.active').forEach(item => {
      item.classList.remove('active');
    });
    selectedUserId = null;
    reorderUserItemsAndVideos();
  }
});

/**
 * Change user priority by delta and reorder people + video.
 */
function changePriority(userId, delta) {
  if (!userId || !Number.isFinite(delta) || delta === 0) return;
  const u = userStateById.get(userId);
  if (!u) return;
  u.priority = (Number.isFinite(u.priority) ? u.priority : 0) + delta;
  const el = document.getElementById(`user-${userId}`);
  if (el) el.dataset.priority = String(u.priority);
  reorderUserItemsAndVideos();
}

function setPinned(userId, pinned) {
  const u = userStateById.get(userId);
  if (!u) return;
  const next = !!pinned;
  if (u.pinned === next) return;
  u.pinned = next;
  changePriority(userId, next ? 1000 : -1000);
}

function setScreenShareOn(userId, on) {
  const u = userStateById.get(userId);
  if (!u) return;
  const next = !!on;
  if (u.screenShareOn === next) return;
  u.screenShareOn = next;
  changePriority(userId, next ? 100 : -100);
}

function setVideoOn(userId, on) {
  const u = userStateById.get(userId);
  if (!u) return;
  const next = !!on;
  if (u.videoOn === next) return;
  u.videoOn = next;
  changePriority(userId, next ? 10 : -10);
}

function setAudioOn(userId, on) {
  const u = userStateById.get(userId);
  if (!u) return;
  const next = !!on;
  if (u.audioOn === next) return;
  u.audioOn = next;
  changePriority(userId, next ? 1 : -1);
}

function reorderUserItemsAndVideos() {
  renderUsersList();
  reorderVideoItems();
}

// Export functions to global scope
window.UsersModule = {
  displayUsers,
  addUserToList,
  removeUserFromList,
  updateUserCount,
  getUsersList: () => getUsersSorted(),
  handleMuteUser,
  handlePinUser,
  handleKickUser,
  changePriority,
  setPinned,
  setScreenShareOn,
  setVideoOn,
  setAudioOn,
  reorderUserItemsAndVideos
};

