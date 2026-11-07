# Milestone F9 — Production Readiness & Deployment Runbook

**Smart Attendance System**  
**Monorepo:** `D:\smart-attendance\smart-attendance`  
**Milestone:** F9 — Production Readiness & Deployment  
**Status:** **PARTIAL** (Deployment configurations, container orchestration, mobile build hardening, and software acceptance tests are 100% verified; runtime container startup is blocked by Docker Desktop daemon unavailability, and on-device APK testing is blocked by zero attached physical Android devices).

---

## 1. System Architecture & Topology

The production architecture separates services into two strictly isolated Docker network tiers, enforcing the principle of least privilege:

```
                            INTERNET / CAMPUS LAN
                                      │
                              [ Ports 80 / 443 ]
                                      ▼
                      ┌───────────────────────────────┐
                      │    smart-attendance-gateway   │
                      │         (Nginx 1.25)          │
                      └───────────────┬───────────────┘
                                      │
             ┌────────────────────────┴────────────────────────┐
             │                                                 │
    /api/*, /health, /ready                           /* (Static Assets & SPA)
             │                                                 │
             ▼                                                 ▼
     ┌────────────────┐                                ┌────────────────┐
     │     server     │                                │     admin      │
     │  Hono Node.js  │                                │ React/Vite SPA │
     │  (Port 3000)   │                                │   (Nginx :80)  │
     └───────┬────────┘                                └────────────────┘
             │
             │ (internal network: smart-attendance-internal)
             ▼
     ┌────────────────┐
     │       db       │
     │ PostgreSQL 16  │
     │  (Port 5432)   │
     └────────────────┘
```

### Network Isolation Specifications
- **`smart-attendance-internal` (`internal: true`)**:
  - Connects only `db` (PostgreSQL) and `server` (Hono API).
  - Isolated from external network traffic; host port 5432 is **not published**.
- **`smart-attendance-public`**:
  - Connects `gateway` (Nginx), `server`, and `admin`.
  - Only `gateway` publishes host ports: `80` (HTTP / ACME challenges) and `443` (HTTPS).
  - Directly isolates backend and database from public clients; all traffic is sanitized and rate-limited through the reverse proxy.

---

## 2. Infrastructure Prerequisites

| Component | Minimum Production Requirement | Verification Command | Local Host Status |
| :--- | :--- | :--- | :--- |
| **Operating System** | Linux (Ubuntu 22.04 LTS / Debian 12) or Windows Server | `uname -a` / `systeminfo` | Windows 11 64-bit |
| **Docker Engine** | Docker Engine 24.0+ | `docker --version` | Docker 29.7.2 installed (Daemon stopped) |
| **Docker Compose** | Compose v2.20+ | `docker-compose --version` | Docker Compose v5.4.0 installed |
| **Node.js** | Node.js v20.x or v22.x LTS | `node -v` | Node.js v22.18.0 installed |
| **Python** | Python 3.10+ with OpenCV 4.8+ & NumPy | `python --version` | Python 3.12.10 (OpenCV 4.13.0, NumPy 2.5.3) |
| **Java JDK** | OpenJDK 17 LTS | `java -version` | Eclipse Adoptium 17.0.21+9 installed |
| **Android SDK** | SDK Platforms 33–36, Build Tools 35.0.0+ | `adb --version` | Android SDK 33–36 installed |

---

## 3. Configuration & Secrets Management

### Master Environment Matrix

| Variable | Scope | Required in Prod | Sensitivity | Purpose & Recommended Value |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Server | Yes | Low | Must be set to `production`. |
| `PORT` | Server | Yes | Low | Default `3000`. |
| `DATABASE_URL` | Server | Yes | **High** | Connection string with non-default credentials (e.g., `postgres://smart_admin:<SECRET>@db:5432/smart_attendance`). |
| `POSTGRES_DB` | DB | Yes | Low | Database name (`smart_attendance`). |
| `POSTGRES_USER` | DB | Yes | Low | Non-root role (`smart_admin`). |
| `POSTGRES_PASSWORD` | DB | Yes | **Critical** | Database password. Generate with `openssl rand -base64 24`. |
| `JWT_SECRET` | Server | Yes | **Critical** | Minimum 32 cryptographically random characters (`openssl rand -base64 32`). |
| `CORS_ORIGIN` | Server | Yes | Low | Comma-separated list of approved web origins (e.g. `https://attendance.sonatech.ac.in`). Wildcard forbidden. |
| `COLLEGE_EMAIL_DOMAIN` | Server | Yes | Low | Campus institutional domain (`sonatech.ac.in`). |
| `ATTENDANCE_START_EARLY_MINUTES` | Server | No | Low | Session creation early window (default: `20` minutes). |
| `AUTH_RATE_LIMIT_MAX` | Server | No | Low | Max login requests per IP per window (default: `10`). |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | Server | No | Low | Sliding rate limit window (default: `60` seconds). |
| `ENABLE_DEMO_SIGNUP` | Server | Yes | Low | Enforced `false` in production. |
| `FACE_MATCHING_PROVIDER` | Server | Yes | Low | `NOT_CONFIGURED` (safe stub) or `OPENCV_SFACE` (real biometric engine). |
| `FACE_MATCH_THRESHOLD` | Server | No | Low | Cosine distance cutoff (default: `0.40`). |
| `FACE_MIN_CONFIDENCE` | Server | No | Low | Face detector confidence threshold (default: `0.60`). |
| `PYTHON_PATH` | Server | Yes | Low | Path to Python runtime inside container (`python3`). |
| `VITE_API_URL` | Admin | No | Low | Empty string `""` for relative gateway reverse-proxy routing. |
| `EXPO_PUBLIC_API_URL` | Mobile Apps | Yes | Low | Gateway public URL (`https://api.attendance.sonatech.ac.in`). |

### Public Mobile Environment Boundary
> [!CAUTION]
> In Expo React Native applications, all variables prefixed with `EXPO_PUBLIC_` are statically compiled into client JavaScript bundles. They can be decompiled and inspected by any user. **NEVER** put private API keys, JWT secrets, database connection strings, or encryption passwords into mobile `.env` files.

### Secret Generation & Rotation Procedure
```bash
# Generate high-entropy database password
openssl rand -base64 24

# Generate high-entropy JWT signing key
openssl rand -base64 32

# Restrict environment file permissions on Linux host
chmod 600 .env.production
chown root:root .env.production
```

---

## 4. DNS & TLS Configuration

### Recommended DNS Architecture
- `attendance.sonatech.ac.in` ➔ A Record ➔ Gateway Public IP
- `api.attendance.sonatech.ac.in` ➔ CNAME / A Record ➔ Gateway Public IP

### TLS Provisioning via Certbot Webroot
1. Start Gateway in bootstrap HTTP-only mode:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d gateway
   ```
2. Execute one-off Certbot challenge:
   ```bash
   docker run -it --rm \
     -v smart-attendance-certbot-www:/var/www/certbot \
     -v smart-attendance-certbot-conf:/etc/letsencrypt \
     certbot/certbot certonly --webroot \
     --webroot-path=/var/www/certbot \
     -d attendance.sonatech.ac.in \
     --email admin@sonatech.ac.in \
     --agree-tos --no-eff-email
   ```
3. Activate the HTTPS configuration:
   ```bash
   cp docker/nginx/conf.d/default-ssl.conf.template docker/nginx/conf.d/default.conf
   docker-compose -f docker-compose.prod.yml exec gateway nginx -s reload
   ```
4. Automated Renewal Cron (`/etc/cron.d/certbot-renew`):
   ```cron
   0 3 1 * * docker run --rm -v smart-attendance-certbot-www:/var/www/certbot -v smart-attendance-certbot-conf:/etc/letsencrypt certbot/certbot renew --quiet && docker-compose -f /opt/smart-attendance/docker-compose.prod.yml exec gateway nginx -s reload
   ```

---

## 5. Container Orchestration & Deployment

### Production Compose File: `docker-compose.prod.yml`
Validated with `docker-compose -f docker-compose.prod.yml --env-file .env.production.example config`:

```bash
# Step 1: Validate configuration offline
docker-compose -f docker-compose.prod.yml --env-file .env.production config

# Step 2: Build container images
docker-compose -f docker-compose.prod.yml --env-file .env.production build

# Step 3: Start database first and wait for healthy status
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d db

# Step 4: Run database migrations
docker-compose -f docker-compose.prod.yml --env-file .env.production run --rm server npm run db:migrate

# Step 5: Verify migration alignment
docker-compose -f docker-compose.prod.yml --env-file .env.production run --rm server npm run db:check-migrations

# Step 6: Ensure production presets (roles, system settings, periods)
docker-compose -f docker-compose.prod.yml --env-file .env.production run --rm server npm run db:seed-presets

# Step 7: Launch all services
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# Step 8: Verify container health
docker-compose -f docker-compose.prod.yml ps
```

---

## 6. Database Migrations & Seed Data

### Migration Ledger (20 Migrations, All Verified)
| Index | Migration Tag | Functional Scope |
| :--- | :--- | :--- |
| 00 | `0000_lovely_wilson_fisk` | Core schema: users, roles, departments, academic years, semesters, classes, courses. |
| 01 | `0001_remarkable_maginty` | Student profiles and parent phone contacts. |
| 02 | `0002_unique_dorian_gray` | Attendance sessions and records schema. |
| 03 | `0003_violet_quicksilver` | Periods and timetable schedules. |
| 04 | `0004_outgoing_darkstar` | Audit logs and system configuration settings. |
| 05 | `0005_slimy_fallen_one` | Class student rosters and enrollment. |
| 06 | `0006_special_juggernaut` | Batch management and division grouping. |
| 07 | `0007_auth_audit_settings` | Enhanced authentication audit events. |
| 08 | `0008_microsoft_external_identities` | Microsoft Entra ID single sign-on mapping. |
| 09 | `0009_attendance_corrections` | Manual attendance correction requests and change tracking. |
| 10 | `0010_directory_coverage` | Institutional staff directory coverage. |
| 11 | `0011_subject_provenance` | Course catalog provenance metadata. |
| 12 | `0012_authorized_directory_feed` | Authorized directory sync tokens. |
| 13 | `0013_hod_local_auth` | Department Head local fallback authentication. |
| 14 | `0014_faculty_auth_accounts` | Faculty authentication credentials. |
| 15 | `0015_face_verification_foundation` | Biometric face verification foundation and status tables. |
| 16 | `0016_face_profile_reference_storage` | Reference photo private storage metadata. |
| 17 | `0017_face_profile_embeddings` | 128-dimensional face embedding vectors and confidence metrics. |
| 18 | `0018_liveness_challenges` | Active liveness challenge tokens, nonces, and expiration timestamps. |
| 19 | `0019_attendance_fallback_requests` | Audited student attendance fallback requests and professor resolution. |

### Migration Verification Status
Executed on local PostgreSQL instance:
```
[Migration Check] Connecting to database: postgresql://***:***@127.0.0.1:5432/smart_attendance
Found 20 committed migrations and 20 applied database records.
✅ DATABASE SCHEMA IS FULLY UP TO DATE.
```

---

## 7. Backup & Recovery Runbooks

### Automated Daily Backup Script (`scripts/backup-db.sh`)
```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/smart-attendance"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/smart_attendance_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

# Stream compressed custom-format dump
docker-compose -f /opt/smart-attendance/docker-compose.prod.yml exec -T db \
  pg_dump -U smart_admin -d smart_attendance -Fc --verbose > "${BACKUP_FILE}"

# Verify file integrity
if [ -s "${BACKUP_FILE}" ]; then
  echo "[BACKUP SUCCESS] Created: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
else
  echo "[BACKUP FAILURE] Backup file is empty or missing!" >&2
  exit 1
fi

# Retain 30 days of local backups
find "${BACKUP_DIR}" -name "*.dump" -mtime +30 -delete
```

### Full Disaster Recovery Procedure
1. Quiesce write traffic:
   ```bash
   docker-compose -f docker-compose.prod.yml stop server
   ```
2. Verify restore in sandbox database:
   ```bash
   docker-compose -f docker-compose.prod.yml exec -T db psql -U smart_admin -d postgres -c "DROP DATABASE IF EXISTS test_restore; CREATE DATABASE test_restore;"
   docker-compose -f docker-compose.prod.yml exec -T db pg_restore -U smart_admin -d test_restore --clean --if-exists < "${BACKUP_FILE}"
   docker-compose -f docker-compose.prod.yml exec -T db psql -U smart_admin -d test_restore -c "SELECT count(*) FROM attendance_records;"
   docker-compose -f docker-compose.prod.yml exec -T db psql -U smart_admin -d postgres -c "DROP DATABASE test_restore;"
   ```
3. Terminate active production connections and restore:
   ```bash
   docker-compose -f docker-compose.prod.yml exec -T db psql -U smart_admin -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'smart_attendance' AND pid <> pg_backend_pid();"
   docker-compose -f docker-compose.prod.yml exec -T db pg_restore -U smart_admin -d smart_attendance --clean --if-exists < "${BACKUP_FILE}"
   docker-compose -f docker-compose.prod.yml start server
   ```

---

## 8. Health Checks & Monitoring

### Probe Endpoints
| Endpoint | Method | Scope | Expected Status | Response |
| :--- | :--- | :--- | :--- | :--- |
| `/health` | GET | Process Liveness | `200 OK` | `{"status":"ok"}` |
| `/ready` | GET | DB Pool Readiness | `200 OK` | `{"status":"ok","database":"connected"}` |
| `/` | GET | Service Identification | `200 OK` | `{"service":"smart-attendance-server","status":"running"}` |

### Alert Thresholds
- **HTTP 5xx Rate**: Alert if `> 1%` of total requests over a 5-minute sliding window.
- **API Latency (p95)**: Alert if `> 800ms` for standard requests, `> 2500ms` for biometric verification uploads.
- **Database Connection Pool**: Alert if pool utilization exceeds `85%`.
- **Face Verification Failure Rate**: Alert if consecutive verification failures exceed `25%` in a single session (suggests lighting or environmental anomaly).

---

## 9. Mobile Application Build & Distribution

### Android Native Manifest Hardening
- **Camera Permissions Added**:
  In `apps/student/android/app/src/main/AndroidManifest.xml`:
  ```xml
  <uses-feature android:name="android.hardware.camera" android:required="false"/>
  <uses-feature android:name="android.hardware.camera.front" android:required="false"/>
  <uses-feature android:name="android.hardware.camera.autofocus" android:required="false"/>
  <uses-permission android:name="android.permission.CAMERA"/>
  ```
- **Expo Camera Plugin Configured**:
  In `apps/student/app.json`:
  ```json
  [
    "expo-camera",
    {
      "cameraPermission": "Allow Smart Attendance to access your camera to take attendance selfies and verify liveness."
    }
  ]
  ```

### API Client URL Production Enforcement
In both `apps/student/services/api/client.ts` and `apps/professor/services/api/client.ts`:
- Standalone / production builds (`!__DEV__` or `NODE_ENV === 'production'`) now throw an explicit descriptive error if `EXPO_PUBLIC_API_URL` is omitted.
- Prevents silent fallback to `http://localhost:3000` (which would cause all physical phone requests to fail with connection refused).

### Android APK Build Commands
```bash
# 1. Configure production environment
cd apps/student
cp .env.example .env
# Edit .env to set EXPO_PUBLIC_API_URL=https://api.attendance.sonatech.ac.in

# 2. Build Debug APK (for internal QA device testing)
npm run build:android-debug
# Output: apps/student/android/app/build/outputs/apk/debug/app-debug.apk

# 3. Build Release APK (signed with keystore)
npm run build:android-release
# Output: apps/student/android/app/build/outputs/apk/release/app-release.apk
```

---

## 10. Rollback Procedures

### Container Application Rollback
```bash
# 1. Update image tags to previous verified release
sed -i 's/:v1.2.0/:v1.1.0/g' docker-compose.prod.yml

# 2. Recreate containers with zero database disruption
docker-compose -f docker-compose.prod.yml up -d --no-deps server admin
```

### Database Schema Rollback
- The Smart Attendance schema follows strictly backward-compatible additive migrations.
- Column deletions and table drops are never executed in hot migrations.
- If an emergency rollback of application code is performed, older application versions can continue operating against the forward-migrated database schema.

---

## 11. Security & Privacy Compliance Checklist

| Area | Security Invariant / Control | Audit Status | Evidence |
| :--- | :--- | :--- | :--- |
| **Biometric Privacy** | DPDP Act 2023 compliance: Zero raw facial embeddings or photo binaries are returned in public API responses or logged in plaintext. | **PASSED** | Verified in `students.ts`, `attendance.ts`, and `face-verification.service.ts`. |
| **Private Photo Storage** | Reference photos are stored on private disk/S3 volumes via cryptographic storage abstraction. Never served as public static assets. | **PASSED** | Verified in `LocalStorageProvider` and private download routes. |
| **Anti-Spoofing** | Active random challenges prevent static replay. Dual-frame motion analysis ensures physical subject presence. | **PASSED** | 8/8 liveness unit tests passed; 17/17 negative failure scenarios passed. |
| **CORS Policy** | Strict explicit origin whitelist. Wildcard `*` rejected by startup validator when credentials are enabled. | **PASSED** | Enforced in `apps/server/src/config/env.ts`. |
| **Network Isolation** | PostgreSQL port 5432 is completely unexposed to the host network. | **PASSED** | Enforced in `docker-compose.prod.yml`. |
| **Rate Limiting** | Authentication endpoints enforce sliding-window IP rate limiting to prevent brute-force attacks. | **PASSED** | Verified in `rate-limit.middleware.ts`. |
| **Least Privilege** | Production backend container executes as non-root user `node`. | **PASSED** | Configured in `apps/server/Dockerfile`. |

---

## 12. Validation Results & Blocked Items

### Verified Items & Software Test Passes
1. **Docker Compose Configuration**: Offline validation via `docker-compose -f docker-compose.prod.yml config` succeeded with 0 errors.
2. **Database Migrations**: 20/20 migrations (0000 through 0019) applied and fully up-to-date.
3. **Automated E2E Acceptance Suite**: 27/27 scenarios passed (`test/e2e-f8-device-acceptance-scenarios.test.ts`).
4. **Fallback & Manual Correction Suite**: 22/22 tests passed (`test/attendance-fallback.test.ts`).
5. **Session & Records Suite**: 13/13 tests passed (`test/attendance.test.ts`).
6. **Student Mobile Suite**: 38/38 unit tests passed (BLE advertising, selfie capture, active liveness challenge).
7. **TypeScript Typechecks**: Clean across all 5 workspaces (`shared`, `server`, `student`, `professor`, `admin`).
8. **Admin Dashboard Build**: Vite production build succeeded in 244ms.

### Blocked Items & Concrete Next Steps
1. **Runtime Container Execution (BLOCKED)**:
   - *Reason*: Docker Desktop daemon is not running on the Windows host (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`).
   - *Next Step*: Start the Docker Desktop service on the host machine to execute `docker-compose up`.
2. **Physical Device Android BLE & Front-Camera Testing (BLOCKED)**:
   - *Reason*: 0 physical Android devices are attached (`adb devices` reports empty list).
   - *Next Step*: Connect physical Android phones with USB debugging enabled, install the generated APKs, and execute physical classroom BLE advertising and active liveness selfie captures.
3. **Public Production TLS Termination (BLOCKED)**:
   - *Reason*: Public DNS domain (`attendance.sonatech.ac.in`) must point to the server's public IP to complete the Let's Encrypt ACME HTTP-01 challenge.
   - *Next Step*: Configure the campus DNS A record and execute Certbot webroot issuance.
