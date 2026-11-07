import { requireNativeModule, Platform } from 'expo-modules-core';
import type { ExpoBlePeripheralNativeModule } from './ExpoBlePeripheral.types';

let nativeModule: ExpoBlePeripheralNativeModule | null = null;

if (Platform.OS === 'android') {
  try {
    nativeModule = requireNativeModule<ExpoBlePeripheralNativeModule>('ExpoBlePeripheral');
  } catch {
    // Native module not linked in current JS environment (e.g. web/test)
    nativeModule = null;
  }
}

export default nativeModule;
