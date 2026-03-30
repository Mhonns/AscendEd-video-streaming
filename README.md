AscendEd-video-streaming/
│
├── README.md
├── TODO.md
├── .gitignore
│
├── docs/                            ← all design/architecture references
│   └── peer-connection-arch.webp
│
├── deploy/                          ← deployment/infra scripts
│   ├── rsync.sh
│   ├── fix_scaler.patch
│   └── turnserver/
│       ├── config.sh
│       ├── init.sh
│       └── start-stop.sh
│
├── frontend/
│   ├── pages/                       ← ALL html pages together
│   │   ├── index.html               ← (moved from frontend/ root)
│   │   └── room.html
│   │
│   ├── css/
│   │   ├── base/
│   │   │   └── global.css           ← shared resets, variables, typography
│   │   ├── pages/
│   │   │   ├── landing.css
│   │   │   └── room.css
│   │   └── components/              ← per-component stylesheets
│   │       ├── buttons.css
│   │       ├── chat.css
│   │       └── people.css
│   │
│   ├── js/
│   │   ├── pages/                   ← page entry points
│   │   │   ├── landing.js
│   │   │   └── room.js
│   │   ├── features/                ← domain features
│   │   │   ├── media.js             ← camera / mic / media stream
│   │   │   ├── sfu-broadcast.js     ← SFU produce side
│   │   │   ├── sfu-consume.js       ← SFU consume side
│   │   │   ├── recording.js         ← recording UI logic
│   │   │   ├── chat.js              ← chat feature
│   │   │   └── users.js             ← user list feature
│   │   └── core/                    ← shared utilities & plumbing
│   │       ├── socket-handler.js    ← socket.io client setup
│   │       ├── config.js            ← app-level config / constants
│   │       ├── ui-controls.js       ← generic UI helpers
│   │       ├── buttons.js           ← toolbar button logic
│   │       └── room-utils.js        ← misc room helpers
│   │
│   └── assets/
│       ├── icons/                   ← SVG icons (unchanged)
│       └── images/                  ← static images (unchanged)
│
└── server/
    ├── package.json                 ← server dependencies (wrtc moved here)
    ├── main.js                      ← entry point
    │
    ├── routes/                      ← all Express REST routes
    │   ├── api.js                   ← (moved from server/api.js)
    │   └── recording.js             ← (moved from server/recorder/recording.js)
    │
    ├── socket/                      ← all socket.io logic
    │   └── socket-events.js         ← (moved from server/socket-events.js)
    │
    ├── sfu/                         ← mediasoup SFU (split if desired)
    │   └── sfu.js                   ← (moved from server/sfu.js)
    │
    ├── modules/                     ← stateful business-logic modules
    │   ├── rooms.js
    │   └── chat.js
    │
    ├── recorder/                    ← recorder feature (unchanged internally for now)
    │   ├── index.js                 ← core recorder logic
    │   ├── recordings/              ← saved recording files
    │   └── init.sh
    │
    └── scripts/                     ← server-side maintenance scripts
        └── install-sfu-node.sh
