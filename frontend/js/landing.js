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

async function startMeeting() {
  // Ensure server URL is determined
  await determineServerURL();
  
  const meetingName = document.getElementById('meeting-name').value || 'Quick Meeting';
  const roomId = generateRoomId();
  
  try {
    const response = await fetch(`${getAPIURL()}/rooms/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId: roomId,
        meetingName: meetingName
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // Redirect to meeting room with room ID and meeting name
      window.location.href = `pages/room.html?room=${roomId}&name=${encodeURIComponent(meetingName)}`;
    } else {
      alert(`Error creating room: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error creating room:', error);
    alert('Failed to create room. Please check if the server is running.');
  }
}

async function joinMeeting() {
  // Ensure server URL is determined
  await determineServerURL();
  
  const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
  
  if (!roomCode) {
    alert('Please enter a room code');
    return;
  }
  
  try {
    const response = await fetch(`${getAPIURL()}/rooms/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId: roomCode
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // Redirect to meeting room with room code
      window.location.href = `pages/room.html?room=${roomCode}&name=${encodeURIComponent(data.room.name)}`;
    } else {
      // Room not found - alert the user
      alert(`Room "${roomCode}" not found. Please check the room code and try again.`);
    }
  } catch (error) {
    console.error('Error joining room:', error);
    alert('Failed to join room. Please check if the server is running.');
  }
}

function viewRecordings() {
  alert('View All Recordings - Feature coming soon!');
  
  // Redirect to recordings page
  // window.location.href = 'pages/recordings.html';
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

async function saveUserProfile() {
  // Ensure server URL is determined
  await determineServerURL();
  
  const userName = document.getElementById('user-name')?.value.trim();
  const profileImage = document.getElementById('profile-image')?.src;
  
  if (!userName) {
    alert('Please enter your name');
    return;
  }
  
  // Generate or get user ID
  let userId = localStorage.getItem('userId');
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('userId', userId);
  }
  
  // Save to localStorage
  localStorage.setItem('userName', userName);
  if (profileImage && profileImage !== 'assets/icons/people.svg') {
    localStorage.setItem('profileImage', profileImage);
  }
  
  // Send to server
  try {
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
      // Show a brief success indicator
      const saveBtn = document.querySelector('.save-profile-btn');
      if (saveBtn) {
        const originalHTML = saveBtn.innerHTML;
        saveBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        saveBtn.style.background = '#4CAF50';
        setTimeout(() => {
          saveBtn.innerHTML = originalHTML;
          saveBtn.style.background = '';
        }, 1000);
      }
    } else {
      alert(`Error saving profile: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error saving profile:', error);
    alert('Failed to save profile. Please check if the server is running.');
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
    reader.onload = function(e) {
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

// Save user name when it changes
document.addEventListener('DOMContentLoaded', function() {
  loadUserProfile();
  
  const userNameInput = document.getElementById('user-name');
  if (userNameInput) {
    userNameInput.addEventListener('blur', saveUserProfile);
    userNameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        saveUserProfile();
        this.blur();
      }
    });
  }
});