# AscendEd Video Streaming

A video conferencing application with room management capabilities.

## Project Structure

```
AscendEd-video-streaming/
│
├── frontend/                        # Frontend files
│   │
│   ├── index.html                   # Landing page
│   │
│   ├── pages/                       # Other pages
│   │   ├── room.html               # Meeting room
│   │   └── recordings.html         # Recordings list (to be created)
│   │
│   ├── css/                        # Stylesheets
│   │   ├── landing.css            # Landing page styles
│   │   ├── room.css               # Room styles
│   │   └── recordings.css         # Recordings styles (to be created)
│   │
│   ├── js/                         # JavaScript files
│   │   ├── landing.js             # Landing page logic
│   │   ├── room.js                # Room page logic
│   │   ├── webrtc.js              # WebRTC handling (to be created)
│   │   ├── socket.js              # Socket connection (to be created)
│   │   └── recordings.js          # Recordings logic (to be created)
│   │
│   └── assets/                     # Images, icons, etc.
│       └── icons/                  # SVG icons
│
└── server/                          # Backend files
    ├── server.js                    # Node.js server with Socket.io
    ├── package.json                 # Dependencies
    └── start-server.sh              # Server startup script
```

## Features

- **Room Management**: Create and join video conference rooms
- **Room Validation**: Alerts users if they try to join a non-existent room
- **Real-time Communication**: Socket.io integration for real-time updates

## Setup and Running

### Prerequisites
- Node.js (v14 or higher)
- npm

### Backend Server

1. Navigate to the server directory:
   ```bash
   cd server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   # Or use the startup script:
   ./start-server.sh
   ```

The backend server will run on `http://localhost:3000`

### Frontend

The frontend is served by the backend server. Once the backend is running, access the application at:
- Landing page: `http://localhost:3000/index.html`
- Room page: `http://localhost:3000/pages/room.html`

Alternatively, you can use the simple Python server for frontend-only development:
```bash
./start-server.sh  # This runs the Python HTTP server on port 8000
```

## API Endpoints

### Create Room
- **POST** `/api/rooms/create`
- Body: `{ "roomId": "ABC123", "meetingName": "My Meeting" }`
- Returns: Room details with host ID

### Join Room
- **POST** `/api/rooms/join`
- Body: `{ "roomId": "ABC123" }`
- Returns: Room details and user ID
- **Error**: Returns 404 if room doesn't exist

### Get Room Info
- **GET** `/api/rooms/:roomId`
- Returns: Room information and participant count

## Socket.io Events

### Client → Server
- `join-room`: Join a room with `{ roomId, userId }`
- `leave-room`: Leave a room with `{ roomId, userId }`

### Server → Client
- `room-joined`: Confirmation of successful room join
- `room-error`: Error message if room doesn't exist
- `user-joined`: Notification when another user joins
- `user-left`: Notification when a user leaves