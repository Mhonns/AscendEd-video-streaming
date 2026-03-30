# AscendEd Video Streaming

A self-hosted, real-time video conferencing platform built for the AscendEd educational environment. It enables teachers and students to meet, collaborate, and communicate through browser-based video calls — no downloads required.

## Objective

AscendEd Video Streaming aims to provide a lightweight, privacy-respecting video conferencing solution that schools and institutions can host on their own infrastructure. The platform supports multi-participant video/audio, screen sharing, live chat, emoji reactions, and session recording — giving educators full control over their meeting environment without relying on third-party services.

## Features

- **Multi-participant video & audio** via WebRTC SFU (Selective Forwarding Unit)
- **Screen sharing** with multi-screen navigation
- **Live chat** with message history
- **Emoji reactions** with floating animation
- **Server-side recording** (host only, saved as MP4)
- **Password-protected rooms**
- **Host admin controls** — force mute, force camera off, disable chat/emoji
- **Raise hand** indicator
- **Real-time user list** with mic/camera/screen status indicators
- **Persistent settings** across sessions

## Tech Stack

| Layer | Technology |
|---|---|
| Signalling & API | Node.js, Express, Socket.io |
| Media transport | WebRTC (wrtc), custom SFU |
| Recording | FFmpeg (server-side) |
| TURN server | coturn |
| Frontend | Vanilla HTML / CSS / JavaScript |
| TLS | Let's Encrypt (certbot) |

## Project Structure

```
AscendEd-video-streaming/
├── docs/                        # Architecture diagrams & references
├── deploy/                      # Deployment scripts & TURN server config
│   └── turnserver/
├── frontend/
│   ├── pages/                   # HTML pages (index.html, room.html)
│   ├── css/
│   │   ├── base/                # Global resets & CSS variables
│   │   ├── pages/               # Per-page stylesheets
│   │   └── components/          # Reusable component stylesheets
│   ├── js/
│   │   ├── pages/               # Page entry points (landing.js, room.js)
│   │   ├── features/            # Domain features (media, chat, users, recording …)
│   │   └── core/                # Shared utilities & Socket.io plumbing
│   └── assets/
│       ├── icons/               # SVG icons
│       └── images/              # Static images
└── server/
    ├── main.js                  # Server entry point
    ├── routes/                  # Express REST routes (api, recording)
    ├── socket/                  # Socket.io event handlers
    ├── sfu/                     # WebRTC SFU logic
    ├── modules/                 # Stateful modules (rooms, chat)
    ├── recorder/                # Server-side recording engine
    └── scripts/                 # Server maintenance scripts
```

## Getting Started

### Prerequisites

- Node.js ≥ 18
- FFmpeg installed on the server
- (Optional) coturn for TURN support
- (Optional) A valid TLS certificate (Let's Encrypt recommended)

### Install & Run

```bash
# Install server dependencies
cd server
npm install

# Start the server (development)
npm run dev

# Start the server (production)
npm start
```

The server listens on port **8443** by default. If SSL certificates are present at the configured paths it starts as HTTPS; otherwise it falls back to HTTP.

### Deploy Frontend to nginx

```bash
bash deploy/rsync.sh
```

This syncs the `frontend/` directory to `/var/www/streaming` and restarts nginx.

## License

ISC
