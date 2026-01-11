/**
 * Users Management Module
 * Handles user list display and management
 */

let usersList = [];

function displayUsers(users) {
  // Display all users (including anonymous)
  usersList = users || [];
  const usersListElement = document.getElementById('users-list');
  if (!usersListElement) {
    console.warn('Users list element not found');
    return;
  }
  
  usersListElement.innerHTML = '';
  
  // Display all users
  users.forEach(user => {
    addUserToList(user);
  });
  
  console.log(`Displayed ${users.length} users in sidebar`);
}

function addUserToList(user) {
  if (!user || !user.userId) {
    console.warn('Invalid user data:', user);
    return;
  }
  
  // Check if user already exists in the DOM
  const existingItem = document.getElementById(`user-${user.userId}`);
  if (existingItem) {
    console.log(`User ${user.userId} already in list`);
    return;
  }
  
  // Add to usersList if not already there
  if (!usersList.find(u => u.userId === user.userId)) {
    usersList.push(user);
  }
  
  const usersListElement = document.getElementById('users-list');
  if (!usersListElement) {
    console.warn('Users list element not found');
    return;
  }
  
  const userItem = document.createElement('div');
  userItem.className = 'user-item';
  userItem.id = `user-${user.userId}`;
  userItem.dataset.userId = user.userId;
  
  const avatar = document.createElement('img');
  avatar.className = 'user-avatar';
  avatar.src = user.profileImage || '../assets/icons/people.svg';
  avatar.alt = user.name || 'User';
  avatar.onerror = function() {
    this.src = '../assets/icons/people.svg';
  };
  
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
  
  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = 'user-action-btn pin-btn';
  pinBtn.title = 'Pin User';
  pinBtn.innerHTML = `<img src="../assets/icons/pin.svg" alt="Pin">`;
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
  
  // Toggle active state on click
  userItem.onclick = () => {
    // Close other active items
    document.querySelectorAll('.user-item.active').forEach(item => {
      if (item !== userItem) {
        item.classList.remove('active');
      }
    });
    userItem.classList.toggle('active');
  };
  
  userItem.appendChild(avatar);
  userItem.appendChild(name);
  userItem.appendChild(actions);
  usersListElement.appendChild(userItem);
  
  console.log(`Added user to list: ${user.name || 'Anonymous'} (${user.userId})`);
}

// User action handlers
function handleMuteUser(userId) {
  console.log('Mute user:', userId);
  const socket = window.SocketHandler?.getSocket();
  if (socket) {
    socket.emit('mute-user', { targetUserId: userId });
  }
}

function handlePinUser(userId, btnElement) {
  console.log('Pin user:', userId);
  btnElement.classList.toggle('pinned');
  // Emit pin event or handle locally
  if (window.WebRTCModule?.pinUser) {
    window.WebRTCModule.pinUser(userId);
  }
}

function handleKickUser(userId) {
  if (confirm('Are you sure you want to kick this user?')) {
    console.log('Kick user:', userId);
    const socket = window.SocketHandler?.getSocket();
    if (socket) {
      socket.emit('kick-user', { targetUserId: userId });
    }
  }
}

function removeUserFromList(userId) {
  usersList = usersList.filter(u => u.userId !== userId);
  
  const userItem = document.getElementById(`user-${userId}`);
  if (userItem) {
    userItem.remove();
  }
}

// Update user count display
function updateUserCount(count) {
  const userCountElement = document.getElementById('user-count-number');
  if (userCountElement) {
    userCountElement.textContent = count;
    console.log(`Updated user count to: ${count}`);
  } else {
    console.warn('User count element not found');
  }
}

// Close active user items when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-item')) {
    document.querySelectorAll('.user-item.active').forEach(item => {
      item.classList.remove('active');
    });
  }
});

// Export functions to global scope
window.UsersModule = {
  displayUsers,
  addUserToList,
  removeUserFromList,
  updateUserCount,
  getUsersList: () => usersList,
  handleMuteUser,
  handlePinUser,
  handleKickUser
};

