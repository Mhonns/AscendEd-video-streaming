/**
 * Main Server Entry Point
 * Sets up Express, Socket.io, and starts the server
 */

const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const PORT = process.env.PORT || 8443;

// Import modules
const apiRoutes = require('./api');
const { initSocketEvents } = require('./socket-events');
const { setIo: setSfuIo } = require('./sfu');

const app = express();

// SSL Certificate paths
const SSL_CERT_PATH = '/etc/letsencrypt/live/streaming.nathadon.com/fullchain.pem';
const SSL_KEY_PATH = '/etc/letsencrypt/live/streaming.nathadon.com/privkey.pem';

// Check if certificate files exist
let sslOptions = null;
try {
  if (fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH)) {
    sslOptions = {
      cert: fs.readFileSync(SSL_CERT_PATH),
      key: fs.readFileSync(SSL_KEY_PATH)
    };
    console.log('SSL certificates loaded successfully');
  } else {
    console.warn('SSL certificates not found. Server will run without HTTPS.');
    console.warn(`Looking for cert: ${SSL_CERT_PATH}`);
    console.warn(`Looking for key: ${SSL_KEY_PATH}`);
  }
} catch (error) {
  console.error('Error loading SSL certificates:', error.message);
  console.warn('Server will run without HTTPS.');
}

// Create HTTPS server if certificates are available, otherwise fallback to HTTP
let server;
if (sslOptions) {
  server = https.createServer(sslOptions, app);
} else {
  const http = require('http');
  server = http.createServer(app);
  console.warn('Running in HTTP mode. For production, ensure SSL certificates are configured.');
}

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Mount API routes
app.use('/api', apiRoutes);

// Initialize Socket.io event handlers
initSocketEvents(io);

// Set Socket.io instance for SFU module
setSfuIo(io);

// Initialize mediasoup workers and start server
async function startServer() {
  try {
    // Start HTTP/HTTPS server
    server.listen(PORT, () => {
      const protocol = sslOptions ? 'https' : 'http';
      console.log(`Server running on ${protocol}://localhost:${PORT}`);
      if (sslOptions) {
        console.log(`HTTPS server accessible at: https://streaming.nathadon.com:${PORT}`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
