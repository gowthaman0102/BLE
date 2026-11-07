package expo.modules.bleperipheral

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.ParcelUuid
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.util.UUID

class ExpoBlePeripheralModule : Module() {
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var isAdvertisingState = false

  override fun definition() = ModuleDefinition {
    Name("ExpoBlePeripheral")

    Function("isAdvertisingSupported") {
      val context = appContext.reactContext ?: return@Function false
      val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      val adapter = bluetoothManager?.adapter ?: return@Function false
      return@Function adapter.isEnabled && adapter.isMultipleAdvertisementSupported
    }

    Function("isBluetoothEnabled") {
      val context = appContext.reactContext ?: return@Function false
      val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      return@Function bluetoothManager?.adapter?.isEnabled ?: false
    }

    Function("isAdvertising") {
      return@Function isAdvertisingState
    }

    AsyncFunction("startAdvertising") { serviceUuidString: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_NO_CONTEXT", "React application context unavailable", null)
        return@AsyncFunction
      }

      val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      val adapter = bluetoothManager?.adapter
      if (adapter == null || !adapter.isEnabled) {
        promise.reject("ERR_BLUETOOTH_DISABLED", "Bluetooth is disabled or unavailable on this device", null)
        return@AsyncFunction
      }

      val leAdvertiser = adapter.bluetoothLeAdvertiser
      if (leAdvertiser == null || !adapter.isMultipleAdvertisementSupported) {
        promise.reject("ERR_ADVERTISING_UNSUPPORTED", "BLE peripheral advertising is not supported by this device hardware", null)
        return@AsyncFunction
      }

      val serviceUuid = try {
        UUID.fromString(serviceUuidString)
      } catch (e: Exception) {
        promise.reject("ERR_INVALID_UUID", "Provided service UUID is invalid: $serviceUuidString", e)
        return@AsyncFunction
      }

      // Stop previous advertisement if running
      if (isAdvertisingState && advertiseCallback != null) {
        try {
          advertiser?.stopAdvertising(advertiseCallback)
        } catch (_: Exception) {}
        isAdvertisingState = false
        advertiseCallback = null
      }

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .setConnectable(false)
        .setTimeout(0)
        .build()

      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false) // Privacy: Do not leak device name
        .setIncludeTxPowerLevel(false)
        .addServiceUuid(ParcelUuid(serviceUuid))
        .build()

      val callback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
          super.onStartSuccess(settingsInEffect)
          isAdvertisingState = true
          advertiser = leAdvertiser
          advertiseCallback = this
          promise.resolve(true)
        }

        override fun onStartFailure(errorCode: Int) {
          super.onStartFailure(errorCode)
          isAdvertisingState = false
          val errorMessage = when (errorCode) {
            ADVERTISE_FAILED_DATA_TOO_LARGE -> "Advertising data too large"
            ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Too many advertisers currently active"
            ADVERTISE_FAILED_ALREADY_STARTED -> "Advertising already started"
            ADVERTISE_FAILED_INTERNAL_ERROR -> "Internal Bluetooth driver error"
            ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "BLE advertising feature unsupported"
            else -> "Advertising start failed with error code $errorCode"
          }
          promise.reject("ERR_ADVERTISE_FAILED", errorMessage, null)
        }
      }

      try {
        leAdvertiser.startAdvertising(settings, data, callback)
      } catch (e: SecurityException) {
        promise.reject("ERR_PERMISSION_DENIED", "Bluetooth advertise permission denied by system: ${e.message}", e)
      } catch (e: Exception) {
        promise.reject("ERR_ADVERTISE_START", "Failed to start BLE advertising: ${e.message}", e)
      }
    }

    AsyncFunction("stopAdvertising") { promise: Promise ->
      if (!isAdvertisingState || advertiseCallback == null) {
        isAdvertisingState = false
        advertiseCallback = null
        promise.resolve(true)
        return@AsyncFunction
      }

      try {
        advertiser?.stopAdvertising(advertiseCallback)
      } catch (_: Exception) {}
      finally {
        isAdvertisingState = false
        advertiseCallback = null
        advertiser = null
        promise.resolve(true)
      }
    }
  }
}
