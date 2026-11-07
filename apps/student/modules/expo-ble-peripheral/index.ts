import ExpoBlePeripheralModule from './src/ExpoBlePeripheralModule';
export * from './src/ExpoBlePeripheral.types';

export function isAdvertisingSupported(): boolean {
  return ExpoBlePeripheralModule?.isAdvertisingSupported() ?? false;
}

export function isBluetoothEnabled(): boolean {
  return ExpoBlePeripheralModule?.isBluetoothEnabled() ?? false;
}

export function isAdvertising(): boolean {
  return ExpoBlePeripheralModule?.isAdvertising() ?? false;
}

export async function startAdvertising(serviceUuid: string): Promise<boolean> {
  if (!ExpoBlePeripheralModule) {
    throw new Error('ERR_NATIVE_MODULE_UNAVAILABLE: ExpoBlePeripheral is not available on this platform.');
  }
  return await ExpoBlePeripheralModule.startAdvertising(serviceUuid);
}

export async function stopAdvertising(): Promise<boolean> {
  if (!ExpoBlePeripheralModule) {
    return true;
  }
  return await ExpoBlePeripheralModule.stopAdvertising();
}
