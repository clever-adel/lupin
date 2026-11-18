import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorText } from "./shared";
import { api } from "~/lib/http";

/** Mirrors store.lupinwear.notify.StaffTelegram.Status. */
interface TelegramStatus {
  configured: boolean;
  botUsername?: string | null;
  linked: { username?: string | null; linkedAt: string }[];
}

/**
 * Settings → New order alerts: link this staff member's Telegram. The bot sends every new order,
 * customer cancels and transfer screenshots to each linked owner and admin.
 */
export function TelegramPanel() {
  const client = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const status = useQuery({
    queryKey: ["admin", "telegram"],
    queryFn: () => api<TelegramStatus>("GET", "/api/v1/admin/telegram"),
    // While the person is pressing Start in Telegram, check every few seconds.
    refetchInterval: waiting ? 3000 : false,
  });
  const linkedCount = status.data?.linked.length ?? 0;
  useEffect(() => {
    if (waiting && linkedCount > 0) setWaiting(false); // linked: stop checking
  }, [waiting, linkedCount]);

  const link = useMutation({
    mutationFn: async () => {
      // Opened before the request so the browser does not treat it as a pop-up.
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await api<{ url: string }>("POST", "/api/v1/admin/telegram/link", {});
        if (tab) tab.location.href = url;
        else window.location.href = url;
        setWaiting(true);
        window.setTimeout(() => setWaiting(false), 180_000);
      } catch (e) {
        tab?.close();
        throw e;
      }
    },
  });
  const unlink = useMutation({
    mutationFn: () => api<void>("POST", "/api/v1/admin/telegram/unlink", {}),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "telegram"] }),
  });
  const test = useMutation({
    mutationFn: () => api<{ sent: number }>("POST", "/api/v1/admin/telegram/test", {}),
  });

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="font-semibold">Telegram</h3>
      <p className="mt-1 text-sm text-stone">
        Each owner and admin links their own Telegram. The bot then sends every new order (customer, address,
        items, total and a button to open it), customer cancels, and transfer screenshots to check.
      </p>

      {status.isPending && <p className="mt-3 text-sm text-stone">Loading…</p>}
      {status.isError && <p role="alert" className="mt-3 text-sm text-danger">{errorText(status.error)}</p>}

      {status.data && !status.data.configured && (
        <div className="mt-3 border border-line bg-card p-3 text-sm">
          <p className="font-semibold">Not set up yet (the owner does this once):</p>
          <ol className="ms-5 mt-1 list-decimal space-y-1">
            <li>In Telegram, open <strong>@BotFather</strong> and send <code>/newbot</code>.</li>
            <li>Name it (for example “LUPIN Orders”) and pick a username ending in “bot”.</li>
            <li>Copy the token it gives you into Render → lupin-api → Environment as <code>TELEGRAM_BOT_TOKEN</code>, and save.</li>
            <li>After the server restarts, come back here and press “Link my Telegram”.</li>
          </ol>
          <p className="mt-2 text-xs text-stone">The token is a password for the bot: never send it in a chat or an email.</p>
        </div>
      )}

      {status.data?.configured && (
        <div className="mt-3 space-y-3 text-sm">
          {status.data.linked.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">
                ✓ Linked{status.data.linked.map((l) => (l.username ? ` @${l.username}` : "")).join(",")}
              </span>
              <button type="button" className="btn btn-outline" disabled={test.isPending} onClick={() => test.mutate()}>
                Send a test
              </button>
              <button type="button" className="btn btn-outline" disabled={link.isPending} onClick={() => link.mutate()}>
                Link another Telegram
              </button>
              <button type="button" className="cursor-pointer text-xs underline" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
                Unlink
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary" disabled={link.isPending} onClick={() => link.mutate()}>
                {link.isPending ? "Opening Telegram…" : "Link my Telegram"}
              </button>
              {waiting && <span className="text-stone" role="status">In Telegram, press <strong>Start</strong>. This page updates by itself.</span>}
            </div>
          )}
          {status.data.botUsername && (
            <p className="text-xs text-stone">Bot: @{status.data.botUsername}</p>
          )}
          {test.isSuccess && test.data.sent === 0 && (
            <p role="alert" className="text-danger">The test was not delivered. Unlink and link again.</p>
          )}
          {test.isSuccess && test.data.sent > 0 && <p role="status">Sent. Check Telegram.</p>}
          {(link.error || unlink.error || test.error) && (
            <p role="alert" className="text-danger">{errorText(link.error ?? unlink.error ?? test.error)}</p>
          )}
        </div>
      )}
    </div>
  );
}
