/**
 * Room Main Module
 * Initializes and coordinates all room functionality
 */

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

  // Get or generate user ID
  let userId = localStorage.getItem('userId') || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  if (!localStorage.getItem('userId')) {
    localStorage.setItem('userId', userId);
  }

  // Initialize socket connection
  await window.SocketHandler.initSocket(roomId, { userId });
  
  // Initialize all button handlers
  window.ButtonsModule.initButtons();

  // Setup copy room ID button
  const copyBtn = document.getElementById('copy-room-id-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => window.RoomUtils.copyRoomId(roomId));
  }
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', () => {
  initRoom();
});