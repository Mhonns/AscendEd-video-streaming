#!/bin/bash

# Simple local server script for hosting the website
# This script starts a Python HTTP server in the frontend directory

cd "$(dirname "$0")"

echo "Starting local server..."
echo "Server will be available at: https://streaming.nathadon.com"
echo "Press Ctrl+C to stop the server"
echo ""

# Check if Python 3 is available
if command -v python3 &> /dev/null; then
    python3 -m http.server 443
elif command -v python &> /dev/null; then
    python -m http.server 443
else
    echo "Error: Python is not installed. Please install Python 3 to use this script."
    exit 1
fi