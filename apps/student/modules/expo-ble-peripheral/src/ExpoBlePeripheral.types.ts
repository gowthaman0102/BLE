export interface ExpoBlePeripheralNativeModule {
  isAdvertisingSupported(): boolean;
  isBluetoothEnabled(): boolean;
  isAdvertising(): boolean;
  startAdvertising(serviceUuid: string): Promise<boolean>;
  stopAdvertising(): Promise<boolean>;
}
