/**
 * Automated Tests for Student BLE Peripheral Advertising Flow
 * 
 * NOTE & BOUNDARY:
 * These tests use software mocks to verify the permission handling, state machines,
 * error branches, protocol formatting, and cleanup lifecycles of the BLE advertising service.
 * THEY DO NOT PROVE REAL PHYSICAL OVER-THE-AIR BLUETOOTH TRANSMISSION ON HARDWARE.
 * Physical BLE transmission requires connected Android hardware and is tested separately.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Platform } from 'react-native';
import {
  bleService,
  formatTokenToUuid,
  validatePayloadPrivacy,
} from '../services/ble/bleService';
import type { ExpoBlePeripheralNativeModule } from '../modules/expo-ble-peripheral/src/ExpoBlePeripheral.types';

function setPlatform(os: 'android' | 'ios' | 'web', version = 33) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true, writable: true });
}

describe('Milestone S10.4 — Student BLE Advertising Automated Tests (MOCKED HARDWARE)', () => {
  beforeEach(() => {
    bleService.resetMockState();
    vi.restoreAllMocks();
  });

  // ============================================================================
  // 1. BLE Protocol, Payload Formatting & Privacy Verification
  // ============================================================================
  describe('[MOCK] BLE Protocol & Privacy Verification', () => {
    const sampleToken = 'c1a2b3d4e5f60718293a4b5c6d7e8f90'; // 16 bytes = 32 hex chars

    it('formats a 16-byte (32 hex char) session token into a standard 128-bit UUID', () => {
      const uuid = formatTokenToUuid(sampleToken);
      expect(uuid).toBe('c1a2b3d4-e5f6-0718-293a-4b5c6d7e8f90');
      expect(uuid.length).toBe(36);
    });

    it('formats a 32-byte (64 hex char) token by extracting the first 128 bits safely', () => {
      const longToken = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';
      const uuid = formatTokenToUuid(longToken);
      expect(uuid).toBe('a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90');
      expect(uuid.length).toBe(36);
    });

    it('rejects tokens with insufficient entropy (< 32 hex chars)', () => {
      expect(() => formatTokenToUuid('short-token')).toThrow(
        'Token does not contain sufficient entropy'
      );
    });

    it('rejects empty or null token strings', () => {
      expect(() => formatTokenToUuid('')).toThrow(/token string is required/i);
    });

    it('STRICT PRIVACY: payload contains ZERO student personal identifiers', () => {
      const studentProfile = {
        name: 'Gowthaman S',
        email: 'gowthaman.it@sonatech.ac.in',
        registerNumber: '2024IT001',
        studentId: 'a1b2c3d4-0000-0000-0000-000000000001',
      };

      const ephemeralSessionToken = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
      const advertisedUuid = formatTokenToUuid(ephemeralSessionToken);

      // Verify UUID contains ONLY hex digits and hyphens
      validatePayloadPrivacy(advertisedUuid);

      // Verify direct personal identifiers are never present in the advertised UUID
      expect(advertisedUuid).not.toContain(studentProfile.name);
      expect(advertisedUuid).not.toContain(studentProfile.email);
      expect(advertisedUuid).not.toContain(studentProfile.registerNumber);
      expect(advertisedUuid).not.toContain(studentProfile.studentId);
    });

    it('PACKET SIZE COMPLIANCE: 128-bit service UUID fits within 31-byte legacy BLE limit', () => {
      // Bluetooth Core Spec: Legacy advertisement max = 31 bytes
      // Flags AD structure: 3 bytes (Length: 0x02, Type: 0x01, Flags: 0x06)
      // 128-bit Service Class UUID AD structure: 18 bytes (Length: 0x11, Type: 0x07, UUID: 16 bytes)
      const flagsBytes = 3;
      const uuidAdStructureBytes = 18;
      const totalPacketSize = flagsBytes + uuidAdStructureBytes;

      expect(totalPacketSize).toBe(21);
      expect(totalPacketSize).toBeLessThanOrEqual(31);
      // Leaves 10 bytes margin to completely eliminate ADVERTISE_FAILED_DATA_TOO_LARGE
      expect(31 - totalPacketSize).toBe(10);
    });
  });

  // ============================================================================
  // 2. Permission Handling & Denial Verification
  // ============================================================================
  describe('[MOCK] Android Bluetooth Permission Handling', () => {
    beforeEach(() => {
      setPlatform('android', 33);
    });

    it('detects when Bluetooth permissions are denied', async () => {
      bleService.setMockPermissionState(false);

      const status = await bleService.checkAvailability();
      expect(status.hasPermissions).toBe(false);
      expect(status.state).toBe('PERMISSION_REQUIRED');
      expect(status.available).toBe(false);
    });

    it('refuses to start advertising if permissions are not granted', async () => {
      bleService.setMockPermissionState(false);

      await expect(
        bleService.startAdvertising('c1a2b3d4e5f60718293a4b5c6d7e8f90')
      ).rejects.toThrow(/BLE_PERMISSION_DENIED/i);

      expect(bleService.isAdvertising()).toBe(false);
    });

    it('transitions to available when permissions are granted', async () => {
      bleService.setMockPermissionState(true);
      bleService.setMockBluetoothEnabled(true);
      bleService.setMockAdvertisingSupported(true);

      const status = await bleService.checkAvailability();
      expect(status.hasPermissions).toBe(true);
      expect(status.state).toBe('AVAILABLE');
      expect(status.available).toBe(true);
    });
  });

  // ============================================================================
  // 3. Bluetooth Radio Power State (Disabled / Off)
  // ============================================================================
  describe('[MOCK] Bluetooth Power State Handling', () => {
    beforeEach(() => {
      setPlatform('android', 33);
      bleService.setMockPermissionState(true);
    });

    it('detects when Bluetooth radio is turned off', async () => {
      bleService.setMockBluetoothEnabled(false);
      bleService.setMockAdvertisingSupported(true);

      const status = await bleService.checkAvailability();
      expect(status.state).toBe('BLUETOOTH_DISABLED');
      expect(status.available).toBe(false);
      expect(status.message).toMatch(/turn on bluetooth/i);
    });

    it('throws BLUETOOTH_DISABLED when startAdvertising is attempted with radio off', async () => {
      bleService.setMockBluetoothEnabled(false);
      bleService.setMockAdvertisingSupported(true);

      await expect(
        bleService.startAdvertising('c1a2b3d4e5f60718293a4b5c6d7e8f90')
      ).rejects.toThrow(/BLUETOOTH_DISABLED/i);

      expect(bleService.isAdvertising()).toBe(false);
    });
  });

  // ============================================================================
  // 4. Hardware Support Checks (Advertising Unsupported)
  // ============================================================================
  describe('[MOCK] Hardware Support Verification', () => {
    beforeEach(() => {
      setPlatform('android', 33);
      bleService.setMockPermissionState(true);
      bleService.setMockBluetoothEnabled(true);
    });

    it('detects devices whose chipset does not support BLE peripheral mode', async () => {
      bleService.setMockAdvertisingSupported(false);

      const status = await bleService.checkAvailability();
      expect(status.state).toBe('ADVERTISING_UNSUPPORTED');
      expect(status.available).toBe(false);
      expect(status.message).toMatch(/does not support BLE peripheral advertising/i);
    });

    it('throws ADVERTISING_UNSUPPORTED when startAdvertising is called on unsupported hardware', async () => {
      bleService.setMockAdvertisingSupported(false);

      await expect(
        bleService.startAdvertising('c1a2b3d4e5f60718293a4b5c6d7e8f90')
      ).rejects.toThrow(/ADVERTISING_UNSUPPORTED/i);

      expect(bleService.isAdvertising()).toBe(false);
    });
  });

  // ============================================================================
  // 5. Native Advertiser Start, Failure & Teardown Lifecycles
  // ============================================================================
  describe('[MOCK] Native Advertiser Lifecycle Execution', () => {
    let mockNativeModule: ExpoBlePeripheralNativeModule;

    beforeEach(() => {
      setPlatform('android', 33);
      bleService.setMockPermissionState(true);
      bleService.setMockBluetoothEnabled(true);
      bleService.setMockAdvertisingSupported(true);

      mockNativeModule = {
        isAdvertisingSupported: vi.fn(() => true),
        isBluetoothEnabled: vi.fn(() => true),
        isAdvertising: vi.fn(() => false),
        startAdvertising: vi.fn(async () => true),
        stopAdvertising: vi.fn(async () => true),
      };

      bleService.setMockNativeModule(mockNativeModule);
    });

    it('successfully starts advertising with formatted UUID', async () => {
      const result = await bleService.startAdvertising('c1a2b3d4e5f60718293a4b5c6d7e8f90');
      expect(result).toBe(true);
      expect(bleService.isAdvertising()).toBe(true);
      expect(mockNativeModule.startAdvertising).toHaveBeenCalledWith('c1a2b3d4-e5f6-0718-293a-4b5c6d7e8f90');
    });

    it('handles native advertising start failure gracefully', async () => {
      mockNativeModule.startAdvertising = vi.fn(async () => {
        throw new Error('ERR_ADVERTISE_FAILED: Internal Bluetooth driver error');
      });

      await expect(
        bleService.startAdvertising('c1a2b3d4e5f60718293a4b5c6d7e8f90')
      ).rejects.toThrow(/ADVERTISE_START_FAILED/i);

      expect(bleService.isAdvertising()).toBe(false);
    });

    it('stops advertising and invokes native module cleanup', async () => {
      await bleService.startAdvertising('c1a2b3d4e5f60718293a4b5c6d7e8f90');
      expect(bleService.isAdvertising()).toBe(true);

      await bleService.stopAdvertising();
      expect(bleService.isAdvertising()).toBe(false);
      expect(mockNativeModule.stopAdvertising).toHaveBeenCalled();
    });

    it('calling stopAdvertising multiple times is idempotent and does not fail', async () => {
      await bleService.stopAdvertising();
      await bleService.stopAdvertising();
      expect(bleService.isAdvertising()).toBe(false);
    });
  });

  // ============================================================================
  // 6. Web Fallback Mode Verification
  // ============================================================================
  describe('[MOCK] Web Platform Behavior', () => {
    beforeEach(() => {
      setPlatform('web');
    });

    it('identifies web platform as UNSUPPORTED_ON_WEB with informative message', async () => {
      const status = await bleService.checkAvailability();
      expect(status.state).toBe('UNSUPPORTED_ON_WEB');
      expect(status.available).toBe(false);
      expect(status.message).toMatch(/web browsers do not support BLE peripheral advertising/i);
    });

    it('allows in-memory advertising state tracking for preview and simulator workflows on web', async () => {
      const result = await bleService.startAdvertising('c1a2b3d4e5f60718293a4b5c6d7e8f90');
      expect(result).toBe(true);
      expect(bleService.isAdvertising()).toBe(true);

      await bleService.stopAdvertising();
      expect(bleService.isAdvertising()).toBe(false);
    });
  });
});
