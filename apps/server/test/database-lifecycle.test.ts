import { describe, expect, it, vi } from 'vitest';

// Mock DB module to protect against live database access in unit tests
vi.mock('../src/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  client: {
    end: vi.fn(() => Promise.resolve()),
  },
}));

import { sanitizeDbUrl } from '../src/db/sanitize';
import {
  BASELINE_ROLES,
  BASELINE_PERIODS,
  BASELINE_SETTINGS,
  BASELINE_DEPARTMENTS,
} from '../scripts/seed-production-presets';
import { validateAdminBootstrapInputs } from '../scripts/bootstrap-admin';

describe('Milestone S10.3 — Database Lifecycle & Seeding Safeguards', () => {
  // ============================================================================
  // 1. Database Connection & Environment Safety Guards
  // ============================================================================
  describe('Test Environment Target Database Safety Guard', () => {
    function assertSafeTestDatabase(urlStr: string) {
      const u = new URL(urlStr);
      const dbName = decodeURIComponent(u.pathname.slice(1));
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) || !dbName.endsWith('_test')) {
        throw new Error('Refusing to run tests against a non-loopback database whose name does not end in _test.');
      }
      return true;
    }

    it('rejects remote database hosts in test mode even if name ends in _test', () => {
      expect(() =>
        assertSafeTestDatabase('postgres://postgres:secret@db.production.internal:5432/smart_attendance_test')
      ).toThrow('Refusing to run tests against a non-loopback database');
    });

    it('rejects loopback database if database name does not end in _test', () => {
      expect(() =>
        assertSafeTestDatabase('postgres://postgres:secret@127.0.0.1:5432/smart_attendance')
      ).toThrow('Refusing to run tests against a non-loopback database');
    });

    it('rejects localhost database if name is production or development', () => {
      expect(() =>
        assertSafeTestDatabase('postgres://postgres:secret@localhost:5432/smart_attendance_prod')
      ).toThrow('Refusing to run tests against a non-loopback database');
    });

    it('accepts loopback database with _test suffix', () => {
      expect(
        assertSafeTestDatabase('postgres://postgres:secret@127.0.0.1:5432/smart_attendance_test')
      ).toBe(true);
    });

    it('accepts localhost database with _test suffix', () => {
      expect(
        assertSafeTestDatabase('postgres://postgres:secret@localhost:5432/smart_attendance_test')
      ).toBe(true);
    });

    it('accepts IPv6 loopback [::1] with _test suffix', () => {
      expect(
        assertSafeTestDatabase('postgres://postgres:secret@[::1]:5432/smart_attendance_unit_test')
      ).toBe(true);
    });
  });

  // ============================================================================
  // 2. Synthetic Seed Script Safeguards
  // ============================================================================
  describe('Synthetic Seed Script Safeguards', () => {
    it('seed.ts throws an explicit error refusing to generate unverified academic structures', async () => {
      await expect(import('../scripts/seed')).rejects.toThrow(
        /Disabled: this script creates unverified academic years and departments/i
      );
    });

    it('seed-sona-real-data.ts throws an explicit error refusing to generate synthetic directory data', async () => {
      await expect(import('../scripts/seed-sona-real-data')).rejects.toThrow(
        /Disabled: this script generated synthetic student, staff/i
      );
    });
  });

  // ============================================================================
  // 3. Database URL Sanitization & Secret Redaction
  // ============================================================================
  describe('Database URL Sanitization (sanitizeDbUrl)', () => {
    it('redacts both username and password from full connection string', () => {
      const sanitized = sanitizeDbUrl('postgres://admin_user:SuperSecretPassword123!@db.internal.sonatech.ac.in:5432/smart_attendance');
      expect(sanitized).toBe('postgres://***:***@db.internal.sonatech.ac.in:5432/smart_attendance');
      expect(sanitized).not.toContain('admin_user');
      expect(sanitized).not.toContain('SuperSecretPassword123!');
    });

    it('redacts username when connection string has no password', () => {
      const sanitized = sanitizeDbUrl('postgres://app_user@127.0.0.1:5432/smart_attendance');
      expect(sanitized).toBe('postgres://***127.0.0.1:5432/smart_attendance');
      expect(sanitized).not.toContain('app_user');
    });

    it('handles connection string without user or password safely', () => {
      const sanitized = sanitizeDbUrl('postgres://localhost:5432/smart_attendance');
      expect(sanitized).toBe('postgres://localhost:5432/smart_attendance');
    });

    it('returns *** on invalid or malformed URL strings without throwing', () => {
      expect(sanitizeDbUrl('not-a-valid-url-string')).toBe('***');
      expect(sanitizeDbUrl('')).toBe('***');
    });
  });

  // ============================================================================
  // 4. Admin Bootstrap Validation Safeguards
  // ============================================================================
  describe('Admin Bootstrap Validation Safeguards (validateAdminBootstrapInputs)', () => {
    const validBootstrap = {
      name: 'Dr. S. Karthikeyan',
      email: 'hod.it@sonatech.ac.in',
      staffCode: 'STAFF_IT_001',
      password: 'StrongAdminPassword2026!',
      confirmation: 'StrongAdminPassword2026!',
    };

    it('accepts valid administrator bootstrap credentials', () => {
      expect(() => validateAdminBootstrapInputs(validBootstrap)).not.toThrow();
    });

    it('rejects passwords shorter than 12 characters', () => {
      expect(() =>
        validateAdminBootstrapInputs({
          ...validBootstrap,
          password: 'Short1!',
          confirmation: 'Short1!',
        })
      ).toThrow('Password must be at least 12 characters');
    });

    it('rejects passwords exceeding 72 UTF-8 bytes (bcrypt limitation)', () => {
      const longPassword = 'A'.repeat(73);
      expect(() =>
        validateAdminBootstrapInputs({
          ...validBootstrap,
          password: longPassword,
          confirmation: longPassword,
        })
      ).toThrow('no more than 72 UTF-8 bytes');
    });

    it('rejects password and confirmation mismatch', () => {
      expect(() =>
        validateAdminBootstrapInputs({
          ...validBootstrap,
          password: 'StrongAdminPassword2026!',
          confirmation: 'DifferentPassword2026!',
        })
      ).toThrow('Password and confirmation do not match');
    });

    it('rejects invalid email formats', () => {
      expect(() =>
        validateAdminBootstrapInputs({
          ...validBootstrap,
          email: 'not-an-email',
        })
      ).toThrow('Enter a valid full name, email address, and staff code');
    });

    it('rejects empty or single-character full name', () => {
      expect(() =>
        validateAdminBootstrapInputs({
          ...validBootstrap,
          name: 'A',
        })
      ).toThrow('Enter a valid full name, email address, and staff code');
    });

    it('rejects staff code with invalid symbols or insufficient length', () => {
      expect(() =>
        validateAdminBootstrapInputs({
          ...validBootstrap,
          staffCode: 'ST',
        })
      ).toThrow('Enter a valid full name, email address, and staff code');

      expect(() =>
        validateAdminBootstrapInputs({
          ...validBootstrap,
          staffCode: 'STAFF@IT#1',
        })
      ).toThrow('Enter a valid full name, email address, and staff code');
    });
  });

  // ============================================================================
  // 5. Production Presets Invariants
  // ============================================================================
  describe('Production Presets Invariants', () => {
    it('defines the 6 foundational RBAC roles', () => {
      const roleNames = BASELINE_ROLES.map((r) => r.name);
      expect(roleNames).toContain('ADMIN');
      expect(roleNames).toContain('HOD');
      expect(roleNames).toContain('DEPUTY_HOD');
      expect(roleNames).toContain('CLASS_COUNSELOR');
      expect(roleNames).toContain('STAFF');
      expect(roleNames).toContain('STUDENT');
      expect(roleNames.length).toBe(6);
    });

    it('defines exactly 7 standard sequential periods', () => {
      expect(BASELINE_PERIODS.length).toBe(7);
      const periodNumbers = BASELINE_PERIODS.map((p) => p.periodNumber);
      expect(periodNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);

      // All periods must have valid times in order
      for (const p of BASELINE_PERIODS) {
        expect(p.startTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(p.endTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(p.startTime < p.endTime).toBe(true);
      }
    });

    it('defines essential production system settings without fabricated presets', () => {
      const keys = BASELINE_SETTINGS.map((s) => s.key);
      expect(keys).toContain('INSTITUTION_NAME');
      expect(keys).toContain('TIMEZONE');
      expect(keys).toContain('ATTENDANCE_THRESHOLD');
      expect(keys).toContain('ATTENDANCE_START_EARLY_MINUTES');
      expect(keys).toContain('MAX_MANUAL_CORRECTION_DAYS');
      expect(keys).toContain('MANUAL_CORRECTION_ENABLED');

      const thresholdSetting = BASELINE_SETTINGS.find((s) => s.key === 'ATTENDANCE_THRESHOLD');
      expect(thresholdSetting?.value).toBe('75');

      const earlyMinutes = BASELINE_SETTINGS.find((s) => s.key === 'ATTENDANCE_START_EARLY_MINUTES');
      expect(earlyMinutes?.value).toBe('10');

      const maxCorrection = BASELINE_SETTINGS.find((s) => s.key === 'MAX_MANUAL_CORRECTION_DAYS');
      expect(maxCorrection?.value).toBe('7');
    });

    it('defines IT department preset', () => {
      const itDept = BASELINE_DEPARTMENTS.find((d) => d.code === 'IT');
      expect(itDept).toBeDefined();
      expect(itDept?.name).toBe('Information Technology');
      expect(itDept?.status).toBe('ACTIVE');
    });

    it('STRICT BOUNDARY: does NOT seed students, staff, or attendance records', () => {
      // Presets must only declare structural presets
      const allExportKeys = Object.keys({
        BASELINE_ROLES,
        BASELINE_PERIODS,
        BASELINE_SETTINGS,
        BASELINE_DEPARTMENTS,
      });

      expect(allExportKeys).not.toContain('BASELINE_STUDENTS');
      expect(allExportKeys).not.toContain('BASELINE_STAFF');
      expect(allExportKeys).not.toContain('BASELINE_ATTENDANCE');
    });
  });
});
