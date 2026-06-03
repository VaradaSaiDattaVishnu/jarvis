// PWA service-worker registration + Web Push subscription (#33).
import { getVapidKey, pushSubscribe } from './endpoints';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let registration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('/sw.js');
    // If the user already granted notifications, (re)subscribe silently so a fresh
    // device/endpoint is registered. We never prompt unsolicited here.
    if ('PushManager' in window && Notification.permission === 'granted') {
      await subscribeToPush();
    }
  } catch (e) {
    console.warn('Service worker registration failed:', e);
  }
}

// Call from a user gesture (e.g. a Settings toggle) to request permission + subscribe.
export async function subscribeToPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
    } else if (Notification.permission === 'denied') {
      return false;
    }

    const reg = registration || (await navigator.serviceWorker.ready);
    const { publicKey } = await getVapidKey();
    if (!publicKey) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    await pushSubscribe(sub);
    return true;
  } catch (e) {
    console.warn('Push subscription failed:', e);
    return false;
  }
}
