/**
 * Room Utility Functions
 * Helper functions for room management
 */

// Get room ID from URL parameters
function getRoomId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('room') || 'ABC123XYZ';
}

// Get meeting name from URL parameters
function getMeetingName() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('name') || 'Meeting Room';
}

// Copy room ID to clipboard
function copyRoomId(roomId) {
  const copyBtn = document.getElementById('copy-room-id-btn');
  const copyIcon = copyBtn ? copyBtn.querySelector('.copy-icon') : null;
  const originalSrc = copyIcon ? copyIcon.src : '';
  
  // Try modern Clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(roomId).then(() => {
      // Success - show visual feedback
      showCopySuccess(copyIcon);
      console.log('Room ID copied to clipboard:', roomId);
    }).catch(err => {
      console.error('Clipboard API failed:', err);
      // Fallback to execCommand
      fallbackCopy(roomId, copyIcon);
    });
  } else {
    // Fallback for browsers without Clipboard API
    fallbackCopy(roomId, copyIcon);
  }
}

// Show success feedback
function showCopySuccess(copyIcon) {
  if (!copyIcon) return;
  
  const originalSrc = copyIcon.src;
  const originalFilter = copyIcon.style.filter;
  
  // Change to checkmark icon (using a simple approach - change opacity and add green tint)
  copyIcon.style.filter = 'invert(1) sepia(1) saturate(5) hue-rotate(90deg)';
  copyIcon.style.opacity = '1';
  
  setTimeout(() => {
    copyIcon.style.filter = originalFilter || 'invert(1)';
    copyIcon.style.opacity = '';
  }, 1000);
}

// Fallback copy method using execCommand
function fallbackCopy(roomId, copyIcon) {
  const textArea = document.createElement('textarea');
  textArea.value = roomId;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  
  try {
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    
    if (successful) {
      // Success - show visual feedback
      showCopySuccess(copyIcon);
      console.log('Room ID copied to clipboard (fallback):', roomId);
    } else {
      throw new Error('execCommand copy failed');
    }
  } catch (err) {
    console.error('Fallback copy failed:', err);
    alert('Failed to copy room ID. Please copy manually: ' + roomId);
  } finally {
    document.body.removeChild(textArea);
  }
}

// Export functions to global scope
window.RoomUtils = {
  getRoomId,
  getMeetingName,
  copyRoomId
};

