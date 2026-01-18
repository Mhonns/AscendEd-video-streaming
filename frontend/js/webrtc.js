/*
 * WebRTC Client Module
 * Handles connection to SFU server and media stream capture
 * Uses mediasoup-client for WebRTC SFU communication
 */

// mediasoup-client Device instance
let device = null;
let sendTransport = null;
let recvTransport = null;
let audioProducer = null;
let videoProducer = null;
const consumers = new Map(); // odId -> Consumer

// Media constraints for capturing user media
const mediaConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 2
  },
  video: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 60 },
    facingMode: 'user'
  }
};

// State
let isConnected = false;
let currentPeerId = null;

/**
 * Wait for mediasoup-client to be loaded
 */
function waitForMediasoupClient() {
  return new Promise((resolve) => {
    if (window.mediasoupClient) {
      resolve();
      return;
    }
    
    console.log('[WebRTC] Waiting for mediasoup-client to load...');
    window.addEventListener('mediasoup-ready', () => {
      console.log('[WebRTC] mediasoup-client is now available');
      resolve();
    }, { once: true });
  });
}

/**
 * Step 1.1: Establish connection to SFU server using SRTP protocol
 * Initialize mediasoup-client device and load router capabilities
 */
async function connectToSFU(socket, roomId, peerId) {
  try {
    // Wait for mediasoup-client to be loaded (ES module loads async)
    await waitForMediasoupClient();
    
    if (typeof mediasoupClient === 'undefined') {
      throw new Error('mediasoup-client failed to load. Please refresh the page.');
    }

    console.log(`[WebRTC] Connecting to SFU server for room: ${roomId}`);
    currentPeerId = peerId;

    // Request router RTP capabilities from server
    const rtpCapabilities = await requestRouterCapabilities(socket, roomId);
    
    // Create and load mediasoup device
    device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    
    console.log('[WebRTC] Device loaded with RTP capabilities');
    console.log('[WebRTC] Device can produce audio:', device.canProduce('audio'));
    console.log('[WebRTC] Device can produce video:', device.canProduce('video'));

    // Create send transport (for publishing media)
    sendTransport = await createTransport(socket, roomId, peerId, 'send');
    console.log('[WebRTC] Send transport created');

    // Create receive transport (for consuming media)
    recvTransport = await createTransport(socket, roomId, peerId, 'recv');
    console.log('[WebRTC] Receive transport created');

    isConnected = true;
    console.log('[WebRTC] Successfully connected to SFU server (DTLS-SRTP established)');

    return {
      device,
      sendTransport,
      recvTransport
    };
  } catch (error) {
    console.error('[WebRTC] Failed to connect to SFU:', error);
    throw error;
  }
}

/**
 * Request router RTP capabilities from server
 */
function requestRouterCapabilities(socket, roomId) {
  return new Promise((resolve, reject) => {
    socket.emit('webrtc:get-router-capabilities', { roomId }, (response) => {
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.rtpCapabilities);
      }
    });
  });
}

/**
 * Create a WebRTC transport (send or receive)
 * Establishes DTLS-SRTP connection with the SFU
 */
async function createTransport(socket, roomId, peerId, direction) {
  // Request transport creation from server
  const transportParams = await new Promise((resolve, reject) => {
    socket.emit('webrtc:create-transport', {
      roomId,
      peerId,
      direction
    }, (response) => {
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });

  // Create local transport based on direction
  let transport;
  if (direction === 'send') {
    transport = device.createSendTransport(transportParams);
  } else {
    transport = device.createRecvTransport(transportParams);
  }

  // Handle 'connect' event - complete DTLS handshake
  transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    try {
      console.log(`[WebRTC] Transport ${direction} connecting (DTLS handshake)...`);
      
      await new Promise((resolve, reject) => {
        socket.emit('webrtc:connect-transport', {
          peerId,
          direction,
          dtlsParameters
        }, (response) => {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve();
          }
        });
      });

      console.log(`[WebRTC] Transport ${direction} DTLS-SRTP connection established`);
      callback();
    } catch (error) {
      console.error(`[WebRTC] Transport ${direction} connection failed:`, error);
      errback(error);
    }
  });

  // Handle 'produce' event (only for send transport)
  if (direction === 'send') {
    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        console.log(`[WebRTC] Creating ${kind} producer...`);
        
        const response = await new Promise((resolve, reject) => {
          socket.emit('webrtc:produce', {
            roomId,
            peerId,
            kind,
            rtpParameters,
            appData
          }, (response) => {
            if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          });
        });

        console.log(`[WebRTC] ${kind} producer created: ${response.producerId}`);
        callback({ id: response.producerId });
      } catch (error) {
        console.error(`[WebRTC] Failed to create ${kind} producer:`, error);
        errback(error);
      }
    });
  }

  // Handle transport state changes
  transport.on('connectionstatechange', (state) => {
    console.log(`[WebRTC] Transport ${direction} connection state: ${state}`);
    
    if (state === 'failed' || state === 'closed') {
      console.warn(`[WebRTC] Transport ${direction} ${state}`);
    }
  });

  return transport;
}

/**
 * Step 1.2: Capture user media stream
 * Delegates to MediaModule which handles local stream management
 */
async function captureUserMedia(options = {}) {
  console.log('[WebRTC] Capturing user media via MediaModule...');
  
  // Use MediaModule to capture media
  if (options.audio !== false) {
    await window.MediaModule.requestMicrophonePermission();
  }
  if (options.video !== false) {
    await window.MediaModule.requestCameraPermission();
  }
  
  const localStream = window.MediaModule.getLocalStream();
  
  if (localStream) {
    console.log('[WebRTC] User media captured successfully');
    console.log('[WebRTC] Audio tracks:', localStream.getAudioTracks().length);
    console.log('[WebRTC] Video tracks:', localStream.getVideoTracks().length);
  }
  
  return localStream;
}

/**
 * Capture only audio - delegates to MediaModule
 */
async function captureAudio() {
  await window.MediaModule.requestMicrophonePermission();
  return window.MediaModule.getLocalStream();
}

/**
 * Capture only video - delegates to MediaModule
 */
async function captureVideo() {
  await window.MediaModule.requestCameraPermission();
  return window.MediaModule.getLocalStream();
}

/**
 * Capture screen share
 */
async function captureScreen(options = {}) {
  try {
    console.log('[WebRTC] Capturing screen...');
    
    const constraints = {
      video: {
        cursor: 'always',
        displaySurface: 'monitor',
        ...options.video
      },
      audio: options.audio || false
    };

    const screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
    
    console.log('[WebRTC] Screen captured successfully');
    
    return screenStream;
  } catch (error) {
    console.error('[WebRTC] Failed to capture screen:', error);
    throw error;
  }
}

/**
 * Get available media devices
 */
async function getMediaDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    return {
      audioInputs: devices.filter(d => d.kind === 'audioinput'),
      videoInputs: devices.filter(d => d.kind === 'videoinput'),
      audioOutputs: devices.filter(d => d.kind === 'audiooutput')
    };
  } catch (error) {
    console.error('[WebRTC] Failed to enumerate devices:', error);
    throw error;
  }
}

/**
 * Switch to a different camera
 */
async function switchCamera(deviceId) {
  const localStream = window.MediaModule.getLocalStream();
  
  if (!localStream) {
    throw new Error('No active media stream');
  }

  // Stop current video track
  const currentVideoTrack = localStream.getVideoTracks()[0];
  if (currentVideoTrack) {
    currentVideoTrack.stop();
    localStream.removeTrack(currentVideoTrack);
  }

  // Get new video track
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: {
      ...mediaConstraints.video,
      deviceId: { exact: deviceId }
    }
  });

  const newVideoTrack = newStream.getVideoTracks()[0];
  localStream.addTrack(newVideoTrack);

  // Update video producer if exists
  if (videoProducer && !videoProducer.closed) {
    await videoProducer.replaceTrack({ track: newVideoTrack });
  }

  console.log(`[WebRTC] Switched to camera: ${deviceId}`);
  return newVideoTrack;
}

/**
 * Switch to a different microphone
 */
async function switchMicrophone(deviceId) {
  const localStream = window.MediaModule.getLocalStream();
  
  if (!localStream) {
    throw new Error('No active media stream');
  }

  // Stop current audio track
  const currentAudioTrack = localStream.getAudioTracks()[0];
  if (currentAudioTrack) {
    currentAudioTrack.stop();
    localStream.removeTrack(currentAudioTrack);
  }

  // Get new audio track
  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...mediaConstraints.audio,
      deviceId: { exact: deviceId }
    }
  });

  const newAudioTrack = newStream.getAudioTracks()[0];
  localStream.addTrack(newAudioTrack);

  // Update audio producer if exists
  if (audioProducer && !audioProducer.closed) {
    await audioProducer.replaceTrack({ track: newAudioTrack });
  }

  console.log(`[WebRTC] Switched to microphone: ${deviceId}`);
  return newAudioTrack;
}

/**
 * Mute/unmute audio - syncs WebRTC producer state
 * Note: MediaModule handles the actual track start/stop
 */
function setAudioEnabled(enabled) {
  // Sync with WebRTC producer
  if (audioProducer && !audioProducer.closed) {
    if (enabled) {
      audioProducer.resume();
      console.log('[WebRTC] Audio producer resumed');
    } else {
      audioProducer.pause();
      console.log('[WebRTC] Audio producer paused');
    }
  }
}

/**
 * Enable/disable video - syncs WebRTC producer state
 * Note: MediaModule handles the actual track start/stop
 */
function setVideoEnabled(enabled) {
  // Sync with WebRTC producer
  if (videoProducer && !videoProducer.closed) {
    if (enabled) {
      videoProducer.resume();
      console.log('[WebRTC] Video producer resumed');
    } else {
      videoProducer.pause();
      console.log('[WebRTC] Video producer paused');
    }
  }
}

/**
 * Get local media stream - delegates to MediaModule
 */
function getLocalStream() {
  return window.MediaModule.getLocalStream();
}

/**
 * Check if connected to SFU
 */
function isConnectedToSFU() {
  return isConnected;
}

/**
 * Get current room ID - delegates to SocketHandler
 */
function getCurrentRoomId() {
  return window.SocketHandler.getCurrentRoomId();
}

/**
 * Get device
 */
function getDevice() {
  return device;
}

/**
 * Get send transport
 */
function getSendTransport() {
  return sendTransport;
}

/**
 * Get receive transport
 */
function getRecvTransport() {
  return recvTransport;
}

/**
 * Stop local media stream - delegates to MediaModule
 */
function stopLocalStream() {
  window.MediaModule.stopAllMedia();
  console.log('[WebRTC] Local stream stopped via MediaModule');
}

/**
 * Disconnect from SFU and cleanup
 */
async function disconnect() {
  console.log('[WebRTC] Disconnecting from SFU...');
  
  // Close producers
  if (audioProducer && !audioProducer.closed) {
    audioProducer.close();
    audioProducer = null;
  }
  if (videoProducer && !videoProducer.closed) {
    videoProducer.close();
    videoProducer = null;
  }

  // Close consumers
  consumers.forEach(consumer => {
    if (!consumer.closed) {
      consumer.close();
    }
  });
  consumers.clear();

  // Close transports
  if (sendTransport && !sendTransport.closed) {
    sendTransport.close();
    sendTransport = null;
  }
  if (recvTransport && !recvTransport.closed) {
    recvTransport.close();
    recvTransport = null;
  }

  // Stop local stream via MediaModule
  window.MediaModule.stopAllMedia();

  // Reset state
  device = null;
  isConnected = false;
  currentPeerId = null;

  console.log('[WebRTC] Disconnected and cleaned up');
}

/**
 * Store audio producer reference
 */
function setAudioProducer(producer) {
  audioProducer = producer;
}

/**
 * Store video producer reference
 */
function setVideoProducer(producer) {
  videoProducer = producer;
}

/**
 * Get audio producer
 */
function getAudioProducer() {
  return audioProducer;
}

/**
 * Get video producer
 */
function getVideoProducer() {
  return videoProducer;
}

/**
 * Store consumer
 */
function addConsumer(consumerId, consumer) {
  consumers.set(consumerId, consumer);
}

/**
 * Get consumer
 */
function getConsumer(consumerId) {
  return consumers.get(consumerId);
}

/**
 * Remove consumer
 */
function removeConsumer(consumerId) {
  const consumer = consumers.get(consumerId);
  if (consumer && !consumer.closed) {
    consumer.close();
  }
  consumers.delete(consumerId);
}

// Export module to global scope
window.WebRTCModule = {
  // Step 1: Connection and Media Capture
  connectToSFU,
  captureUserMedia,
  captureAudio,
  captureVideo,
  captureScreen,
  
  // Device management
  getMediaDevices,
  switchCamera,
  switchMicrophone,
  
  // Audio/Video controls
  setAudioEnabled,
  setVideoEnabled,
  
  // Getters
  getLocalStream,
  isConnectedToSFU,
  getCurrentRoomId,
  getDevice,
  getSendTransport,
  getRecvTransport,
  getAudioProducer,
  getVideoProducer,
  getConsumer,
  
  // Setters
  setAudioProducer,
  setVideoProducer,
  addConsumer,
  removeConsumer,
  
  // Cleanup
  stopLocalStream,
  disconnect
};

