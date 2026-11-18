import { usePushAlerts } from "./push";

/** Settings → New order alerts: turn phone/computer notifications on for the browser in use. */
export function PushAlertsPanel() {
  const push = usePushAlerts();
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="font-semibold">Notifications on this phone or computer</h3>
      <p className="mt-1 text-sm text-stone">
        Each owner and admin turns this on for themselves, on every device they want alerts on. A notification
        arrives with each new order, even when the dashboard is closed. Tap it to open the order.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm" aria-busy={push.busy || push.state === "checking"}>
        {push.state === "on" && (
          <>
            <span className="font-semibold">✓ On for this device</span>
            <button type="button" className="btn btn-outline" disabled={push.busy} onClick={() => void push.test()}>Send a test</button>
            <button type="button" className="cursor-pointer text-xs underline" disabled={push.busy} onClick={() => void push.disable()}>Turn off</button>
          </>
        )}
        {push.state === "off" && (
          <button type="button" className="btn btn-primary" disabled={push.busy} onClick={() => void push.enable()}>
            {push.busy ? "Turning on…" : "Turn on notifications"}
          </button>
        )}
        {push.state === "blocked" && (
          <p className="text-danger">
            Notifications are blocked for this site. Allow them in the browser’s site settings (the icon next to the
            address), then reload this page.
          </p>
        )}
        {push.state === "install-first" && (
          <p>
            On iPhone: open this page in Safari, tap <strong>Share → Add to Home Screen</strong>, open
            <strong> LUPIN Staff</strong> from the Home Screen, sign in, and come back here.
          </p>
        )}
        {push.state === "unsupported" && <p className="text-stone">This browser cannot show notifications. Try Chrome or Safari.</p>}
      </div>
      {push.error && <p role="alert" className="mt-2 text-sm text-danger">{push.error}</p>}
    </div>
  );
}
