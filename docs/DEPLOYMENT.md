# Smart Attendance System — Production Deployment Guide

This guide details the containerized deployment architecture, orchestration workflow, security controls, and operational runbooks for the Smart Attendance System.

---

## 1. System Architecture & Topology

The production container deployment organizes the services into two isolated network tiers:

```
                    Internet / Corporate Network
                               │
                       [ Port 80 / 443 ]
                               ▼
               ┌───────────────────────────────┐
               │    gateway (Nginx Proxy)      │
               │    smart-attendance-gateway   │
               └───────────────┬───────────────┘
                               │
               ┌───────────────┴───────────────┐
               │                               │
         /api, /health, /ready               / (All other paths)
               │                               │
               ▼                               ▼
       ┌────────────────┐             ┌────────────────┐
       │     server     │             │     admin      │
       │  Hono Node.js  │             │   React SPA    │
       │  (Port 3000)   │             │  (Nginx :80)   │
       └───────┬────────┘             └────────────────┘
               │ (internal network)
               ▼
       ┌────────────────┐
       │   PostgreSQL   │
       │ (Port 5432)    │
       └────────────────┘
```

### Network Isolation
1. **`smart-attendance-internal` (internal: true):**
   - Contains only the `db` (PostgreSQL) and `server` containers.
   - External traffic cannot reach the database directly; port 5432 is **not** published to the host.
2. **`smart-attendance-public`:**
   - Contains `gateway`, `server`, and `admin`.
   - The `gateway` acts as the single reverse proxy ingress point on ports 80 (HTTP) and 443 (HTTPS).

---

## 2. Environment Variables & Secret Configuration

Create a production environment file (e.g., `.env.production`) on the deployment host. **Never commit this file to version control.**

```bash
# Application Environment
NODE_ENV=production
PORT=3000

# Database Credentials
POSTGRES_DB=smart_attendance
POSTGRES_USER=app_postgres_user
POSTGRES_PASSWORD=<STRONG_RANDOM_PASSWORD>

# Backend JWT Secret (minimum 32 characters)
# Generate with: openssl rand -base64 32
JWT_SECRET=<STRONG_CRYPTOGRAPHIC_JWT_SECRET_32_CHARS>

# Explicit CORS Allowed Origins (Comma-separated, no wildcards)
CORS_ORIGIN=https://admin.smartattendance.ac.in,https://attendance.smartattendance.ac.in

# Institutional Domain
COLLEGE_EMAIL_DOMAIN=sonatech.ac.in

# Timetable Early Session Start Window (minutes)
ATTENDANCE_START_EARLY_MINUTES=20

# Rate Limiting Controls
AUTH_RATE_LIMIT_MAX=10
AUTH_RATE_LIMIT_WINDOW_SECONDS=60

# Frontend Ingress Routing
# Empty string indicates relative routing via the gateway proxy (/api)
VITE_API_URL=

# Biometric Face Verification Engine (Milestone F5 & F6)
# Options: NOT_CONFIGURED (safe stub) | OPENCV_SFACE (real OpenCV/SFace engine)
FACE_MATCHING_PROVIDER=NOT_CONFIGURED
FACE_MATCH_THRESHOLD=0.40
FACE_MIN_CONFIDENCE=0.60
PYTHON_PATH=python3
```

---

## 3. Build & Deployment Commands

### Prerequisites
- Docker Engine 24.0+
- Docker Compose v2.20+
- Valid domain DNS records pointing to the deployment host

### A. Build Container Images Locally or in CI
```bash
# Build Server Image from monorepo root
docker build -t smart-attendance-server:latest -f apps/server/Dockerfile .

# Build Admin Web Image from monorepo root
docker build -t smart-attendance-admin:latest -f apps/admin/Dockerfile .
```

### B. Validate Compose Configuration
Verify all variables and interpolation rules before launching:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

### C. Run Database Migrations
Before starting web traffic, apply Drizzle database migrations using a one-off container run:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm server npm run db:migrate
```

### D. Start All Services
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

### E. Monitor Startup and Health
```bash
# Check status and health indicators
docker compose -f docker-compose.prod.yml ps

# Follow container logs
docker compose -f docker-compose.prod.yml logs -f server
```

---

## 4. Health & Readiness Endpoints

The server exposes dedicated probes designed for Docker, Kubernetes, and reverse proxies:

| Endpoint | Purpose | Scope / Success Condition | Error Response |
| :--- | :--- | :--- | :--- |
| **`GET /health`** | Liveness probe | Process event loop is responsive (`200 OK`) | Process down |
| **`GET /ready`** | Readiness probe | Process alive + database responsive via `SELECT 1` (`200 OK`) | `503 Service Unavailable` (`"Database connectivity check failed"`) |
| **`GET /`** | Service Info | API identifier and version string (`200 OK`) | Process down |

Neither endpoint leaks database connection strings, passwords, or schema names.

---

## 5. SSL / TLS Certificate Termination

The gateway Nginx reverse proxy supports automated Let's Encrypt TLS provisioning via Certbot:

### Initial Certificate Issuance
1. Launch HTTP-only gateway first:
   ```bash
   docker compose -f docker-compose.prod.yml up -d gateway
   ```
2. Request Let's Encrypt certificate:
   ```bash
   docker run -it --rm \
     -v smart-attendance-certbot-www:/var/www/certbot \
     -v smart-attendance-certbot-conf:/etc/letsencrypt \
     certbot/certbot certonly --webroot \
     --webroot-path=/var/www/certbot \
     -d admin.smartattendance.ac.in \
     --email admin@sonatech.ac.in --agree-tos --no-eff-email
   ```
3. Enable SSL server block in `docker/nginx/conf.d/default.conf` pointing to `/etc/letsencrypt/live/...`.
4. Reload Nginx:
   ```bash
   docker compose -f docker-compose.prod.yml exec gateway nginx -s reload
   ```

---

## 6. Backup & Disaster Recovery

> [!CRITICAL]
> **The Golden Rule of Backups:** Unverified backup files provide zero guarantee of recovery. **A backup is only proven when a test restore has been executed, inspected, and verified against operational health checks.** Scheduled drills must regularly restore backups into an isolated test environment to validate Recovery Time Objective (RTO) and Recovery Point Objective (RPO).

### 6.1 Backup Prerequisites & Architecture

1. **PostgreSQL Version Compatibility:** Target PostgreSQL 16 (matching the official `postgres:16-alpine` service image).
2. **Format Standard:** Always use PostgreSQL's custom archive format (`-Fc`). It provides built-in compression, supports parallel restoration (`-j`), and allows selective schema/table extraction.
3. **Credential Security:** Never pass database passwords inline in shell scripts. Use Docker container execution (`exec -T db`) or `.pgpass` files with `chmod 600` permissions.
4. **Storage Isolation:** Store backup archives on a dedicated, non-ephemeral volume or push them immediately to off-site cloud object storage (e.g., AWS S3, Google Cloud Storage) with versioning and immutable object locks enabled.

### 6.2 Hot Backup Procedure (`pg_dump`)

#### Containerized Deployment (Recommended)
Run `pg_dump` within the running database container:
```bash
BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/backups/smart_attendance_${BACKUP_TIMESTAMP}.dump"

# Stream compressed custom-format dump to host backup directory
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-smart_attendance}" -Fc --verbose > "${BACKUP_FILE}"

# Verify file was created and is non-empty
if [ -s "${BACKUP_FILE}" ]; then
  echo "Backup successfully created: ${BACKUP_FILE} ($(du -h ${BACKUP_FILE} | cut -f1))"
else
  echo "ERROR: Backup file is empty or was not created!" >&2
  exit 1
fi
```

#### Standalone Host Deployment
```bash
pg_dump -h 127.0.0.1 -p 5432 -U postgres -d smart_attendance -Fc --verbose -f "/backups/smart_attendance_$(date +%Y%m%d_%H%M%S).dump"
```

---

### 6.3 Restoration Runbook (`pg_restore`)

Restoration must follow a strict, phased runbook to avoid data corruption, orphaned connections, or partial writes.

#### Phase 1: Preparation & Traffic Quiescence
1. Stop the application server to prevent incoming writes or active connection locks during restore:
   ```bash
   docker compose -f docker-compose.prod.yml stop server
   ```
2. Verify active connections to `smart_attendance` have drained:
   ```bash
   docker compose -f docker-compose.prod.yml exec -T db \
     psql -U "${POSTGRES_USER:-postgres}" -d postgres -c \
     "SELECT count(*) FROM pg_stat_activity WHERE datname = 'smart_attendance' AND pid <> pg_backend_pid();"
   ```

#### Phase 2: Verification Restore (Dry-Run / Staging)
Before touching production data, verify the integrity of the backup archive by restoring into an isolated temporary database:
```bash
# 1. Create temporary verification database
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-postgres}" -d postgres -c "DROP DATABASE IF EXISTS smart_attendance_verify; CREATE DATABASE smart_attendance_verify;"

# 2. Restore dump into verification database
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U "${POSTGRES_USER:-postgres}" -d smart_attendance_verify --verbose --clean --if-exists < "${BACKUP_FILE}"

# 3. Quick integrity spot-check
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-postgres}" -d smart_attendance_verify -c \
  "SELECT 'departments' as tbl, count(*) FROM departments UNION ALL SELECT 'staff', count(*) FROM staff UNION ALL SELECT 'students', count(*) FROM students UNION ALL SELECT 'attendance_records', count(*) FROM attendance_records;"

# 4. Cleanup verification database
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-postgres}" -d postgres -c "DROP DATABASE smart_attendance_verify;"
```

#### Phase 3: Production Database Restoration
Once verified, perform the restore on the target database:
```bash
# Terminate any remaining lingering client connections
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-postgres}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'smart_attendance' AND pid <> pg_backend_pid();"

# Restore database using --clean and --if-exists flags
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-smart_attendance}" --verbose --clean --if-exists < "${BACKUP_FILE}"
```

---

### 6.4 Post-Restore Operational Verification

After restoration completes, execute the following verification steps before reopening traffic:

1. **Verify Migration Alignment:**
   Ensure the restored database's schema and migration records match codebase expectations:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm server npm run db:check-migrations
   ```
   *Expected Output:* `DATABASE SCHEMA IS FULLY UP TO DATE.` (all 20 migrations verified: 0000_lovely_wilson_fisk through 0019_attendance_fallback_requests).

2. **Verify Production Presets:**
   Confirm system settings, baseline roles, and standard periods are present and intact:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm server npm run db:seed-presets
   ```
   *Expected Output:* `SUCCESS: All production presets ensured.`

3. **Restart Application Services:**
   ```bash
   docker compose -f docker-compose.prod.yml start server
   ```

4. **Verify Health and Readiness Probes:**
   ```bash
   # Liveness check (Hono process active)
   curl -f http://127.0.0.1:3000/health
   # Readiness check (PostgreSQL pool connected & responding)
   curl -f http://127.0.0.1:3000/ready
   ```
   Both checks must return `200 OK` with `{"status":"ok"}`.

---

## 7. Zero-Downtime Updates & Rollbacks

### Rolling Update
1. Build new container image with updated version tag (e.g. `smart-attendance-server:v1.1.0`).
2. Run database migration:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm server npm run db:migrate
   ```
3. Re-deploy container without downtime:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --no-deps --build server
   ```
4. Healthcheck monitors `/ready` until new container is healthy before routing live requests.

### Rollback Strategy
If an issue occurs in production:
```bash
# Revert to previous image tag
sed -i 's/v1.1.0/v1.0.0/g' docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d --no-deps server
```

---

## 8. Mobile Application Build & Distribution

The student and professor mobile applications are developed using Expo React Native. In production, standalone APK packages or app bundles must be built with explicit production configuration.

### 8.1 API Client URL Configuration
In production builds, the mobile apps **strictly require** the `EXPO_PUBLIC_API_URL` environment variable. Silent fallback to `http://localhost:3000` is blocked by client guardrails, preventing connection refused errors on physical handsets.

Configure `apps/student/.env` and `apps/professor/.env`:
```bash
EXPO_PUBLIC_API_URL=https://api.attendance.sonatech.ac.in
EXPO_PUBLIC_DEV_LOGIN_MODE=false
```

> [!CAUTION]
> Variables prefixed with `EXPO_PUBLIC_` are embedded directly in compiled application binaries. Never include passwords, secrets, or internal server tokens in mobile environment templates.

### 8.2 Native Android Permissions
The student application declares hardware features and runtime permissions in `apps/student/android/app/src/main/AndroidManifest.xml`:
- `android.permission.CAMERA`
- `android.hardware.camera` (required: false)
- `android.hardware.camera.front` (required: false)
- `android.permission.BLUETOOTH_ADVERTISE`
- `android.permission.BLUETOOTH_CONNECT`

The `expo-camera` configuration is registered in `apps/student/app.json`.

### 8.3 Building Android APKs
```bash
# Debug APK (for internal QA device testing):
cd apps/student
npm run build:android-debug
# Generated APK: apps/student/android/app/build/outputs/apk/debug/app-debug.apk

# Production Release APK:
npm run build:android-release
# Generated APK: apps/student/android/app/build/outputs/apk/release/app-release.apk
```

---

## 9. Known Operational Limitations & Validation Status

1. **Docker Runtime Execution (Blocked by Daemon):**
   - Docker CLI 29.7.2 and Compose v5.4.0 are installed, and compose syntax is fully verified offline (`docker-compose -f docker-compose.prod.yml config`).
   - Container startup (`docker-compose up`) requires starting the Docker Desktop daemon on the host machine.
2. **Physical Device BLE & Camera Testing (Blocked by Hardware Availability):**
   - 0 physical Android devices are currently connected via ADB (`adb devices` is empty).
   - All 27 automated end-to-end acceptance scenarios passed in software emulation.
   - Physical on-device testing will run once test phones are connected.
3. **In-Memory Rate Limiting:**
   - The default rate limiter maintains IP counters in Node.js process memory.
   - In single-container deployments, this provides robust protection.
   - If horizontally scaled across multiple server replicas, replace `MemoryRateLimitStore` with a shared Redis store using `setRateLimitStore()` to coordinate limits globally.
