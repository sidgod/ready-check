# ready-check

Real-time workshop checkpoint tool inspired by MMORPG raid mechanics.

A facilitator creates a session, shares a QR code or link, and participants join with a nickname. The facilitator issues ready checks at any time — participants respond **Ready**, **Not Ready**, or **Need Help**. Results stream in real-time on the facilitator's dashboard.

## Why?

In hands-on workshops, people progress at different speeds. Asking "any questions?" to a silent room doesn't work. **ready-check** gives you a non-intrusive signal without putting anyone on the spot — and the "Need Help" button lets participants ask for help without raising their hand in front of everyone.

## Quick Start

```bash
git clone https://github.com/sidgod/ready-check.git
cd ready-check
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`, register with your email, create a session, and share the QR code.

> **Note:** In development mode, PIN codes are logged to the console if SMTP is not configured.

## Features

- **Real-time ready checks** — facilitator issues a check, participants respond instantly via WebSocket
- **QR code sharing** — project the QR code on screen; participants scan and join
- **Three response types** — Ready, Not Ready, Need Help (need help is visible only to the facilitator)
- **Live roster** — see who's connected, who's offline, who responded
- **Response changes** — participants can change their answer while a check is active
- **Auto-reconnect** — handles WiFi blips and phone screen locks gracefully
- **Responsive design** — laptop-first for participants, projector-optimized for facilitators, works on mobile
- **Facilitator auth** — one-time PIN-via-email setup prevents abuse
- **Zero database** — all state in memory, no infrastructure to manage
- **One-click AWS deploy** — CloudFormation template provisions everything

## Deploy to AWS

[![Launch Stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=ready-check&templateURL=https://s3.amazonaws.com/ready-check-cfn/template.yml)

The CloudFormation template provisions:

- Lightsail Container Service (nano, ~$7/mo)
- IAM role with OIDC federation for GitHub Actions (no stored AWS keys)
- SES email identity for facilitator PIN emails
- Route 53 DNS record for your subdomain

After stack creation, follow the post-deploy steps in the stack outputs to configure GitHub secrets and trigger your first deployment.

## Self-Hosted

### Docker (recommended)

```bash
cp .env.example .env
# Edit .env with your SMTP credentials and AUTH_SECRET
docker-compose up -d
```

### Direct Node.js

```bash
npm install
npm start
```

### With HTTPS (Caddy reverse proxy)

```bash
# Install Caddy: https://caddyserver.com/docs/install
# Edit Caddyfile with your domain
caddy start
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BASE_URL` | Public URL of the app | `http://localhost:3000` |
| `AUTH_SECRET` | JWT signing secret | `change-me-to-a-random-string` |
| `SESSION_TTL_HOURS` | Session expiry (hours of inactivity) | `4` |
| `MAX_SESSIONS` | Maximum concurrent sessions | `100` |
| `SMTP_HOST` | SMTP server hostname | — |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `SMTP_FROM` | Sender email address | `noreply@example.com` |

## Architecture

```
Browser (Facilitator)          Browser (Participants)
        |                              |
        |      Socket.IO (WebSocket)   |
        v                              v
  ┌──────────────────────────────────────┐
  │        Node.js + Express             │
  │        Socket.IO + QR Code           │
  │        In-Memory Session Store       │
  └──────────────────────────────────────┘
```

No database, no Redis, no external dependencies beyond SMTP for email. See [DESIGN.md](DESIGN.md) for the full system design document.

## CI/CD

Push to `main` triggers the GitHub Actions pipeline:

1. Run tests
2. Build Docker image
3. Push to GitHub Container Registry
4. Deploy to AWS Lightsail via OIDC (no stored AWS credentials)

## Contributing

```bash
git clone https://github.com/sidgod/ready-check.git
cd ready-check
npm install
npm run dev    # starts with --watch for auto-reload
```

No build step. No webpack. Fork, edit, run.

## License

MIT
