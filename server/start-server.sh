#!/bin/bash

# Start the Node.js backend server
# Make sure to run 'npm install' first if dependencies are not installed

cd "$(dirname "$0")"

echo "Starting AscendEd Video Streaming Server..."
echo "Server will be available at: http://0.0.0.0:3000"
echo "Press Ctrl+C to stop the server"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Start the server
npm start