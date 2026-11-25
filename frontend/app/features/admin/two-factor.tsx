import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { errorText } from "~/features/admin/shared";
import { api } from "~/lib/http";

interface Pairing {
  secret: string;
  uri: string;
}

interface Status {
  enabled: boolean;
  thisSignInVerified: boolean;
  recoveryCodesLeft: number;
}

const label = "mb-1 block text-xs font-medium";

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type into an app by hand. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function CodeInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      id={id}
      dir="ltr"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      className="field w-40 text-center text-lg tracking-[0.3em]"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/[^\d ]/g, ""))}
    />
  );
}

/** Shown once, right after they are made. The server keeps only hashes, so they cannot be shown again. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-6 border border-ink bg-card p-5">
      <h2 className="font-semibold">Save your recovery codes</h2>
      <p className="mt-2 text-sm text-stone">
        If you lose your phone, each of these codes lets you sign in once instead of the app code. Write them on
        paper or keep them in a password manager — not in a photo on the same phone. They are shown only now.
      </p>
      <ol className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm" dir="ltr">
        {codes.map((code) => <li key={code} className="border border-line px-3 py-2 text-center">{code}</li>)}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
          Copy all
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          I have saved them somewhere safe
        </label>
        <button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>Continue</button>
      </div>
    </div>
  );
}

/**
 * Pairing an authenticator app. Every owner and admin must do this once before the dashboard opens:
 * scan the QR code, type the first code, keep the recovery codes.
 */
export function TwoFactorSetup() {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const setup = useMutation({ mutationFn: () => api<Pairing>("POST", "/api/v1/auth/mfa/setup") });
  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("POST", "/api/v1/auth/mfa/enable", { code: code.replace(/\s/g, "") }),
    onSuccess: (result) => setCodes(result.recoveryCodes),
  });

  if (codes) {
    // Only now does the dashboard open: the profile says two-step sign-in is on.
    return <RecoveryCodes codes={codes} onDone={() => client.invalidateQueries({ queryKey: ["me"] })} />;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="display text-2xl">Turn on two-step sign-in</h1>
      <p className="mt-3 text-sm">
        To keep the store safe, every staff account needs a code from a phone app as well as the password. Then
        someone who learns your password still cannot open the dashboard.
      </p>
      <p className="mt-2 text-sm text-stone" dir="rtl" lang="ar">
        لحماية المتجر، كل حساب موظف لازم يستخدم كود من تطبيق على الموبايل بجانب كلمة المرور.
      </p>

      <ol className="mt-6 space-y-6 text-sm">
        <li>
          <p className="font-semibold">1. Install an authenticator app on your phone</p>
          <p className="mt-1 text-stone">Google Authenticator, Microsoft Authenticator or Authy — all free.</p>
        </li>
        <li>
          <p className="font-semibold">2. Add LUPIN to the app</p>
          {!setup.data ? (
            <button type="button" className="btn btn-primary mt-2" disabled={setup.isPending} onClick={() => setup.mutate()}>
              {setup.isPending ? "One moment…" : "Show the QR code"}
            </button>
          ) : (
            <div className="mt-2 flex flex-wrap items-start gap-6">
              <div className="bg-white p-3">
                <QRCodeSVG value={setup.data.uri} size={184} level="M" marginSize={1} title="QR code for your authenticator app" />
              </div>
              <div className="max-w-xs text-stone">
                <p>In the app tap <span className="font-semibold text-ink">+</span>, then scan this code.</p>
                <p className="mt-3">On this phone, or cannot scan? <a href={setup.data.uri} className="underline">Open in the app</a>, or type this key:</p>
                <p aria-label="Setup key" className="mt-1 select-all break-all border border-line bg-card px-2 py-1 font-mono text-ink" dir="ltr">
                  {grouped(setup.data.secret)}
                </p>
                <p className="mt-2 text-xs">Keep this key private: anyone with it can make your codes.</p>
              </div>
            </div>
          )}
          {setup.isError && <p role="alert" className="mt-2 text-danger">{errorText(setup.error)}</p>}
        </li>
        {setup.data && (
          <li>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (code.replace(/\s/g, "").length === 6) enable.mutate();
              }}
            >
              <label htmlFor="mfa-first-code" className="font-semibold">3. Type the 6-digit code the app shows for LUPIN</label>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <CodeInput id="mfa-first-code" value={code} onChange={setCode} />
                <button type="submit" className="btn btn-primary" disabled={code.replace(/\s/g, "").length !== 6 || enable.isPending}>
                  {enable.isPending ? "Checking…" : "Turn on"}
                </button>
              </div>
              {enable.isError && <p role="alert" className="mt-2 text-danger">{errorText(enable.error)}</p>}
            </form>
          </li>
        )}
      </ol>
    </div>
  );
}

/** Settings for your own two-step sign-in, once it is on: how many recovery codes are left, and new ones. */
export function TwoFactorPanel() {
  const status = useQuery({
    queryKey: ["admin", "mfa-status"],
    queryFn: () => api<Status>("GET", "/api/v1/auth/mfa/status"),
  });
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const renew = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("POST", "/api/v1/auth/mfa/recovery-codes", { code: code.replace(/\s/g, "") }),
    onSuccess: (result) => {
      setCode("");
      setCodes(result.recoveryCodes);
    },
  });

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          client.invalidateQueries({ queryKey: ["admin", "mfa-status"] });
        }}
      />
    );
  }

  const left = status.data?.recoveryCodesLeft;
  return (
    <section className="mt-6 border border-line bg-card p-5 text-sm">
      <h2 className="font-semibold">Two-step sign-in: on</h2>
      <p className="mt-2 text-stone">
        Each sign-in needs your password and the code from your authenticator app.
        {left !== undefined && ` Recovery codes left: ${left} of 10.`}
      </p>
      {left !== undefined && left <= 3 && (
        <p className="mt-2 font-semibold text-danger">Few recovery codes left. Make new ones below.</p>
      )}
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.replace(/\s/g, "").length === 6) renew.mutate();
        }}
      >
        <label htmlFor="mfa-renew-code" className={label}>New recovery codes (the old ones stop working): type the current app code</label>
        <div className="flex flex-wrap items-center gap-3">
          <CodeInput id="mfa-renew-code" value={code} onChange={setCode} />
          <button type="submit" className="btn btn-outline" disabled={code.replace(/\s/g, "").length !== 6 || renew.isPending}>
            Make new recovery codes
          </button>
        </div>
        {renew.isError && <p role="alert" className="mt-2 text-danger">{errorText(renew.error)}</p>}
      </form>
      <p className="mt-4 text-xs text-stone">
        New phone? Most authenticator apps can move their accounts to a new phone (look for “Transfer accounts” or
        backup in the app). Otherwise another owner resets your two-step sign-in from the Staff screen, and you pair the
        new phone at your next sign-in.
      </p>
    </section>
  );
}
