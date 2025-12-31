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

function startMeeting() {
  const meetingName = document.getElementById('meeting-name').value || 'Quick Meeting';
  const roomId = generateRoomId();
  
  alert(`Meeting Created!\nRoom ID: ${roomId}\nMeeting Name: ${meetingName}`);
  
  // Redirect to meeting room
  // window.location.href = `pages/room.html?room=${roomId}`;
}

function joinMeeting() {
  const roomCode = document.getElementById('room-code').value.trim();
  
  if (!roomCode) {
    alert('Please enter a room code');
    return;
  }
  
  alert(`Joining meeting: ${roomCode}`);
  
  // Redirect to meeting room
  // window.location.href = `pages/room.html?room=${roomCode}`;
}

function viewRecordings() {
  alert('View All Recordings - Feature coming soon!');
  
  // Redirect to recordings page
  // window.location.href = 'pages/recordings.html';
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}