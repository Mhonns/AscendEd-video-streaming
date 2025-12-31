// WebRTC Module for handling peer-to-peer audio communication
const WebRTC = (function() {
  // WebRTC variables
  let localAudioStream = null;
  let peerConnections = new Map(); // Map of userId -> RTCPeerConnection
  let userSocketIds = new Map(); // Map of userId -> socketId
  let socket = null;
  let userId = null;
  
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Initialize WebRTC with socket and userId
  function initialize(socketInstance, currentUserId) {
    socket = socketInstance;
    userId = currentUserId;
    setupSignalingHandlers();
  }

  // Setup Socket.io signaling event handlers
  function setupSignalingHandlers() {
    if (!socket) return;

    // Handle existing users when joining a room
    socket.on('existing-users', async (data) => {
      if (data.users && Array.isArray(data.users)) {
        for (const user of data.users) {
          if (user.userId !== userId && user.socketId) {
            userSocketIds.set(user.userId, user.socketId);
            await createPeerConnection(user.userId, user.socketId, true);
          }
        }
      }
    });

    // Handle new user joining
    socket.on('user-joined', async (data) => {
      if (data.userId && data.socketId && data.userId !== userId) {
        userSocketIds.set(data.userId, data.socketId);
        await createPeerConnection(data.userId, data.socketId, false);
      }
    });

    // Handle WebRTC offer
    socket.on('webrtc-offer', async (data) => {
      let peerConnection = peerConnections.get(data.fromUserId);
      
      // If peer connection doesn't exist, create it
      if (!peerConnection) {
        const targetSocketId = userSocketIds.get(data.fromUserId) || data.fromSocketId;
        if (targetSocketId) {
          userSocketIds.set(data.fromUserId, targetSocketId);
          await createPeerConnection(data.fromUserId, targetSocketId, false);
          peerConnection = peerConnections.get(data.fromUserId);
        }
      }
      
      if (peerConnection) {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          
          socket.emit('webrtc-answer', {
            answer: answer,
            targetSocketId: data.fromSocketId,
            userId: userId
          });
        } catch (error) {
          console.error('Error handling WebRTC offer:', error);
        }
      }
    });

    // Handle WebRTC answer
    socket.on('webrtc-answer', async (data) => {
      const peerConnection = peerConnections.get(data.fromUserId);
      if (peerConnection) {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (error) {
          console.error('Error handling WebRTC answer:', error);
        }
      }
    });

    // Handle ICE candidates
    socket.on('webrtc-ice-candidate', async (data) => {
      const peerConnection = peerConnections.get(data.fromUserId);
      if (peerConnection && data.candidate) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    });
  }

  // Get local audio stream
  async function getLocalAudioStream() {
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      let errorMessage = 'Microphone access is not supported in this browser. ';
      
      // Check if we're on HTTP (not HTTPS or localhost)
      const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      
      if (!isSecureContext && location.protocol === 'http:') {
        errorMessage += 'Please access this site over HTTPS or use localhost.';
      } else {
        errorMessage += 'Please use a modern browser that supports the MediaDevices API (Chrome, Firefox, Safari, Edge).';
      }
      
      console.error(errorMessage);
      localStorage.setItem('micPermissionState', 'denied');
      throw new Error('getUserMedia not supported');
    }

    try {
      // If we already have a stream, return it
      if (localAudioStream) {
        return localAudioStream;
      }
      
      // Otherwise request permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localAudioStream = stream;
      localStorage.setItem('micPermissionState', 'granted');
      
      return stream;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      localStorage.setItem('micPermissionState', 'denied');
      
      let errorMessage = 'Could not access microphone. ';
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage += 'Please allow microphone access in your browser settings.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage += 'No microphone found. Please connect a microphone.';
      } else if (error.name === 'NotSupportedError' || error.name === 'ConstraintNotSatisfiedError') {
        errorMessage += 'Your browser does not support the required audio format.';
      } else {
        errorMessage += error.message || 'Please check your browser settings.';
      }
      
      alert(errorMessage);
      throw error;
    }
  }

  // Request microphone permission
  async function requestMicrophonePermission() {
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      let errorMessage = 'Microphone access is not supported in this browser. ';
      
      // Check if we're on HTTP (not HTTPS or localhost)
      const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      
      if (!isSecureContext && location.protocol === 'http:') {
        errorMessage += 'Please access this site over HTTPS or use localhost.';
      } else {
        errorMessage += 'Please use a modern browser that supports the MediaDevices API (Chrome, Firefox, Safari, Edge).';
      }
      
      console.error(errorMessage);
      alert(errorMessage);
      localStorage.setItem('micPermissionState', 'denied');
      throw new Error('getUserMedia not supported');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localAudioStream = stream;
      localStorage.setItem('micPermissionState', 'granted');
      
      return stream;
    } catch (error) {
      console.error('Error requesting microphone permission:', error);
      localStorage.setItem('micPermissionState', 'denied');
      
      // Show error message
      let errorMessage = 'Could not access microphone. ';
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage += 'Please allow microphone access in your browser settings.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage += 'No microphone found. Please connect a microphone.';
      } else if (error.name === 'NotSupportedError' || error.name === 'ConstraintNotSatisfiedError') {
        errorMessage += 'Your browser does not support the required audio format.';
      } else {
        errorMessage += error.message || 'Please check your browser settings.';
      }
      
      alert(errorMessage);
      throw error;
    }
  }

  // Create peer connection
  async function createPeerConnection(targetUserId, targetSocketId, isInitiator) {
    // Don't create duplicate connections
    if (peerConnections.has(targetUserId)) {
      return;
    }

    try {
      const peerConnection = new RTCPeerConnection(rtcConfiguration);

      // Add local audio stream tracks if available
      if (localAudioStream) {
        localAudioStream.getAudioTracks().forEach(track => {
          peerConnection.addTrack(track, localAudioStream);
        });
      }

      // Handle remote audio stream
      peerConnection.ontrack = (event) => {
        const remoteStream = event.streams[0];
        if (remoteStream && remoteStream.getAudioTracks().length > 0) {
          playRemoteAudio(remoteStream, targetUserId);
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('webrtc-ice-candidate', {
            candidate: event.candidate,
            targetSocketId: targetSocketId,
            userId: userId
          });
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          console.warn('Peer connection failed/disconnected:', state, 'for user:', targetUserId);
        }
      };

      peerConnections.set(targetUserId, peerConnection);

      // Create offer if initiator
      if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        if (socket) {
          socket.emit('webrtc-offer', {
            offer: offer,
            targetSocketId: targetSocketId,
            userId: userId
          });
        }
      }
    } catch (error) {
      console.error('Error creating peer connection:', error);
    }
  }

  // Close peer connection
  function closePeerConnection(targetUserId) {
    const peerConnection = peerConnections.get(targetUserId);
    if (peerConnection) {
      peerConnection.close();
      peerConnections.delete(targetUserId);
      userSocketIds.delete(targetUserId);
      // Remove audio element if it exists
      const audioElement = document.getElementById(`audio-${targetUserId}`);
      if (audioElement) {
        audioElement.remove();
      }
    }
  }

  // Cleanup all WebRTC connections
  function cleanup() {
    // Close all peer connections
    peerConnections.forEach((peerConnection, userId) => {
      peerConnection.close();
      const audioElement = document.getElementById(`audio-${userId}`);
      if (audioElement) {
        audioElement.remove();
      }
    });
    peerConnections.clear();
    userSocketIds.clear();

    // Stop local audio stream
    if (localAudioStream) {
      localAudioStream.getTracks().forEach(track => track.stop());
      localAudioStream = null;
    }
  }

  // Play remote audio
  function playRemoteAudio(stream, userId) {
    // Remove existing audio element if any
    const existingAudio = document.getElementById(`audio-${userId}`);
    if (existingAudio) {
      existingAudio.remove();
    }

    // Create audio element for remote stream
    const audioElement = document.createElement('audio');
    audioElement.id = `audio-${userId}`;
    audioElement.autoplay = true;
    audioElement.srcObject = stream;
    audioElement.volume = 1.0;
    document.body.appendChild(audioElement);
  }

  // Enable microphone (add tracks to all peer connections)
  function enableMicrophone() {
    if (!localAudioStream) {
      return false;
    }

    // Enable audio tracks
    localAudioStream.getAudioTracks().forEach(track => {
      track.enabled = true;
    });

    // Add audio tracks to all existing peer connections
    peerConnections.forEach((peerConnection, targetUserId) => {
      localAudioStream.getAudioTracks().forEach(track => {
        // Check if track already added
        const sender = peerConnection.getSenders().find(s => s.track && s.track.id === track.id);
        if (!sender) {
          peerConnection.addTrack(track, localAudioStream);
        } else if (sender.track !== track) {
          sender.replaceTrack(track);
        }
      });
    });

    return true;
  }

  // Disable microphone
  function disableMicrophone() {
    if (localAudioStream) {
      localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }
  }

  // Check if microphone is available
  function isMicrophoneAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // Get local audio stream (for external use)
  function getStream() {
    return localAudioStream;
  }

  // Public API
  return {
    initialize,
    getLocalAudioStream,
    requestMicrophonePermission,
    createPeerConnection,
    closePeerConnection,
    cleanup,
    enableMicrophone,
    disableMicrophone,
    isMicrophoneAvailable,
    getStream
  };
})();

