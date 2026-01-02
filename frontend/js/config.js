/**
 * Central Server Configuration
 * Manages server URL, port, and protocol settings
 */

// Server configuration
const ServerConfig = {
  // Primary server (production/remote) - REST API
  primary: {
    host: 'streaming.nathadon.com',
    port: 8443,
    protocol: 'https' // Use HTTPS for production
  },
  
  // Fallback server (local development) - REST API
  fallback: {
    host: 'localhost',
    port: 8443,
    protocol: 'https' // Can be 'http' for local dev without SSL
  },
  
  // Signaling server (Socket.io/WebRTC) configuration
  signaling: {
    primary: {
      host: 'streaming.nathadon.com',
      port: 30000,
      protocol: 'https'
    },
    fallback: {
      host: 'localhost',
      port: 30000,
      protocol: 'https'
    }
  },
  
  // Auto-detect protocol based on current page
  autoDetectProtocol: true,
  
  // Connection timeout in milliseconds
  connectionTimeout: 2000
};

/**
 * Get the current protocol (http/https) based on the page location
 */
function getCurrentProtocol() {
  if (ServerConfig.autoDetectProtocol) {
    return window.location.protocol === 'https:' ? 'https' : 'http';
  }
  return ServerConfig.primary.protocol;
}

/**
 * Build a server URL from configuration
 */
function buildServerURL(config) {
  const protocol = getCurrentProtocol();
  return `${protocol}://${config.host}:${config.port}`;
}

/**
 * Determine the best server URL to use
 * Tries primary first, then alternative, then fallback
 */
let cachedServerURL = null;
let cachedAPIURL = null;

async function determineServerURL() {
  // Return cached URL if available
  if (cachedServerURL) {
    return cachedServerURL;
  }
  
  const servers = [
    { name: 'primary', config: ServerConfig.primary },
    { name: 'fallback', config: ServerConfig.fallback }
  ];
  
  for (const server of servers) {
    const url = buildServerURL(server.config);
    console.log(`Testing ${server.name} server: ${url}`);
    
    cachedServerURL = url;
    cachedAPIURL = `${url}/api`;
    console.log(`Using ${server.name} server: ${cachedServerURL}`);
    return cachedServerURL;
  }
  
  // If all fail, use fallback anyway
  const fallbackURL = buildServerURL(ServerConfig.fallback);
  cachedServerURL = fallbackURL;
  cachedAPIURL = `${fallbackURL}/api`;
  console.warn(`All servers unreachable, using fallback: ${cachedServerURL}`);
  return cachedServerURL;
}

/**
 * Get the current server URL (synchronous, returns cached or default)
 */
function getServerURL() {
  if (cachedServerURL) {
    return cachedServerURL;
  }
  // Return default if not yet determined
  return buildServerURL(ServerConfig.fallback);
}

/**
 * Get the current API URL (synchronous, returns cached or default)
 */
function getAPIURL() {
  if (cachedAPIURL) {
    return cachedAPIURL;
  }
  // Return default if not yet determined
  return `${buildServerURL(ServerConfig.fallback)}/api`;
}

/**
 * Reset cached URLs (useful for reconnection attempts)
 */
function resetServerURL() {
  cachedServerURL = null;
  cachedAPIURL = null;
}

/**
 * Get the signaling server URL (for Socket.io connections)
 */
let cachedSignalingURL = null;

async function getSignalingServerURL() {
  if (cachedSignalingURL) {
    return cachedSignalingURL;
  }
  
  // For signaling server, use primary if protocol matches, otherwise fallback
  const protocol = getCurrentProtocol();
  const primaryURL = buildServerURL(ServerConfig.signaling.primary);
  const fallbackURL = buildServerURL(ServerConfig.signaling.fallback);
  
  // Use primary if it matches current protocol, otherwise fallback
  cachedSignalingURL = (ServerConfig.signaling.primary.protocol === protocol) ? primaryURL : fallbackURL;
  console.log('Signaling server URL:', cachedSignalingURL);
  
  return cachedSignalingURL;
}

// Export configuration and functions
if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS
  module.exports = {
    ServerConfig,
    determineServerURL,
    getServerURL,
    getAPIURL,
    getSignalingServerURL,
    resetServerURL,
    buildServerURL,
    getCurrentProtocol
  };
} else {
  // Browser/Global scope
  window.ServerConfig = ServerConfig;
  window.determineServerURL = determineServerURL;
  window.getServerURL = getServerURL;
  window.getAPIURL = getAPIURL;
  window.getSignalingServerURL = getSignalingServerURL;
  window.resetServerURL = resetServerURL;
}

