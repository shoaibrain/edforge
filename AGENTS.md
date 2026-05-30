# AGENTS.md

Guidance for Cursor Cloud agents working in this repository.

## Cursor Cloud specific instructions

### VM services (not in the update script)

The update script only refreshes npm dependencies. Before running the local API stack, ensure these are running:

1. **Docker daemon** — In this Cloud VM, systemd may not start `dockerd` automatically. If `docker info` fails, start it once per session:
   ```bash
   sudo dockerd > /tmp/dockerd.log 2>&1 &
   sleep 3
   sudo chmod 666 /var/run/docker.sock
   ```
   The image uses `fuse-overlayfs` (`/etc/docker/daemon.json`) and `iptables-legacy` for nested Docker.

2. **Local infra** — From repo root:
   ```bash
   cd server && sudo docker compose -f docker-compose.local.yml up -d dynamodb-local localstack
   ./scripts/local-setup.sh
   ```

3. **NestJS microservices (host, not compose)** — Docker Compose can build identity/academics images, but host `npm run dev:*` is faster for iteration. Use **two terminals** (or tmux panes); do not chain both dev servers in one shell.

   **Identity** (port 3010):
   ```bash
   export AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_DEFAULT_REGION=us-east-1
   export DYNAMODB_ENDPOINT=http://localhost:8000 TABLE_NAME=edforge-identity-local
   export EVENT_BUS_NAME=edforge-local-bus EVENTBRIDGE_ENDPOINT=http://localhost:4566
   export COGNITO_USER_POOL_ID=local-user-pool COGNITO_CLIENT_ID=local-client-id COGNITO_REGION=us-east-1
   export SKIP_ABAC=true PDF_ASSETS_BUCKET=edforge-pdf-assets-local PORT=3010 NODE_ENV=development
   npm run dev:identity
   ```

   **Academics** (port 3011):
   ```bash
   export AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_DEFAULT_REGION=us-east-1
   export DYNAMODB_ENDPOINT=http://localhost:8000 TABLE_NAME=edforge-academics-local
   export EVENT_BUS_NAME=edforge-local-bus EVENTBRIDGE_ENDPOINT=http://localhost:4566
   export IDENTITY_SERVICE_URL=http://localhost:3010
   export COGNITO_USER_POOL_ID=local-user-pool COGNITO_CLIENT_ID=local-client-id COGNITO_REGION=us-east-1
   export SKIP_ABAC=true PORT=3011 NODE_ENV=development
   npm run dev:academics
   ```

   `PDF_ASSETS_BUCKET` is required for identity startup (see `s3-presigner.service.ts`); any placeholder bucket name is fine locally.

### Validation commands

| Check | Command | Notes |
|-------|---------|--------|
| Route drift | `npm run lint:routes` | No ESLint config in `server/application` for `npm run lint` |
| Typecheck | `npm run typecheck` | May fail on Node 22 (`@types/node` / Buffer); repo targets Node ≥ 18 |
| Unit tests | `cd server/application && npm run test` | Requires local `jest.setup.js` (gitignored — see below) |
| Build services | `npm run build:identity` / `npm run build:academics` | After `npm run build:shared-types` if shared-types changed |

### Jest `jest.setup.js`

`server/.gitignore` ignores `*.js` under `server/`, so `server/application/jest.setup.js` is **not committed**. Create it locally before `npm test` (Cognito mocks for auth specs). A minimal file is enough for most suites; auth-heavy specs need `global.__mocks__.cognito`.

### Seeded local test data

After `scripts/local-setup.sh`: tenant `test-tenant-001`, school `school-001` ("Test Elementary School"). Health: `curl http://localhost:3010/health` and `http://localhost:3011/health`. Business routes require Cognito JWTs; JWT validation uses real Cognito JWKS URLs unless you align LocalStack Cognito with `AuthConfig`.

### AWS / CDK

Full AWS deploy (`scripts/install.sh`, CDK) needs credentials and is out of scope for default Cloud Agent setup. See `CLAUDE.md` for UAT/prod deploy rules.

### AdminWeb

`cd client/AdminWeb && npm start` (not `npm run dev`). Needs Cognito env vars and a control-plane API URL — see `client/AdminWeb/.env.example`.

### `edforge-saas-frontend`

Tenant UI is a **separate git repo** (not in this workspace clone). Vercel deploy; not required for backend local API work.
