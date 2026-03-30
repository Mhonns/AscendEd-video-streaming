sudo nano /etc/default/coturn

# TURNSERVER_ENABLED=1

sudo nano /etc/turnserver.conf

# # Network
# listening-port=3478
# tls-listening-port=5349
# listening-ip=0.0.0.0
# relay-ip=YOUR_SERVER_PUBLIC_IP
# external-ip=YOUR_SERVER_PUBLIC_IP

# # Authentication
# realm=yourdomain.com
# server-name=yourdomain.com

# # Credentials (static)
# user=yourusername:yourpassword

# # TLS (optional but recommended)
# cert=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
# pkey=/etc/letsencrypt/live/yourdomain.com/privkey.pem

# # Security
# fingerprint
# lt-cred-mech
# no-multicast-peers
# denied-peer-ip=10.0.0.0-10.255.255.255
# denied-peer-ip=192.168.0.0-192.168.255.255
# denied-peer-ip=172.16.0.0-172.31.255.255

# # Logging
# log-file=/var/log/turnserver.log
# verbose