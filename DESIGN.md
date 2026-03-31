# ready-check — System Design Document

## 1. Overview

**ready-check** is a real-time, web-based "ready check" tool inspired by MMORPG raid mechanics, designed for workshop facilitators who need to synchronize participants at checkpoints during hands-on sessions.

A facilitator creates a session, shares a link/QR code, and participants join with a nickname. The facilitator can issue ready checks at any time — each participant sees a prompt and responds ready/not-ready/need-help. The facilitator sees results in real time on a dashboard.

---

## 2. Requirements

### 2.1 Functional Requirements

| # | Requirement | Description |
|---|------------|-------------|
| F1 | **Create Session** | Facilitator creates a new session, receives a unique session URL and QR code |
| F2 | **Join Session** | Participant opens the session link, enters a nickname, and joins the session |
| F3 | **Live Roster** | Facilitator sees a real-time list of all connected participants with online/offline status |
| F4 | **Issue Ready Check** | Facilitator triggers a ready check with an optional label (e.g., "Copilot CLI installed?") |
| F5 | **Respond to Ready Check** | Participants respond: ✅ Ready, ❌ Not Ready, or 🖐 Need Help |
| F6 | **Real-time Results** | Facilitator sees responses streaming in with a progress bar and per-participant status |
| F7 | **Ready Check History** | Facilitator can view results of previous ready checks within the session |
| F8 | **Auto-timeout** | Ready checks auto-close after a configurable timeout (default: 60s). No response = "No Response" |
| F9 | **Reconnection** | If a participant's connection drops, they can rejoin with the same nickname and resume |

### 2.2 Non-Functional Requirements

| # | Requirement | Target |
|---|------------|--------|
| NF1 | **Latency** | Ready check broadcast and responses < 200ms |
| NF2 | **Concurrency** | Support 1–100 participants per session comfortably |
| NF3 | **Availability** | Best-effort (workshop tool, not mission-critical) |
| NF4 | **Persistence** | Fully ephemeral — all state in memory, no database |
| NF5 | **Deployment** | Single container, deployable on AWS Lightsail ($3.50/mo) |
| NF6 | **Facilitator Auth** | One-time PIN setup via email to prevent abuse. No auth for participants |
| NF7 | **Responsive Design** | All views must adapt to mobile, laptop, and large displays. Participant view is laptop-first (workshop setting). Facilitator view is projector/large-display-first |

### 2.3 Constraints

- Single developer (open source project)
- Node.js + Socket.IO stack
- No database — all state in-memory
- Must run in a single process (no Redis/cluster needed at this scale)

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Clients (Browser)                  │
│                                                       │
│  ┌─────────────────┐       ┌──────────────────────┐  │
│  │  Facilitator UI  │       │   Participant UI      │  │
│  │  (Dashboard)     │       │   (Join + Respond)    │  │
│  └────────┬─────────┘       └──────────┬────────────┘  │
│           │                            │                │
│           │      WebSocket (Socket.IO) │                │
└───────────┼────────────────────────────┼────────────────┘
            │                            │
            ▼                            ▼
┌─────────────────────────────────────────────────────┐
│                  Node.js Server                       │
│                                                       │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Express  │  │  Socket.IO   │  │  QR Code Gen   │  │
│  │  (HTTP)   │  │  (WebSocket) │  │  (qrcode lib)  │  │
│  └─────┬─────┘  └──────┬───────┘  └────────────────┘  │
│        │               │                               │
│        ▼               ▼                               │
│  ┌─────────────────────────────────────────────────┐  │
│  │              In-Memory Session Store              │  │
│  │                                                   │  │
│  │  sessions: Map<sessionId, Session>                │  │
│  │    Session: {                                     │  │
│  │      id, name, createdAt,                         │  │
│  │      participants: Map<socketId, Participant>,    │  │
│  │      readyChecks: Array<ReadyCheck>,              │  │
│  │      activeCheck: ReadyCheck | null               │  │
│  │    }                                              │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Express (HTTP)** — Serves the static frontend files (facilitator and participant views). Provides REST endpoints to create sessions, generate QR codes, and handle facilitator authentication.

**Socket.IO (WebSocket)** — Handles all real-time communication: participant join/leave events, ready check broadcast, response collection, and roster updates. Each session maps to a Socket.IO room.

**QR Code Generator** — Generates a QR code image (as data URL) for the session join link. Generated server-side so it can be displayed immediately on session creation.

**Facilitator Auth (PIN via Email)** — One-time setup: facilitator enters their email, receives a 6-digit PIN, verifies it. Server stores the hashed email + PIN in memory. Subsequent session creation requires the PIN. This prevents random abuse while keeping friction minimal — facilitators authenticate once per server lifetime, not per session.

**In-Memory Session Store** — A plain `Map` holding all active sessions. No persistence layer. Sessions are automatically cleaned up after a configurable idle timeout (default: 4 hours).

---

## 4. Data Model

### 4.1 Core Entities

```
Facilitator {
  email: string           // hashed (sha256), used as identity key
  pin: string             // hashed (bcrypt), 6-digit numeric PIN
  createdAt: timestamp
  verified: boolean       // true after email PIN verification
}

Session {
  id: string              // nanoid, 8 chars (e.g., "a1b2c3d4")
  name: string            // optional session label set by facilitator
  createdAt: timestamp
  facilitatorEmail: string  // hashed email — links session to facilitator
  facilitatorSocketId: string
  participants: Map<string, Participant>   // keyed by visitorId
  readyChecks: ReadyCheck[]               // history
  activeCheck: ReadyCheck | null
  settings: SessionSettings
}

Participant {
  visitorId: string       // persistent ID (stored in browser, survives reconnects)
  socketId: string        // current Socket.IO connection ID
  nickname: string
  joinedAt: timestamp
  connected: boolean      // tracks online/offline
}

ReadyCheck {
  id: string              // nanoid, 6 chars
  label: string           // e.g., "Copilot CLI installed?"
  startedAt: timestamp
  timeoutSeconds: number  // default 60
  status: "active" | "completed" | "timed_out"
  responses: Map<string, Response>  // keyed by visitorId
}

Response {
  visitorId: string
  nickname: string
  value: "ready" | "not_ready" | "need_help"
  respondedAt: timestamp
}

SessionSettings {
  defaultTimeout: number  // seconds, default 60
}
```

### 4.2 Why `visitorId` instead of `socketId`?

Socket IDs change on every reconnect. If a participant's phone screen locks or they briefly lose WiFi, they'd appear as a new person. Instead, we generate a `visitorId` on first visit (stored in a browser cookie/sessionStorage) and use that as the stable identity. The `socketId` is only used for routing messages.

---

## 5. API Design

### 5.1 REST Endpoints (HTTP)

#### Facilitator Auth

```
POST /api/auth/register
  Body: { email: string }
  Response: { message: "PIN sent to email" }
  Side effect: Generates 6-digit PIN, emails it, stores hashed email + hashed PIN

POST /api/auth/verify
  Body: { email: string, pin: string }
  Response: { token: string }   // JWT or simple signed token, stored as httpOnly cookie
  Side effect: Marks facilitator as verified

GET /api/auth/status
  Response: { authenticated: boolean, email?: string }
  Uses: Cookie-based — checks if current session has a valid facilitator token
```

#### Session Management

```
POST /api/sessions
  Requires: Valid facilitator token (cookie)
  Body: { name?: string }
  Response: { sessionId, joinUrl, qrCodeDataUrl, facilitateUrl }

GET /api/sessions/:id
  Response: { sessionId, name, participantCount, createdAt }

GET /session/:id              → Serves participant UI (HTML)
GET /session/:id/facilitate   → Serves facilitator UI (requires valid facilitator token)

GET /health                   → { status: "ok", uptime, activeSessions }
```

### 5.2 Socket.IO Events

**Participant → Server:**

| Event | Payload | Description |
|-------|---------|-------------|
| `join` | `{ sessionId, nickname, visitorId }` | Join a session |
| `respond` | `{ checkId, value }` | Respond to active ready check |

**Server → Participant:**

| Event | Payload | Description |
|-------|---------|-------------|
| `ready-check:start` | `{ checkId, label, timeoutSeconds }` | A ready check has begun |
| `ready-check:end` | `{ checkId, reason }` | Ready check ended (completed/timed out) |
| `error` | `{ message }` | Validation error |

**Facilitator → Server:**

| Event | Payload | Description |
|-------|---------|-------------|
| `create-check` | `{ label?, timeoutSeconds? }` | Issue a new ready check |
| `end-check` | `{ checkId }` | Manually end active check early |

**Server → Facilitator:**

| Event | Payload | Description |
|-------|---------|-------------|
| `roster:update` | `{ participants[] }` | Full roster with connected status |
| `check:response` | `{ checkId, visitorId, nickname, value }` | Individual response received |
| `check:summary` | `{ checkId, ready, notReady, needHelp, noResponse, total }` | Running totals |
| `check:complete` | `{ checkId, results }` | Final results when check ends |

### 5.3 Socket.IO Room Strategy

Each session = one Socket.IO room named `session:{sessionId}`. The facilitator joins a sub-room `session:{sessionId}:facilitator` for facilitator-only events (roster updates, individual responses). This keeps the participant connection lightweight.

---

## 6. Frontend Design

### 6.1 Pages

Four views, all server-rendered HTML + vanilla JS (no framework). Keeps bundle size tiny and eliminates build steps — important for open-source contributor friendliness.

**Landing Page (`/`)** — Facilitator login (email + PIN) or registration. After auth, shows "Create Session" with session name input.

**Facilitator Dashboard (`/session/:id/facilitate`):**
- Session name + shareable link + QR code (large, projector-friendly)
- Live participant roster with online/offline indicators
- "Issue Ready Check" button with optional label input
- Active ready check panel: progress bar filling up, per-participant response grid
- Ready check history accordion

**Participant View (`/session/:id`):**
- Nickname entry → Join
- Waiting state: "Waiting for ready check..." with session info
- Active check state: Big prominent buttons — ✅ Ready / ❌ Not Ready / 🖐 Need Help
- After responding: "Response recorded" confirmation with what they selected. Can change response while check is still active (last-response-wins).

### 6.2 Responsive Design Strategy

All views use a single CSS stylesheet with a mobile-first approach and breakpoints for three tiers:

| Breakpoint | Target | Notes |
|-----------|--------|-------|
| `< 768px` | Mobile (phone) | Single column, stacked layout, large tap targets |
| `768px – 1200px` | Laptop | Primary target for participants. Side-by-side panels where appropriate |
| `> 1200px` | Large display / Projector | Primary target for facilitator. Maximized QR code, large fonts, grid roster |

**Facilitator view** — optimized for large displays and projectors. QR code dominates on initial view. At laptop resolution, switches to a more compact layout but remains fully functional (facilitator may also be on a laptop during smaller sessions).

**Participant view** — optimized for laptop since workshop participants are coding on laptops. The ready check prompt appears as a clean overlay/banner that doesn't require context-switching away from their work. At mobile resolution, falls back to full-screen buttons for those who prefer using their phone.

### 6.3 UX Priorities

- **Laptop-first for participants**: ready check appears as a non-intrusive banner or modal on the participant's laptop — they shouldn't have to pick up their phone to respond
- **Projector-first for facilitator**: large fonts, high contrast, QR code dominates on initial view
- **Instant feedback**: participant sees their own response immediately, facilitator sees the counter tick up in real-time
- **Response changes allowed**: participants can change their response while a check is active (e.g., clicked "not ready" then figured it out). Last response wins.
- **Non-judgmental**: "Need Help" is a first-class option, not buried. The whole point is to surface who needs help without embarrassing them (facilitator sees it, other participants don't see individual responses)

### 6.3 Privacy Consideration

Participants should NOT see other participants' individual responses. Only the facilitator sees who responded what. Participants can optionally see aggregate counts (e.g., "15/20 ready") but not names. This encourages honest "not ready" / "need help" responses.

---

## 7. Key Flows

### 7.1 Session Creation + Join

```
Facilitator                    Server                     Participant
    │                             │                            │
    │  POST /api/sessions         │                            │
    │  ────────────────────────►  │                            │
    │  { sessionId, qrCode }      │                            │
    │  ◄────────────────────────  │                            │
    │                             │                            │
    │  [projects QR on screen]    │                            │
    │                             │        [scans QR / opens link]
    │                             │                            │
    │  socket: join facilitator   │   socket: join             │
    │  ────────────────────────►  │  ◄─────────────────────────│
    │                             │                            │
    │  roster:update              │                            │
    │  ◄────────────────────────  │                            │
```

### 7.2 Ready Check Flow

```
Facilitator                    Server                     Participants
    │                             │                            │
    │  create-check               │                            │
    │  { label: "CLI setup?" }    │                            │
    │  ────────────────────────►  │                            │
    │                             │   ready-check:start        │
    │                             │  ─────────────────────────►│
    │                             │                            │
    │                             │   respond { "ready" }      │
    │  check:response             │  ◄─────────────────────────│
    │  ◄────────────────────────  │                            │
    │  check:summary              │                            │
    │  ◄────────────────────────  │                            │
    │                             │                            │
    │         ... more responses stream in ...                 │
    │                             │                            │
    │                             │  [timeout or all responded] │
    │  check:complete             │   ready-check:end          │
    │  ◄────────────────────────  │  ─────────────────────────►│
```

---

## 8. Reconnection Strategy

Participants will lose connections (phone locks, WiFi blips). The strategy:

1. **On connect**: Client sends `{ visitorId, sessionId, nickname }`. If the `visitorId` already exists in the session, update the `socketId` and mark `connected: true`. No duplicate entry.
2. **On disconnect**: Mark participant `connected: false` after a 5-second grace period (Socket.IO's built-in reconnect usually fires within this window).
3. **During active check**: If a participant reconnects while a check is active, server re-sends `ready-check:start` to them. If they already responded, client shows their prior response.

Socket.IO's built-in reconnection (exponential backoff, up to 5 attempts) handles most transient failures automatically.

---

## 9. Session Lifecycle and Cleanup

Since everything is in-memory, we need to prevent unbounded growth:

- **Session TTL**: Sessions are cleaned up after 4 hours of inactivity (no socket events). This covers even long workshop days.
- **Max sessions**: Cap at 100 concurrent sessions. Unlikely to be hit, but prevents abuse.
- **On cleanup**: All sockets in the session room are disconnected with a `session:expired` event.
- **Graceful shutdown**: On `SIGTERM`, broadcast `session:expired` to all connected clients before exiting.

---

## 10. Deployment Architecture

### 10.1 Production: AWS Lightsail + GitHub Actions CI/CD

Domain: `readycheck.ubersid.in` (subdomain of existing `ubersid.in`)

```
┌──────────────┐     push to main     ┌───────────────────────┐
│   GitHub      │ ──────────────────► │   GitHub Actions       │
│   Repository  │                      │                        │
│               │                      │  1. Run tests          │
│               │                      │  2. Build Docker image │
│               │                      │  3. Push to GHCR       │
│               │                      │  4. SSH → Lightsail    │
│               │                      │  5. Pull & restart     │
└──────────────┘                      └───────────┬────────────┘
                                                   │
                                                   ▼ SSH deploy
┌─────────────────────────────────────────────────────────────┐
│  AWS Lightsail ($3.50/mo)                                    │
│                                                              │
│  ┌──────────────┐     ┌──────────────────────────────────┐  │
│  │  Caddy        │────►│  Docker: ready-check             │  │
│  │  (reverse     │     │  Node.js + Socket.IO             │  │
│  │   proxy +     │     │  Port 3000                       │  │
│  │   auto HTTPS) │     └──────────────────────────────────┘  │
│  │  Port 80/443  │                                           │
│  └──────────────┘                                            │
│                                                              │
│  Static IP ◄── DNS: readycheck.ubersid.in (A record)        │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 GitHub Actions Pipeline

Follows the same OIDC federation pattern used for `ubersid.in` blog deployment — no long-lived AWS keys stored in GitHub. The existing OIDC identity provider in the AWS account is reused.

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy ready-check

on:
  push:
    branches: [main]
  workflow_dispatch:  # Allow manual trigger from GitHub UI

# OIDC token federation with AWS (same pattern as ubersid.in blog)
permissions:
  id-token: write
  contents: read
  packages: write    # For pushing to GHCR

# Prevent concurrent deployments
concurrency:
  group: deploy
  cancel-in-progress: true

env:
  AWS_REGION: 'us-east-1'
  LIGHTSAIL_INSTANCE: 'ready-check'
  IMAGE_NAME: 'ghcr.io/sidgod/ready-check'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Build and push Docker image to GHCR
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:latest
            ${{ env.IMAGE_NAME }}:${{ github.sha }}

      # AWS OIDC authentication (reuses existing OIDC provider)
      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      # Deploy to Lightsail via AWS SSM (no SSH keys needed)
      - name: Deploy to Lightsail
        run: |
          aws lightsail create-container-service-deployment \
            --service-name ready-check \
            --containers '{
              "ready-check": {
                "image": "${{ env.IMAGE_NAME }}:${{ github.sha }}",
                "ports": {"3000": "HTTP"},
                "environment": {
                  "NODE_ENV": "production",
                  "AUTH_SECRET": "${{ secrets.AUTH_SECRET }}",
                  "SMTP_HOST": "${{ secrets.SMTP_HOST }}",
                  "SMTP_USER": "${{ secrets.SMTP_USER }}",
                  "SMTP_PASS": "${{ secrets.SMTP_PASS }}",
                  "SMTP_FROM": "noreply@ubersid.in",
                  "BASE_URL": "https://readycheck.ubersid.in"
                }
              }
            }' \
            --public-endpoint '{
              "containerName": "ready-check",
              "containerPort": 3000,
              "healthCheck": {
                "path": "/health"
              }
            }'
```

**Note on deployment approach:** Two options exist for Lightsail:

**Option A — Lightsail Container Service** (shown above): Managed containers, auto HTTPS, no server to maintain. Starts at $7/mo (nano). The OIDC role only needs `lightsail:CreateContainerServiceDeployment` permissions. No SSH keys, no Caddy, no manual server setup.

**Option B — Lightsail Instance + SSH**: Classic $3.50/mo instance with Docker + Caddy. Requires SSH key in secrets and a deploy script. Cheaper but more manual maintenance. If choosing this route, use `appleboy/ssh-action@v1` in the workflow to SSH and pull/restart the container.

Recommendation: Start with Option A (Container Service) for the cleaner ops story — especially for an open-source project where simplicity matters. The $3.50/mo difference is worth not managing a server.

### 10.3 AWS IAM — Deployment Role

Create IAM role `github-actions-ready-check-deploy` with the same OIDC trust pattern as the blog:

**Trust policy** (reuses existing OIDC provider, scoped to this repo):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:sidgod/ready-check:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

**Permissions policy** (scoped to Lightsail container service only):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LightsailContainerDeploy",
      "Effect": "Allow",
      "Action": [
        "lightsail:CreateContainerServiceDeployment",
        "lightsail:GetContainerServices",
        "lightsail:GetContainerServiceDeployments"
      ],
      "Resource": "arn:aws:lightsail:us-east-1:<ACCOUNT_ID>:ContainerService/ready-check"
    }
  ]
}
```

### 10.4 GitHub Secrets Required

| Secret | Purpose | Source |
|--------|---------|--------|
| `AWS_ROLE_ARN` | IAM role ARN for OIDC federation | IAM console |
| `AUTH_SECRET` | JWT signing secret for facilitator tokens | Generate: `openssl rand -hex 32` |
| `SMTP_HOST` | SES SMTP endpoint | `email-smtp.us-east-1.amazonaws.com` |
| `SMTP_USER` | SES SMTP username | SES console |
| `SMTP_PASS` | SES SMTP password | SES console |

### 10.5 DNS Setup

Add a CNAME record in Route 53 (where `ubersid.in` is managed):
- `readycheck.ubersid.in` → Lightsail container service public domain
- Lightsail Container Service handles HTTPS automatically (AWS-managed cert)

If using Option B (Lightsail instance), use an A record pointing to the static IP with Caddy for HTTPS.

### 10.6 Infrastructure as Code (CloudFormation)

All AWS infrastructure is defined in a single CloudFormation template (`infra/template.yml`) so that anyone can deploy the full stack with one click.

**README "Launch Stack" button:**
```markdown
[![Launch Stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=ready-check&templateURL=https://s3.amazonaws.com/ready-check-cfn/template.yml)
```

Users click the button → AWS Console opens with the template pre-loaded → they fill in parameters → hit Create. The entire stack deploys in ~5 minutes.

**Template parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `DomainName` | Subdomain for the app (e.g., `readycheck.example.com`) | — (required) |
| `HostedZoneId` | Route 53 hosted zone ID for the parent domain | — (required) |
| `GitHubOrg` | GitHub org/user that owns the repo | — (required) |
| `GitHubRepo` | Repository name | `ready-check` |
| `GitHubBranch` | Branch that triggers deploy | `main` |
| `ContainerPower` | Lightsail container size | `nano` |
| `NotificationEmail` | Email for SES sender identity verification | — (required) |
| `AuthSecret` | JWT signing secret for facilitator tokens | Auto-generated via `AWS::SecretsManager` |

**Resources provisioned:**

```yaml
Resources:
  # --- Compute ---
  ContainerService:
    Type: AWS::Lightsail::ContainerService    # Nano ($7/mo), managed Docker hosting

  # --- Auth / Email ---
  SESEmailIdentity:
    Type: AWS::SES::EmailIdentity             # Verifies sender domain for PIN emails
  SESDomainDKIM:
    Type: AWS::Route53::RecordSetGroup        # DKIM DNS records for SES

  # --- CI/CD (OIDC) ---
  # Note: OIDC provider is NOT created here — it already exists in Sid's account
  # and is a singleton per AWS account. For other users, a condition checks and
  # creates it only if missing.
  OIDCProvider:
    Type: AWS::IAM::OIDCProvider
    Condition: CreateOIDCProvider              # Only if not already present
  DeployRole:
    Type: AWS::IAM::Role                      # OIDC-federated role for GitHub Actions
    # Trust: repo:<GitHubOrg>/<GitHubRepo>:ref:refs/heads/<GitHubBranch>
    # Permissions: lightsail:CreateContainerServiceDeployment (scoped)

  # --- DNS ---
  DNSRecord:
    Type: AWS::Route53::RecordSet             # CNAME → Lightsail container service URL

  # --- Secrets ---
  AuthSecretValue:
    Type: AWS::SecretsManager::Secret         # Auto-generated JWT signing secret

Outputs:
  ServiceURL:          # Public URL of the deployed app
  DeployRoleARN:       # ARN to store as GitHub secret AWS_ROLE_ARN
  SESSmtpEndpoint:     # SMTP endpoint for .env / GitHub secrets
  LaunchInstructions:  # Post-deploy steps (create SES SMTP credentials, set GitHub secrets)
```

**What the template does NOT provision:**
- SES SMTP credentials (must be created manually in IAM — CloudFormation can't create these)
- GitHub repository secrets (user copies the output values into their repo settings)
- The initial container deployment (first deploy happens when user pushes to main)

**For users who already have an OIDC provider:** The template uses a `Condition` to skip creating the OIDC provider if the parameter `ExistingOIDCProvider` is set to `true`. This avoids the "resource already exists" error that would hit anyone who's already set up OIDC for another project (like you with the blog).

**Self-hosted users without AWS:** The CloudFormation template is optional. The README also documents Docker + docker-compose for any hosting environment, plus a Caddyfile for reverse proxy.

### 10.7 Alternative: Self-Hosted (for open-source users)

For contributors or other users who want to self-host:

```bash
# Option A: Docker (recommended)
docker-compose up -d

# Option B: Direct Node.js
npm install && npm start
```

The README will include both options with a Caddyfile example for those who want a reverse proxy:

```
readycheck.example.com {
    reverse_proxy localhost:3000
}
```

---

## 11. Project Structure

```
ready-check/
├── server.js                  # Express + Socket.IO server entry point
├── package.json
├── Dockerfile
├── docker-compose.yml
├── Caddyfile                  # Caddy reverse proxy config (self-hosted)
├── .env.example               # PORT, SESSION_TTL_HOURS, MAX_SESSIONS, SMTP_*
├── .github/
│   └── workflows/
│       └── deploy.yml         # CI/CD: test → build → push → deploy
├── infra/
│   └── template.yml           # CloudFormation stack (one-click deploy)
├── LICENSE                    # MIT
├── README.md
├── DESIGN.md                  # This document
│
├── src/
│   ├── session-store.js       # In-memory session management
│   ├── ready-check.js         # Ready check logic and timeout handling
│   ├── socket-handlers.js     # Socket.IO event handlers
│   ├── auth.js                # Facilitator PIN auth (email, verify, token)
│   ├── mailer.js              # Email transport (nodemailer, SES-compatible)
│   └── routes.js              # Express REST routes
│
├── public/
│   ├── index.html             # Landing page (auth + create session)
│   ├── facilitate.html        # Facilitator dashboard
│   ├── join.html              # Participant view
│   ├── css/
│   │   └── style.css          # Single stylesheet, mobile-first responsive
│   └── js/
│       ├── facilitator.js     # Facilitator-side Socket.IO client
│       ├── participant.js     # Participant-side Socket.IO client
│       └── auth.js            # Facilitator auth UI logic
│
└── test/
    ├── session-store.test.js
    ├── ready-check.test.js
    └── auth.test.js
```

---

## 12. Trade-off Analysis

| Decision | Choice | Alternative | Why |
|----------|--------|-------------|-----|
| **Runtime** | Node.js | Go, Spring Boot | Fastest to build, largest OSS contributor pool, Socket.IO is best-in-class for this use case |
| **Real-time transport** | Socket.IO | Raw WebSocket, SSE | Auto-reconnection, room abstraction, fallback to polling — all out of the box |
| **Frontend framework** | Vanilla JS | React, Vue | Zero build step, tiny payload, any contributor can read it. The UI is simple enough to not need a framework |
| **Persistence** | In-memory Map | SQLite, Redis | No state survives restarts, but we don't need it to. Eliminates all infra dependencies |
| **Auth** | PIN via email (facilitator only) | OAuth, magic link | One-time setup, minimal friction. No third-party OAuth dependency. Prevents session creation abuse |
| **Hosting** | Single process | Clustered / load-balanced | At 1-100 users per session, a single Node process handles this trivially. No need to over-engineer |
| **QR Code** | Server-generated data URL | Client-side generation | Works instantly on session create, no client JS dependency needed |

### What to Revisit if the Project Grows

- **Persistence**: If people want session history / analytics, add SQLite with better-sqlite3 (zero-config, single file)
- **Multi-session facilitator**: A facilitator dashboard showing all their sessions across time
- **Clustering**: If somehow this serves many concurrent sessions, add Redis adapter for Socket.IO to distribute across processes
- **OAuth login**: Replace PIN-via-email with Google/GitHub OAuth for smoother facilitator UX

---

## 13. Facilitator Authentication Flow

### 13.1 Registration (One-Time)

```
Facilitator                     Server                        Email
    │                              │                             │
    │  POST /api/auth/register     │                             │
    │  { email }                   │                             │
    │  ───────────────────────►    │                             │
    │                              │  Generate 6-digit PIN       │
    │                              │  Store: hash(email) →       │
    │                              │    hash(PIN), expires 10m   │
    │                              │                             │
    │                              │  Send PIN email             │
    │                              │  ─────────────────────────► │
    │  { message: "PIN sent" }     │                             │
    │  ◄───────────────────────    │                             │
    │                              │                             │
    │  POST /api/auth/verify       │                             │
    │  { email, pin }              │                             │
    │  ───────────────────────►    │                             │
    │                              │  Verify PIN, set httpOnly   │
    │  Set-Cookie: auth_token      │  cookie with signed token   │
    │  ◄───────────────────────    │                             │
```

### 13.2 Design Decisions

- **PIN is 6 digits, numeric only**: Easy to type from a phone/email on a different device
- **PIN expires in 10 minutes**: Short enough to prevent forwarding, long enough for email delays
- **Rate limited**: Max 3 PIN requests per email per hour, max 5 verify attempts per PIN
- **Token stored as httpOnly cookie**: Not accessible via JS, auto-sent on requests. Signed with a server secret (from env var `AUTH_SECRET`)
- **Token TTL**: 24 hours. Facilitator re-authenticates daily at most
- **No password**: This is deliberately not a full account system. Email + PIN is the identity. No password to forget or manage.

### 13.3 Email Transport

Use `nodemailer` with configurable SMTP transport. For production on AWS, use SES (free tier: 62,000 emails/month). For self-hosters, any SMTP server works.

```
# .env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<SES SMTP user>
SMTP_PASS=<SES SMTP password>
SMTP_FROM=noreply@ubersid.in
```

---

## 14. Edge Cases and Defensive Design

### 14.1 Duplicate Nicknames

Auto-suffix with a number: "Alice", "Alice-2", "Alice-3". Server enforces uniqueness within a session. On rejoin (same `visitorId`), the original nickname is preserved.

### 14.2 Facilitator Disconnects During Active Check

The ready check continues — it's driven by a server-side `setTimeout`, not the facilitator's connection. When the facilitator reconnects, they receive the current state of the active check (or the completed results if it finished while they were away).

### 14.3 Browser Tab Close

`visitorId` is stored in `localStorage` scoped to the session URL. If a participant closes their tab and reopens the same link, they rejoin with the same identity. If they use a different browser or clear storage, they appear as a new participant.

### 14.4 Response During Timeout Race

Server uses a mutex-like flag: once a check is marked `completed` or `timed_out`, no further responses are accepted. Responses that arrive in the same event loop tick as the timeout are accepted (timeout callback runs after pending I/O).

### 14.5 Roster Update Throttling

`roster:update` events are debounced: on rapid join/leave bursts, the server batches updates and emits at most once every 500ms to the facilitator.

### 14.6 Input Sanitization

All user-provided strings (nicknames, session names, check labels) are sanitized server-side. The frontend renders using `textContent` (not `innerHTML`) to prevent XSS. Maximum lengths: nickname (30 chars), session name (100 chars), check label (200 chars).

---

## 15. Open Source Considerations

- **License**: MIT — maximum adoption
- **Contributing guide**: Keep it simple. `npm install && npm start` and you're developing
- **No build step**: Intentional. Fork → edit → run. No webpack/vite/rollup to wrestle with
- **Environment variables**: All config via `.env` with sane defaults. Zero config to get started
- **Docker**: Optional but provided. `docker-compose up` for those who prefer it

---

## 16. Summary

ready-check is deliberately small and focused. It solves one problem well: synchronizing a group of people at checkpoints during a live session. The tech choices optimize for simplicity, contributor friendliness, and near-zero operational cost. The MMORPG framing makes it fun and memorable — which matters for a LinkedIn post and open-source adoption.
