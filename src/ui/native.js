// The thin layer between the game and the Android/iOS app shell (Capacitor). In a browser every call
// here falls back to web behaviour or does nothing, so the single-file web build keeps working.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch (e) {
    return false;
  }
}

// The Android back button. handler() runs on every press; the app never closes by itself.
export function onBackButton(handler) {
  if (!isNative()) return;
  App.addListener('backButton', () => handler()).catch(() => {});
}

// fn(active) runs when the app comes to the front (true) or goes to the background (false).
export function onAppState(fn) {
  if (!isNative()) return;
  App.addListener('appStateChange', (st) => fn(!!(st && st.isActive))).catch(() => {});
}

export function exitApp() {
  if (isNative()) App.exitApp().catch(() => {});
}

// kind: 'tick' (a step) | 'tap' (a small event) | 'success' (level solved)
export function haptic(kind) {
  try {
    if (isNative()) {
      if (kind === 'success') Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      else Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      return;
    }
    if (navigator.vibrate) navigator.vibrate(kind === 'success' ? [18, 60, 90] : kind === 'tap' ? 12 : 10);
  } catch (e) {
    // haptics are a nicety
  }
}
