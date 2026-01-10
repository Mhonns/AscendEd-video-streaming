/**
 * UI Controls Module
 * Handles auto-hide functionality for controls
 */

let hideTimeout;
let autoHideEnabled = false; // Default to disabled (pinned)
const topBar = document.getElementById('top-bar');
const bottomControls = document.getElementById('bottom-controls');

function showControls() {
  topBar.classList.add('show');
  bottomControls.classList.add('show');
  document.body.classList.add('show-cursor');
  document.body.classList.remove('ui-hidden');
  
  if (autoHideEnabled) {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hideControls, 3000);
  }
}

function hideControls() {
  if (!autoHideEnabled) return;
  
  topBar.classList.remove('show');
  bottomControls.classList.remove('show');
  document.body.classList.remove('show-cursor');
  document.body.classList.add('ui-hidden');
}

// Show controls on mouse move
document.addEventListener('mousemove', showControls);
document.addEventListener('mousedown', showControls);

// Show controls initially
showControls();

// Export functions to global scope
window.UIControls = {
  showControls,
  hideControls,
  getAutoHideEnabled: () => autoHideEnabled,
  setAutoHideEnabled: (enabled) => {
    autoHideEnabled = enabled;
    if (!enabled) {
      clearTimeout(hideTimeout);
      showControls();
      document.body.classList.remove('ui-hidden');
    }
  }
};