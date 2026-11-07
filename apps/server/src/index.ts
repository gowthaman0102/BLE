import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import "dotenv/config";

import { getConfig } from "./config/env";
import { client } from "./db";
import { securityHeadersMiddleware, hardenedCorsMiddleware } from "./middlewares/security.middleware";
import { authRateLimitMiddleware } from "./middlewares/rate-limit.middleware";
import { authRoutes } from "./routes/auth";
import { academicRoutes } from "./routes/academic";
import { studentRoutes } from "./routes/students";
import { staffRoutes } from "./routes/staff";
import { roleRoutes } from "./routes/roles";
import { counselorRoutes } from "./routes/class-counselors";
import { subjectRoutes } from "./routes/subjects";
import { classSubjectRoutes } from "./routes/class-subjects";
import { timetableRoutes } from "./routes/timetable";
import { periodRoutes } from "./routes/periods";
import { attendanceRoutes } from "./routes/attendance";
import { auditRoutes } from "./routes/audit";
import { settingsRoutes } from "./routes/settings";
import { dashboardRoutes } from "./routes/dashboard";
import { authenticate } from "./middlewares/auth.middleware";

// Initialize and validate configuration
const config = getConfig();

const app = new Hono();

// Global Middleware
app.use("*", logger());
app.use("*", securityHeadersMiddleware());
app.use("*", hardenedCorsMiddleware());

// Health check endpoints
app.get("/", (c) => {
  return c.json({
    message: "Smart Attendance API",
    status: "running",
    version: "0.1.0",
  });
});

// Liveness probe (process is running)
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe (process + database connectivity)
app.get("/ready", async (c) => {
  try {
    await client`SELECT 1`;
    return c.json({
      status: "ready",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return c.json(
      {
        status: "unready",
        database: "disconnected",
        error: "Database connectivity check failed.",
      },
      503
    );
  }
});

// Authentication Endpoint Rate Limiting (Sensitive Public Auth Routes)
app.use("/api/auth/login", authRateLimitMiddleware());
app.use("/api/auth/student/login", authRateLimitMiddleware());
app.use("/api/auth/staff-register", authRateLimitMiddleware());
app.use("/api/auth/signup", authRateLimitMiddleware());

// Global Auth Middleware
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  
  // Whitelist paths that don't need authentication
  const whitelist = [
    "/api/auth/login",
    "/api/auth/student/login",
    "/api/auth/signup-status",
    "/api/auth/signup",
    "/api/auth/staff-register",
  ];
  
  if (whitelist.includes(path) || path.startsWith("/api/students/me/")) {
    return next();
  }
  
  return authenticate(c, next);
});

// Mount routes
app.route("/api/auth", authRoutes);
app.route("/api", academicRoutes);
app.route("/api/students", studentRoutes);
app.route("/api/staff", staffRoutes);
app.route("/api/roles", roleRoutes);
app.route("/api/class-counselors", counselorRoutes);
app.route("/api/subjects", subjectRoutes);
app.route("/api/class-subjects", classSubjectRoutes);
app.route("/api/timetable", timetableRoutes);
app.route("/api/periods", periodRoutes);
app.route("/api/attendance", attendanceRoutes);
app.route("/api/audit", auditRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/dashboard", dashboardRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

const port = config.port;

let isShuttingDown = false;
async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  try {
    await client.end({ timeout: 5 });
    console.log("Database connection pool closed cleanly.");
  } catch (err) {
    console.error("Error closing database connections during shutdown:", err);
  }
  process.exit(0);
}

if (config.nodeEnv !== 'test') {
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: "0.0.0.0",
    },
    (info) => {
      console.log(`🚀 Smart Attendance API running on http://${info.address === '0.0.0.0' ? 'localhost' : info.address}:${info.port} (and LAN)`);
    }
  );
}

export default app;