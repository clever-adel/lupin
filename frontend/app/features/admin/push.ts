import { useCallback, useEffect, useState } from "react";
import { api } from "~/lib/http";

/**
 * New-order push notifications for the browser this staff member is using (phone or computer).
 * They arrive even when the dashboard is closed. The server encrypts each one for this browser only
 * (store.lupinwear.notify.StaffPush); public/sw.js shows it.
 */

export type PushState =
  | "checking"
  | "unsupported" // this browser cannot do it
  | "install-first" // iPhone/iPad: works only from the Home Screen app
  | "blocked" // the person said no to notifications for this site
  | "off"
  | "on";

const SCOPE = "/admin/";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SCOPE);
  const reg = existing ?? await navigator.serviceWorker.register("/sw.js", { scope: SCOPE });
  if (reg.active) return reg;
  // Wait until it is ready to receive pushes.
  return await new Promise<ServiceWorkerRegistration>((resolve) => {
    const worker = reg.installing ?? reg.waiting;
    if (!worker) return resolve(reg);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve(reg);
    });
  });
}

export function usePushAlerts() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState(isAppleMobile() && !standalone() ? "install-first" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") return setState("blocked");
    try {
      const reg = await navigator.serviceWorker.getRegistration(SCOPE);
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return setState("off");
      // The server may have dropped it (another account, or the push service said it is gone).
      const { subscribed } = await api<{ subscribed: boolean }>("POST", "/api/v1/admin/push/subscriptions/status",
        { endpoint: sub.endpoint });
      setState(subscribed ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await registration();
      const { publicKey } = await api<{ publicKey: string }>("GET", "/api/v1/admin/push/key");
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with another key cannot receive ours.
      if (sub && sub.options.applicationServerKey) {
        const current = new Uint8Array(sub.options.applicationServerKey);
        const wanted = keyBytes(publicKey);
        if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const json = sub.toJSON();
      await api<void>("POST", "/api/v1/admin/push/subscriptions", {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
      setState("on");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not turn on notifications.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(SCOPE);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api<void>("POST", "/api/v1/admin/push/subscriptions/remove", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not turn off notifications.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setError(null);
    try {
      const { delivered } = await api<{ delivered: number }>("POST", "/api/v1/admin/push/test", {});
      if (delivered === 0) setError("The test was not delivered. Turn notifications off and on again.");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not send a test.");
    }
  };

  return { state, busy, error, enable, disable, test };
}
