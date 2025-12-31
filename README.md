video-conference/
│
├── public/                          # All frontend files
│   │
│   ├── index.html                   # Landing page [UPDATED]
│   │
│   ├── pages/                       # Other pages
│   │   ├── room.html               # Meeting room (to be created)
│   │   └── recordings.html         # Recordings list (to be created)
│   │
│   ├── css/                        # Stylesheets
│   │   ├── main.css               # Global styles (optional)
│   │   ├── landing.css            # Landing page styles [UPDATED]
│   │   ├── room.css               # Room styles (to be created)
│   │   └── recordings.css         # Recordings styles (to be created)
│   │
│   ├── js/                         # JavaScript files
│   │   ├── landing.js             # Landing page logic [UPDATED]
│   │   ├── room.js                # Room page logic (to be created)
│   │   ├── webrtc.js              # WebRTC handling (to be created)
│   │   ├── socket.js              # Socket connection (to be created)
│   │   └── recordings.js          # Recordings logic (to be created)
│   │
│   └── assets/                     # Images, icons, etc.
│       ├── images/
│       │   └── logo.png
│       └── icons/
│           ├── camera.svg
│           ├── microphone.svg
│           └── screen-share.svg
│
└── server/                          # Backend files (for later)
    ├── server.js                    # Node.js server
    ├── package.json                 # Dependencies
    ├── routes/                      # API routes
    └── models/                      # Database models