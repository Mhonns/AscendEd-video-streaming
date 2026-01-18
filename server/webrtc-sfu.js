/**
 * WebRTC SFU (Selective Forwarding Unit) Server
 * Uses mediasoup for handling WebRTC media routing with DTLS-SRTP
 */

const mediasoup = require('mediasoup');

// Store workers, routers, and transports
const workers = [];
let nextWorkerIndex = 0;
const routers = new Map(); // roomId -> Router
const transports = new Map(); // odId -> Transport
const producers = new Map(); // odId -> Producer
const consumers = new Map(); // odId -> Consumer[]
const peers = new Map(); // odId -> { odId, odId, transports: [], producers: [], consumers: [] }

// mediasoup configuration
const config = {
  // Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp'
    ]
  },
  // Router settings - media codecs supported
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000
        }
      }
    ]
  },
  // WebRTC transport settings with DTLS-SRTP
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: null // Will be set based on server's public IP
      }
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    // DTLS-SRTP is enabled by default in mediasoup
  }
};

/**
 * Initialize mediasoup workers
 * Workers handle the media processing
 */
async function initializeWorkers(numWorkers = 1) {
  console.log('Initializing mediasoup workers...');
  
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
      logLevel: config.worker.logLevel,
      logTags: config.worker.logTags
    });

    worker.on('died', (error) => {
      console.error(`mediasoup worker ${worker.pid} died:`, error);
      // Remove dead worker and create a new one
      const index = workers.indexOf(worker);
      if (index !== -1) {
        workers.splice(index, 1);
      }
      // Optionally restart the worker
      initializeWorkers(1);
    });

    workers.push(worker);
    console.log(`mediasoup worker ${worker.pid} created`);
  }

  console.log(`${workers.length} mediasoup worker(s) initialized`);
  return workers;
}

/**
 * Get the next available worker (round-robin load balancing)
 */
function getNextWorker() {
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

/**
 * Get or create a router for a room
 * Each room has its own router for media routing
 */
async function getOrCreateRouter(roomId) {
  if (routers.has(roomId)) {
    return routers.get(roomId);
  }

  const worker = getNextWorker();
  if (!worker) {
    throw new Error('No mediasoup workers available');
  }

  const router = await worker.createRouter({
    mediaCodecs: config.router.mediaCodecs
  });

  routers.set(roomId, router);
  console.log(`Router created for room: ${roomId}`);
  
  return router;
}

/**
 * Get router RTP capabilities for a room
 * Client needs this to create its device
 */
async function getRouterRtpCapabilities(roomId) {
  const router = await getOrCreateRouter(roomId);
  return router.rtpCapabilities;
}

/**
 * Create a WebRTC transport for a participant
 * Transport handles the DTLS-SRTP connection
 */
async function createWebRtcTransport(roomId, peerId, direction) {
  const router = await getOrCreateRouter(roomId);
  
  // Determine announced IP
  const listenIps = config.webRtcTransport.listenIps.map(ip => ({
    ip: ip.ip,
    announcedIp: ip.announcedIp || getLocalIp()
  }));

  const transport = await router.createWebRtcTransport({
    listenIps,
    enableUdp: config.webRtcTransport.enableUdp,
    enableTcp: config.webRtcTransport.enableTcp,
    preferUdp: config.webRtcTransport.preferUdp,
    initialAvailableOutgoingBitrate: config.webRtcTransport.initialAvailableOutgoingBitrate
  });

  // Set max incoming bitrate
  if (config.webRtcTransport.maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(config.webRtcTransport.maxIncomingBitrate);
    } catch (error) {
      console.warn('Failed to set max incoming bitrate:', error);
    }
  }

  // Store transport
  const transportId = `${peerId}-${direction}`;
  transports.set(transportId, transport);

  // Initialize peer if not exists
  if (!peers.has(peerId)) {
    peers.set(peerId, {
      odId: peerId,
      roomId,
      transports: [],
      producers: [],
      consumers: []
    });
  }
  peers.get(peerId).transports.push(transport.id);

  // Handle transport events
  transport.on('dtlsstatechange', (dtlsState) => {
    console.log(`Transport ${transport.id} DTLS state: ${dtlsState}`);
    if (dtlsState === 'closed') {
      transport.close();
    }
  });

  transport.on('close', () => {
    console.log(`Transport ${transport.id} closed`);
    transports.delete(transportId);
  });

  // Return transport parameters for client
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters
  };
}

/**
 * Connect transport (complete DTLS handshake)
 * Called when client connects its transport
 */
async function connectTransport(peerId, direction, dtlsParameters) {
  const transportId = `${peerId}-${direction}`;
  const transport = transports.get(transportId);
  
  if (!transport) {
    throw new Error(`Transport not found: ${transportId}`);
  }

  await transport.connect({ dtlsParameters });
  console.log(`Transport ${transport.id} connected (DTLS-SRTP established)`);
  
  return true;
}

/**
 * Create a producer (participant sending media)
 */
async function createProducer(peerId, kind, rtpParameters, appData = {}) {
  const transportId = `${peerId}-send`;
  const transport = transports.get(transportId);
  
  if (!transport) {
    throw new Error(`Send transport not found for peer: ${peerId}`);
  }

  const producer = await transport.produce({
    kind,
    rtpParameters,
    appData: { ...appData, peerId }
  });

  // Store producer
  producers.set(producer.id, producer);
  
  if (peers.has(peerId)) {
    peers.get(peerId).producers.push(producer.id);
  }

  producer.on('transportclose', () => {
    console.log(`Producer ${producer.id} transport closed`);
    producer.close();
  });

  producer.on('close', () => {
    console.log(`Producer ${producer.id} closed`);
    producers.delete(producer.id);
  });

  console.log(`Producer created: ${producer.id} (${kind}) for peer: ${peerId}`);
  
  return {
    id: producer.id
  };
}

/**
 * Create a consumer (participant receiving media from another participant)
 */
async function createConsumer(roomId, consumerPeerId, producerId, rtpCapabilities) {
  const router = routers.get(roomId);
  const producer = producers.get(producerId);
  
  if (!router || !producer) {
    throw new Error('Router or producer not found');
  }

  // Check if the consumer can consume this producer
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('Cannot consume this producer');
  }

  const transportId = `${consumerPeerId}-recv`;
  const transport = transports.get(transportId);
  
  if (!transport) {
    throw new Error(`Receive transport not found for peer: ${consumerPeerId}`);
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true // Start paused, resume when client is ready
  });

  // Store consumer
  if (!consumers.has(consumerPeerId)) {
    consumers.set(consumerPeerId, []);
  }
  consumers.get(consumerPeerId).push(consumer);

  if (peers.has(consumerPeerId)) {
    peers.get(consumerPeerId).consumers.push(consumer.id);
  }

  consumer.on('transportclose', () => {
    console.log(`Consumer ${consumer.id} transport closed`);
    consumer.close();
  });

  consumer.on('producerclose', () => {
    console.log(`Consumer ${consumer.id} producer closed`);
    consumer.close();
  });

  console.log(`Consumer created: ${consumer.id} for peer: ${consumerPeerId}`);

  return {
    id: consumer.id,
    producerId: producer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    producerPeerId: producer.appData.peerId
  };
}

/**
 * Resume consumer (start receiving media)
 */
async function resumeConsumer(consumerId) {
  // Find consumer
  for (const [, consumerList] of consumers) {
    const consumer = consumerList.find(c => c.id === consumerId);
    if (consumer) {
      await consumer.resume();
      console.log(`Consumer ${consumerId} resumed`);
      return true;
    }
  }
  throw new Error(`Consumer not found: ${consumerId}`);
}

/**
 * Close peer connection and cleanup resources
 */
async function closePeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) {
    return;
  }

  // Close all producers
  for (const producerId of peer.producers) {
    const producer = producers.get(producerId);
    if (producer) {
      producer.close();
      producers.delete(producerId);
    }
  }

  // Close all consumers
  const peerConsumers = consumers.get(peerId);
  if (peerConsumers) {
    for (const consumer of peerConsumers) {
      consumer.close();
    }
    consumers.delete(peerId);
  }

  // Close all transports
  for (const transportId of peer.transports) {
    for (const [key, transport] of transports) {
      if (transport.id === transportId) {
        transport.close();
        transports.delete(key);
        break;
      }
    }
  }

  peers.delete(peerId);
  console.log(`Peer ${peerId} closed and cleaned up`);
}

/**
 * Close a room and cleanup all resources
 */
async function closeRoom(roomId) {
  const router = routers.get(roomId);
  if (router) {
    router.close();
    routers.delete(roomId);
    console.log(`Room ${roomId} router closed`);
  }

  // Close all peers in this room
  for (const [peerId, peer] of peers) {
    if (peer.roomId === roomId) {
      await closePeer(peerId);
    }
  }
}

/**
 * Get all producers in a room (excluding a specific peer)
 */
function getRoomProducers(roomId, excludePeerId = null) {
  const roomProducers = [];
  
  for (const [peerId, peer] of peers) {
    if (peer.roomId === roomId && peerId !== excludePeerId) {
      for (const producerId of peer.producers) {
        const producer = producers.get(producerId);
        if (producer) {
          roomProducers.push({
            producerId: producer.id,
            peerId,
            kind: producer.kind
          });
        }
      }
    }
  }
  
  return roomProducers;
}

/**
 * Get local IP address
 */
function getLocalIp() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return '127.0.0.1';
}

/**
 * Set announced IP (for NAT traversal)
 */
function setAnnouncedIp(ip) {
  config.webRtcTransport.listenIps[0].announcedIp = ip;
  console.log(`Announced IP set to: ${ip}`);
}

/**
 * Get SFU statistics
 */
function getStats() {
  return {
    workers: workers.length,
    routers: routers.size,
    transports: transports.size,
    producers: producers.size,
    consumers: consumers.size,
    peers: peers.size
  };
}

module.exports = {
  initializeWorkers,
  getRouterRtpCapabilities,
  createWebRtcTransport,
  connectTransport,
  createProducer,
  createConsumer,
  resumeConsumer,
  closePeer,
  closeRoom,
  getRoomProducers,
  setAnnouncedIp,
  getStats
};

