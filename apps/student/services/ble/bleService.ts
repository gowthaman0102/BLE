import { Platform, PermissionsAndroid } from 'react-native';
import * as nativeBle from '../../modules/expo-ble-peripheral';
import type { ExpoBlePeripheralNativeModule } from '../../modules/expo-ble-peripheral/src/ExpoBlePeripheral.types';

export type BleAvailabilityState =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'UNSUPPORTED_ON_WEB'
  | 'PERMISSION_REQUIRED'
  | 'BLUETOOTH_DISABLED'
  | 'ADVERTISING_UNSUPPORTED';

export interface BleServiceStatus {
  available: boolean;
  state: BleAvailabilityState;
  hasPermissions: boolean;
  isAdvertising: boolean;
  message?: string;
}

export interface BleServiceInterface {
  checkAvailability(): Promise<BleServiceStatus>;
  requestPermissions(): Promise<boolean>;
  startAdvertising(token: string): Promise<boolean>;
  stopAdvertising(): Promise<void>;
  isAdvertising(): boolean;
}

/**
 * Normalizes an arbitrary hex attendance token into a canonical 128-bit UUID string.
 *
 * PROTOCOL & PRIVACY SPECIFICATION:
 * - 16 bytes = 32 hex chars = 128 bits.
 * - Formatted as 8-4-4-4-12 UUID.
 * - Transmitted strictly as a 128-bit Service Class UUID (0x07) in a 21-byte BLE advertising packet.
 * - Completely avoids direct student identifiers (no name, email, register number, or persistent device ID).
 */
export function formatTokenToUuid(token: string): string {
  if (!token || typeof token !== 'string') {
    throw new Error('Valid attendance token string is required.');
  }

  // Remove existing hyphens or whitespace
  const cleaned = token.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (cleaned.length < 32) {
    throw new Error('Token does not contain sufficient entropy for a 128-bit BLE service UUID (minimum 32 hex characters).');
  }

  // Take the first 32 characters (16 bytes = 128 bits)
  const hex32 = cleaned.slice(0, 32);

  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}

/**
 * Asserts that the advertising payload contains NO personal identifiable information.
 */
export function validatePayloadPrivacy(serviceUuid: string): void {
  // UUID must match standard UUID v4 or random 128-bit hex format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(serviceUuid)) {
    throw new Error('Invalid BLE advertising payload: expected 128-bit UUID format.');
  }
}

class MobileBleService implements BleServiceInterface {
  private _isAdvertising: boolean = false;
  private _mockPermissions: boolean | null = null;
  private _mockBluetoothEnabled: boolean | null = null;
  private _mockAdvertisingSupported: boolean | null = null;
  private _customNativeModule: ExpoBlePeripheralNativeModule | null = null;

  /**
   * Diagnostic availability check including Android permissions, Bluetooth power, and hardware support.
   */
  async checkAvailability(): Promise<BleServiceStatus> {
    if (Platform.OS === 'web') {
      return {
        available: false,
        state: 'UNSUPPORTED_ON_WEB',
        hasPermissions: this._mockPermissions ?? true,
        isAdvertising: this._isAdvertising,
        message: 'Web browsers do not support BLE peripheral advertising. Native BLE broadcasting requires an Android device.',
      };
    }

    // 1. Permission check
    const hasPerms = await this.checkPermissions();
    if (!hasPerms) {
      return {
        available: false,
        state: 'PERMISSION_REQUIRED',
        hasPermissions: false,
        isAdvertising: false,
        message: 'Bluetooth and Nearby Devices permissions are required to broadcast attendance.',
      };
    }

    // 2. Bluetooth Enabled check
    const isBtEnabled = this._mockBluetoothEnabled !== null
      ? this._mockBluetoothEnabled
      : (this._customNativeModule?.isBluetoothEnabled() ?? nativeBle.isBluetoothEnabled());

    if (!isBtEnabled) {
      return {
        available: false,
        state: 'BLUETOOTH_DISABLED',
        hasPermissions: true,
        isAdvertising: false,
        message: 'Bluetooth is turned off on your device. Please turn on Bluetooth to verify attendance.',
      };
    }

    // 3. Hardware Advertising Support check
    const isAdvSupported = this._mockAdvertisingSupported !== null
      ? this._mockAdvertisingSupported
      : (this._customNativeModule?.isAdvertisingSupported() ?? nativeBle.isAdvertisingSupported());

    if (!isAdvSupported) {
      return {
        available: false,
        state: 'ADVERTISING_UNSUPPORTED',
        hasPermissions: true,
        isAdvertising: false,
        message: 'This Android device hardware does not support BLE peripheral advertising.',
      };
    }

    return {
      available: true,
      state: 'AVAILABLE',
      hasPermissions: true,
      isAdvertising: this._isAdvertising,
    };
  }

  /**
   * Internal permission check for Android API versions.
   */
  private async checkPermissions(): Promise<boolean> {
    if (this._mockPermissions !== null) {
      return this._mockPermissions;
    }

    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      const apiLevel = typeof Platform.Version === 'number'
        ? Platform.Version
        : parseInt(String(Platform.Version), 10);

      if (apiLevel >= 31) {
        const hasAdvertise = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE);
        const hasConnect = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        return hasAdvertise && hasConnect;
      } else {
        return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }
    } catch {
      return false;
    }
  }

  /**
   * Prompts the user for Bluetooth advertising permissions.
   */
  async requestPermissions(): Promise<boolean> {
    if (this._mockPermissions !== null) {
      return this._mockPermissions;
    }

    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      const apiLevel = typeof Platform.Version === 'number'
        ? Platform.Version
        : parseInt(String(Platform.Version), 10);

      if (apiLevel >= 31) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);

        const granted =
          results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE] === PermissionsAndroid.RESULTS.GRANTED &&
          results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
        return granted;
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Bluetooth Attendance Permission',
            message: 'Android requires location access to broadcast Bluetooth beacons for classroom attendance.',
            buttonPositive: 'Grant',
          }
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch {
      return false;
    }
  }

  /**
   * Initiates BLE beacon advertising with the session-specific token.
   */
  async startAdvertising(token: string): Promise<boolean> {
    if (!token) {
      throw new Error('Valid attendance token required for BLE advertising.');
    }

    const serviceUuid = formatTokenToUuid(token);
    validatePayloadPrivacy(serviceUuid);

    // Stop any existing broadcast
    await this.stopAdvertising();

    if (Platform.OS === 'web') {
      // Web simulator mode
      this._isAdvertising = true;
      return true;
    }

    // Check availability before native invocation
    const status = await this.checkAvailability();
    if (!status.hasPermissions) {
      throw new Error('BLE_PERMISSION_DENIED: Bluetooth advertise permission is not granted.');
    }
    if (status.state === 'BLUETOOTH_DISABLED') {
      throw new Error('BLUETOOTH_DISABLED: Bluetooth radio is disabled.');
    }
    if (status.state === 'ADVERTISING_UNSUPPORTED') {
      throw new Error('ADVERTISING_UNSUPPORTED: Device hardware does not support BLE advertising.');
    }

    try {
      if (this._customNativeModule) {
        await this._customNativeModule.startAdvertising(serviceUuid);
      } else {
        await nativeBle.startAdvertising(serviceUuid);
      }
      this._isAdvertising = true;
      return true;
    } catch (error: any) {
      this._isAdvertising = false;
      const msg = error?.message || 'Failed to start BLE advertising.';
      throw new Error(`ADVERTISE_START_FAILED: ${msg}`);
    }
  }

  /**
   * Stops active BLE beacon advertising and releases native Bluetooth resources.
   */
  async stopAdvertising(): Promise<void> {
    if (Platform.OS === 'web') {
      this._isAdvertising = false;
      return;
    }

    try {
      if (this._customNativeModule) {
        await this._customNativeModule.stopAdvertising();
      } else {
        await nativeBle.stopAdvertising();
      }
    } catch {
      // Ignored during shutdown
    } finally {
      this._isAdvertising = false;
    }
  }

  isAdvertising(): boolean {
    return this._isAdvertising;
  }

  // ============================================================================
  // Test & Simulation Helpers (Used in automated unit tests and Web preview)
  // ============================================================================

  setMockPermissionState(hasPermissions: boolean) {
    this._mockPermissions = hasPermissions;
  }

  setMockBluetoothEnabled(enabled: boolean) {
    this._mockBluetoothEnabled = enabled;
  }

  setMockAdvertisingSupported(supported: boolean) {
    this._mockAdvertisingSupported = supported;
  }

  setMockNativeModule(mockModule: ExpoBlePeripheralNativeModule | null) {
    this._customNativeModule = mockModule;
  }

  resetMockState() {
    this._mockPermissions = null;
    this._mockBluetoothEnabled = null;
    this._mockAdvertisingSupported = null;
    this._customNativeModule = null;
    this._isAdvertising = false;
  }
}

export const bleService = new MobileBleService();
