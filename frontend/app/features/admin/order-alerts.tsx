import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Summary } from "./shared";

const STORAGE_KEY = "lupin.orderAlerts";

function readOn(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeOn(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* private window: the choice lasts until the page is closed */
  }
}

let audio: AudioContext | null = null;

/** Browsers only allow sound after a click on the page, so the context is made (or woken) from one. */
function unlockSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

/** A short two-note chime, made in the browser (no sound file to load). */
function chime() {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime;
  [880, 1320].forEach((frequency, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const t = start + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

/**
 * Rings when a new order arrives while the dashboard is open: a chime, a browser notification (when
 * allowed) and a banner. "New" means newer than the latest order this page has already seen, so
 * opening the dashboard never rings for old orders.
 */
export function useNewOrderAlerts(summary: Summary | undefined) {
  const navigate = useNavigate();
  const [on, setOn] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const seen = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setOn(readOn());
    // Any click on the page lets the chime play (needed again after every reload).
    const wake = () => readOn() && unlockSound();
    window.addEventListener("pointerdown", wake);
    return () => window.removeEventListener("pointerdown", wake);
  }, []);

  useEffect(() => {
    if (!summary) return;
    const latestAt = summary.latestOrderAt ?? null;
    if (seen.current === undefined) {
      seen.current = latestAt;
      return;
    }
    if (latestAt && (!seen.current || latestAt > seen.current)) {
      seen.current = latestAt;
      const reference = summary.latestOrderReference ?? "";
      setFresh(reference);
      if (!readOn()) return;
      chime();
      if ("Notification" in window && Notification.permission === "granted") {
        const note = new Notification(`New order ${reference}`, { body: "Open the dashboard to see it.", tag: reference });
        note.onclick = () => {
          window.focus();
          navigate(`/admin/orders/${reference}`);
          note.close();
        };
      }
    }
  }, [summary, navigate]);

  const enable = async () => {
    unlockSound();
    writeOn(true);
    setOn(true);
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    chime(); // so you hear what it sounds like
  };
  const disable = () => {
    writeOn(false);
    setOn(false);
  };

  return { on, enable, disable, fresh, dismiss: () => setFresh(null) };
}

export function OrderAlertToggle({ on, enable, disable }: { on: boolean; enable: () => void; disable: () => void }) {
  return (
    <button
      type="button"
      className="cursor-pointer underline"
      onClick={on ? disable : enable}
      title={on ? "A sound and a notification on this computer when a new order arrives" : undefined}
    >
      {on ? "🔔 Order alerts on" : "🔕 Turn on order alerts"}
    </button>
  );
}

export function NewOrderBanner({ reference, onClose }: { reference: string; onClose: () => void }) {
  return (
    <div role="status" className="border-b border-ink bg-bone">
      <div className="shell flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
        <span>
          <strong>New order {reference}</strong> just came in.
        </span>
        <span className="flex items-center gap-4">
          <Link to={`/admin/orders/${reference}`} className="font-semibold underline" onClick={onClose}>Open it</Link>
          <button type="button" className="cursor-pointer text-stone underline" onClick={onClose}>Dismiss</button>
        </span>
      </div>
    </div>
  );
}
