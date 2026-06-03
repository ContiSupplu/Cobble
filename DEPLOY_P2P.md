# Loom P2P Infrastructure — Deployment Guide

## Overview

The P2P system requires two backend services:

| Service | Purpose | Port |
|---------|---------|------|
| **Signaling Server** | WebSocket relay for room creation and WebRTC SDP/ICE exchange | 8090 |
| **TURN Server (coturn)** | Relay for peers behind symmetric NAT / CGNAT | 3478 (UDP/TCP), 5349 (TLS) |

Both can be deployed with a single `docker compose up -d` command.

---

## Quick Start (Docker)

### 1. Set the TURN secret

```bash
# Generate a random secret
openssl rand -hex 32
```

Edit `coturn/turnserver.conf`:
```
static-auth-secret=YOUR_GENERATED_SECRET_HERE
realm=loommc.com
```

### 2. Set environment variables

Create a `.env` file in the project root:
```bash
# Signaling server
PORT=8090

# TURN credentials (same secret as coturn config)
LOOM_TURN_SECRET=YOUR_GENERATED_SECRET_HERE
LOOM_TURN_URLS=turn:your-server.com:3478,turns:your-server.com:5349
LOOM_SIGNALING_URL=wss://your-server.com:8090
```

### 3. Deploy

```bash
docker compose up -d
```

### 4. Verify

```bash
# Check signaling server
wscat -c ws://your-server:8090

# Check TURN (use turnutils_uclient or test from browser)
turnutils_uclient -p 3478 -u test -w test your-server.com
```

---

## VPS Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 512 MB | 1 GB |
| CPU | 1 vCPU | 2 vCPU |
| Bandwidth | 100 Mbps | 1 Gbps |
| Storage | 1 GB | 5 GB |
| OS | Any Linux with Docker | Ubuntu 22.04+ |

**Estimated cost**: $5-10/month on DigitalOcean, Hetzner, or Vultr.

---

## Production Checklist

### Security
- [ ] Change `static-auth-secret` in `coturn/turnserver.conf` to a strong random value
- [ ] Set `LOOM_TURN_SECRET` environment variable to the same value
- [ ] Add TLS certificates to coturn (uncomment `cert` and `pkey` in config)
- [ ] Put the signaling server behind nginx/caddy with WSS (TLS)
- [ ] Set firewall rules: allow 8090, 3478, 5349, 49152-49200

### DNS
- [ ] Point `signal.loommc.com` → VPS IP (for signaling server)
- [ ] Point `turn.loommc.com` → VPS IP (for TURN server)
- [ ] Update `LOOM_SIGNALING_URL` and `LOOM_TURN_URLS` in code

### Launcher Configuration
The launcher reads these environment variables at build time:
- `LOOM_SIGNALING_URL` — WebSocket URL for signaling (default: `ws://localhost:8090`)
- `LOOM_TURN_SECRET` — Shared secret for ephemeral TURN credentials
- `LOOM_TURN_URLS` — Comma-separated TURN URLs

For production builds, set these before building:
```bash
set LOOM_SIGNALING_URL=wss://signal.loommc.com
set LOOM_TURN_SECRET=your-secret-here
set LOOM_TURN_URLS=turn:turn.loommc.com:3478,turns:turn.loommc.com:5349
npm run build
```

---

## Architecture Diagram

```
   Player A (Host)                    Player B (Joiner)
   ┌──────────┐                       ┌──────────┐
   │  Loom    │                       │  Loom    │
   │ Launcher │                       │ Launcher │
   └────┬─────┘                       └────┬─────┘
        │ WebSocket                        │ WebSocket
        ▼                                  ▼
   ┌─────────────────────────────────────────┐
   │         Signaling Server (WS)           │
   │         signal.loommc.com:8090          │
   └─────────────────────────────────────────┘
        │                                  │
        │ ← SDP/ICE exchange →             │
        │                                  │
   ┌────┴─────────────── P2P ──────────────┴────┐
   │              WebRTC DataChannel             │
   │     (direct connection via STUN/TURN)       │
   └─────────────────────────────────────────────┘
                       ↕
   ┌─────────────────────────────────────────┐
   │           TURN Server (coturn)          │
   │         turn.loommc.com:3478            │
   │   (only used when direct P2P fails)     │
   └─────────────────────────────────────────┘
```

---

## Nginx Reverse Proxy (WSS)

To add TLS to the signaling server:

```nginx
server {
    listen 443 ssl;
    server_name signal.loommc.com;

    ssl_certificate /etc/letsencrypt/live/signal.loommc.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/signal.loommc.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```

Then update `LOOM_SIGNALING_URL=wss://signal.loommc.com`.
