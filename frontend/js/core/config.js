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
    console.log(`[Config] Testing ${server.name} server: ${url}`);
    
    cachedServerURL = url;
    cachedAPIURL = `${url}/api`;
    console.log(`[Config] Using ${server.name} server: ${cachedServerURL}`);
    return cachedServerURL;
  }
  
  // If all fail, use fallback anyway
  const fallbackURL = buildServerURL(ServerConfig.fallback);
  cachedServerURL = fallbackURL;
  cachedAPIURL = `${fallbackURL}/api`;
  console.warn(`[Config] All servers unreachable, using fallback: ${cachedServerURL}`);
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

// Export configuration and functions
if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS
  module.exports = {
    ServerConfig,
    determineServerURL,
    getServerURL,
    getAPIURL,
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
  window.resetServerURL = resetServerURL;
}

// ─────────────────────────────────────────────────────────────
// AppSettings — shared settings store backed by localStorage
// All setting keys and their defaults are declared here.
// Both the landing page and the room page use this module.
// ─────────────────────────────────────────────────────────────
const APP_SETTINGS_KEY = 'appSettings';

const DEFAULT_SETTINGS = {
  // Voice & Video
  noiseCancelling: false,

  // Room
  autoRecording: false,
  optimizeVideoStreaming: true,
  passwordEnabled: false,
  roomPassword: '',
  maxUser: 50,

  // Admin (host only)
  forceMute: false,
  forceCloseCamera: false,
  disableChat: false,
  disableEmoji: false
};

const AppSettings = (() => {
  /** Load settings object from localStorage (merged with defaults) */
  function load() {
    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (raw) {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
      }
    } catch (e) {
      console.warn('[AppSettings] Failed to parse settings:', e);
    }
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  /** Persist the current settings object */
  function _save(settings) {
    try {
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('[AppSettings] Failed to save settings:', e);
    }
  }

  /** Get a single setting value */
  function get(key) {
    const s = load();
    return key in s ? s[key] : DEFAULT_SETTINGS[key];
  }

  /** Set a single setting value and persist */
  function set(key, value) {
    const s = load();
    s[key] = value;
    _save(s);
  }

  /** Get all settings */
  function getAll() {
    return load();
  }

  /** Reset to defaults */
  function reset() {
    _save(Object.assign({}, DEFAULT_SETTINGS));
  }

  return { get, set, getAll, reset, DEFAULT_SETTINGS };
})();

// Expose globally
if (typeof window !== 'undefined') {
  window.AppSettings = AppSettings;
}