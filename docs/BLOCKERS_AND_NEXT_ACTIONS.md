# Smart Attendance System — Prioritized Blockers & Action Runbook

**Monorepo:** `D:\smart-attendance\smart-attendance`  
**Date:** 2026-11-05  
**Version:** 1.0.0-rc  

This document details all external and operational prerequisites required to transition the Smart Attendance System from **Conditional Acceptance (Software Complete)** to **Live Campus Production**.

---

## 1. Prioritized Blocker Register

```
┌────────────────────────────────────────────────────────────────────────┐
│                      REMAINING BLOCKERS BY PRIORITY                    │
├────┬─────────────────────────────┬──────────┬──────────────────────────┤
│ #  │ Blocker Title               │ Severity │ External Dependency      │
├────┼─────────────────────────────┼──────────┼──────────────────────────┤
│ 01 │ Docker Desktop Daemon Start │ HIGH     │ Windows Host Admin       │
│ 02 │ Physical Android Hardware   │ MEDIUM   │ QA Hardware Access       │
│ 03 │ Institutional DNS / TLS     │ MEDIUM   │ Campus Network Admin     │
└────┴─────────────────────────────┴──────────┴──────────────────────────┘
```

---

### Blocker 01: Docker Desktop Daemon Inability to Run Linux Containers

- **Current Status**: **BLOCKED (HOST ENVIRONMENT)**
- **Observed Symptoms**:
  - `docker version` and `docker info` fail with:
    ```
    failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine:
    open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
    ```
  - Executing `Start-Process "Docker Desktop.exe"` starts background processes (`com.docker.backend.exe`, `Docker Desktop.exe`), but they exit shortly thereafter.
- **Root Cause Analysis**:
  - In `com.docker.backend.exe.log`:
    ```json
    {"docker":"starting","dockerAPI":"starting","hasNoVirtualization":true,"idle":"running","mode":"linux","state":"starting"}
    ```
  - Running `wsl -l -v` reveals:
    ```
    The Windows Subsystem for Linux is not installed. You can install by running 'wsl.exe --install'.
    ```
  - Docker Desktop on Windows requires either WSL 2 or Hyper-V to run Linux containers. Because WSL 2 is not installed on this host, Docker Desktop cannot instantiate the Linux VM engine.
- **Remediation Steps**:
  1. Open PowerShell **as Administrator** on the Windows host.
  2. Execute:
     ```powershell
     wsl.exe --install --no-distribution
     ```
  3. Reboot the host machine to complete Windows hypervisor feature activation.
  4. Launch Docker Desktop from the Windows Start menu.
  5. Verify engine readiness:
     ```powershell
     docker info
     ```
  6. Launch the production container stack:
     ```bash
     cd D:\smart-attendance\smart-attendance
     docker-compose -f docker-compose.prod.yml --env-file .env.production.example up -d
     ```

---

### Blocker 02: Physical Android BLE and Optical Camera Acceptance

- **Current Status**: **BLOCKED (HARDWARE AVAILABILITY)**
- **Observed Symptoms**:
  - Running `adb devices` returns an empty list (`List of devices attached`).
  - 0 physical phones are connected via USB or ADB over Wi-Fi.
- **Root Cause Analysis**:
  - The software pipeline has passed 27/27 automated acceptance tests (`test/e2e-f8-device-acceptance-scenarios.test.ts`), including simulated BLE tokens, dual-frame active liveness analysis, and identity matching.
  - However, physical radio emissions (Bluetooth LE signal attenuation across 1m, 3m, 5m, 10m in a concrete classroom) and optical camera autofocus/exposure under varied indoor lighting cannot be validated on emulators or mocked tests.
- **Remediation Steps**:
  1. Procure at least two Android devices (1 for student app, 1 for professor app).
  2. Enable **Developer Options** and **USB Debugging** on both devices.
  3. Connect devices and confirm in terminal:
     ```powershell
     adb devices
     ```
  4. Build the debug APK:
     ```powershell
     cd D:\smart-attendance\smart-attendance\apps\student
     npm run build:android-debug
     ```
  5. Install and execute the 15-test manual matrix defined in Section 2 of [`milestone-f8-physical-device-acceptance-deployment-verification.md`](file:///D:/smart-attendance/smart-attendance/docs/milestones/milestone-f8-physical-device-acceptance-deployment-verification.md).

---

### Blocker 03: Campus DNS Delegation & Automated TLS Provisioning

- **Current Status**: **BLOCKED (NETWORK INFRASTRUCTURE)**
- **Observed Symptoms**:
  - `Resolve-DnsName attendance.sonatech.ac.in` fails to resolve.
- **Root Cause Analysis**:
  - The production Nginx reverse proxy configuration (`default-ssl.conf.template`) is pre-configured for Let's Encrypt automated TLS via Certbot HTTP-01 challenge.
  - Let's Encrypt validation servers require a publicly resolvable domain resolving to the host's public IP address on port 80.
- **Remediation Steps**:
  1. Contact the campus IT network administrator to create DNS A-records:
     - `attendance.sonatech.ac.in` ➔ Host Public IP
     - `api.attendance.sonatech.ac.in` ➔ Host Public IP
  2. Ensure external inbound firewall rules permit TCP traffic on ports 80 (HTTP) and 443 (HTTPS).
  3. Execute Certbot certificate issuance:
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
  4. Activate the SSL configuration:
     ```bash
     cp docker/nginx/conf.d/default-ssl.conf.template docker/nginx/conf.d/default.conf
     docker-compose -f docker-compose.prod.yml exec gateway nginx -s reload
     ```

---

## 2. Accepted Architectural Limitations

1. **Professor Application Live Roster Polling**:
   - The professor mobile app utilizes active HTTP polling (`refetchInterval: 3000ms`) against `GET /api/attendance/sessions/:id/live` rather than running a native background BLE scanner module on the professor's handset.
   - **Rationale**: Standalone BLE scanning on battery-powered mobile devices is prone to aggressive OS background process termination. Backend-coordinated detection ingestion provides consistent roster state across web and mobile dashboards.
2. **In-Memory Rate Limiting**:
   - Default authentication rate limiting maintains IP sliding windows in Node.js process memory.
   - **Recommendation for Future Scale**: When horizontally scaling beyond a single server replica, configure Redis backing for `MemoryRateLimitStore`.
