### Feedback and TODO
## Feature
# setting eg. sound out, mic in, noise cancel
# react and raise hand
# Owner pin ban kick mute and mute all

## Security
# Load Test (DDoS) and QA
# Prevent leakage

## Testing
# Unit test
# Load test try many web rtc connection
# Browser Test
# Device Test


### SFU
## Server
# Sanitize User Request
## Client
# Add socket to listen for newcomers
<!-- // Listen for new broadcasters joining
socket.on('new-broadcaster', ({ roomId, userId }) => {
    // Call /consumer endpoint to get the new stream
});

// Listen for broadcasters leaving
socket.on('broadcaster-left', ({ roomId, userId }) => {
    // Remove their video element from UI
});

// Listen for ICE candidates from server
socket.on('ice-candidate', ({ candidate, userId, type }) => {
    // Add ICE candidate to the appropriate peer connection
});

// Send ICE candidates to server
peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
        socket.emit('ice-candidate', {
            roomId, userId, candidate: event.candidate, type: 'broadcaster' // or 'consumer'
        });
    }
}; -->