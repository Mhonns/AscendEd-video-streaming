import { io } from "https://cdn.socket.io/4.4.1/socket.io.esm.min.js";

const socket = io('https://streaming.nathadon.com:30000', {
    transports: ['websocket', 'polling', 'flashsocket'],
    cors: {
        origin: "https://streaming.nathadon.com:30000",
        credentials: true
    },
    withCredentials: true
});

const pc_config = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302",
        },
    ],
};

const peerConnection = new RTCPeerConnection(pc_config);