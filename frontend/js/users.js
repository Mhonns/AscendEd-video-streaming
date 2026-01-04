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
  
  userItem.appendChild(avatar);
  userItem.appendChild(name);
  usersListElement.appendChild(userItem);
  
  console.log(`Added user to list: ${user.name || 'Anonymous'} (${user.userId})`);
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

// Export functions to global scope
window.UsersModule = {
  displayUsers,
  addUserToList,
  removeUserFromList,
  updateUserCount,
  getUsersList: () => usersList
};

