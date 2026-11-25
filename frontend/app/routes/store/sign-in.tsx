import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/sign-in";
import { LogoLockup } from "~/components/brand";
import { Field } from "~/components/form";
import { registerSchema, signInSchema, type RegisterValues, type SignInValues } from "~/features/auth/schemas";
import { needsTwoStep, useMe, useRegister, useSignIn, useVerifyTwoStep } from "~/features/auth/session";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "~/lib/http";
import { useHydrated } from "~/lib/hydrated";
import { toLang, translate, useT, type MessageKey } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "auth.signIn");
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

/** Only same-site paths are accepted as a return address, so the form cannot be used as an open redirect. */
function safeNext(value: string | null, fallback: string): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

/** Why "Continue with Google" did not finish (the API sends the visitor back with ?google=…). */
const GOOGLE_FAILURES: Record<string, MessageKey | undefined> = {
  cancelled: "auth.googleErr.cancelled",
  failed: "auth.googleErr.failed",
  unavailable: "auth.googleErr.failed",
  unverified: "auth.googleErr.unverified",
  staff: "auth.googleErr.staff",
  disabled: "auth.googleErr.disabled",
};

/** Google's "G", in its own colours, as Google's sign-in branding guidelines ask. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Staff with two-step sign-in: the password was right, now the code from the authenticator app (or a
 * recovery code). On success the signed-in profile is cached and the page's redirect takes over.
 */
function TwoStepForm({ onBack }: { onBack: () => void }) {
  const { t } = useT();
  const verify = useVerifyTwoStep();
  const [code, setCode] = useState("");
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const failure = verify.error instanceof ApiError ? verify.error.message || t("error.generic") : verify.isError ? t("error.generic") : null;
  // The challenge lasts five minutes; after that only a fresh password helps.
  const expired = verify.error instanceof ApiError && verify.error.code === "MFA_CHALLENGE_EXPIRED";

  return (
    <form
      method="post"
      noValidate
      className="mt-6 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim()) verify.mutate(code.trim());
      }}
    >
      <h2 className="text-lg font-semibold">{t("auth.twoStep.title")}</h2>
      <p className="text-sm text-stone">{t("auth.twoStep.intro")}</p>
      {failure && <p role="alert" className="border border-danger px-3 py-2 text-sm text-danger">{failure}</p>}
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{t("auth.twoStep.code")}</label>
        <input
          ref={ref}
          id={id}
          dir="ltr"
          autoComplete="one-time-code"
          maxLength={20}
          className="field text-center text-lg tracking-[0.3em]"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <p className="mt-1 text-xs text-stone">{t("auth.twoStep.recovery")}</p>
      </div>
      {!expired && (
        <button type="submit" className="btn btn-primary w-full" disabled={verify.isPending || !code.trim()}>
          {verify.isPending ? t("auth.working") : t("auth.twoStep.submit")}
        </button>
      )}
      <button type="button" className={`${expired ? "btn btn-primary" : "btn btn-outline"} w-full`} onClick={onBack}>
        {t("auth.twoStep.back")}
      </button>
    </form>
  );
}

export default function SignIn() {
  const { t, href, lang } = useT();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe().data;
  // Staff who sign in without a specific destination go to the dashboard, customers to their account.
  const isStaff = Boolean(me?.roles.some((r) => r === "ADMIN" || r === "OWNER"));
  const next = safeNext(params.get("next"), isStaff ? "/admin" : href("/account"));

  // Once only: `navigate` changes identity while a navigation is in flight, and redirecting again on
  // every change loops until the next page has loaded.
  const redirected = useRef(false);
  useEffect(() => {
    if (me && !redirected.current) {
      redirected.current = true;
      navigate(next, { replace: true });
    }
  }, [me, navigate, next]);

  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => api<{ google: boolean }>("GET", "/api/v1/auth/providers"),
    staleTime: 5 * 60_000,
  });
  const googleFailure = GOOGLE_FAILURES[params.get("google") ?? ""];

  const signIn = useSignIn();
  const register = useRegister();
  const hydrated = useHydrated();
  const signInForm = useForm<SignInValues>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "" },
  });

  const active = mode === "signin" ? signIn : register;
  const failure = active.error instanceof ApiError ? active.error : null;
  const formError = active.isError ? (failure && !failure.fields && failure.message) || (failure?.fields ? null : t("error.generic")) : null;
  const tab = (selected: boolean) =>
    `flex-1 cursor-pointer border-b-2 pb-3 text-sm font-semibold ${selected ? "border-ink" : "border-transparent text-stone"}`;

  return (
    <div className="grid md:min-h-[38rem] md:grid-cols-2">
      <section className="bg-ink px-8 py-12 text-bone md:flex md:flex-col md:justify-center md:px-16">
        <LogoLockup className="h-auto w-48" />
        <h1 className="display mt-10 text-2xl md:text-3xl">{t("auth.title")}</h1>
        <ul className="mt-6 space-y-2 text-sm text-bone/75">
          {(["auth.benefit1", "auth.benefit2", "auth.benefit3"] as const).map((key) => (
            <li key={key}>— {t(key)}</li>
          ))}
        </ul>
      </section>

      <section className="px-6 py-12 md:px-16">
        <div className="mx-auto max-w-sm">
          {/* Standard tabs: one tab stop, arrow keys switch, the panel below is labelled by its tab. */}
          <div
            role="tablist"
            aria-label={t("auth.title")}
            className="flex border-b border-line"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              const next = mode === "signin" ? "register" : "signin";
              setMode(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            <button type="button" role="tab" id="tab-signin" aria-controls="auth-panel" aria-selected={mode === "signin"} tabIndex={mode === "signin" ? 0 : -1} className={tab(mode === "signin")} onClick={() => setMode("signin")}>
              {t("auth.signIn")}
            </button>
            <button type="button" role="tab" id="tab-register" aria-controls="auth-panel" aria-selected={mode === "register"} tabIndex={mode === "register" ? 0 : -1} className={tab(mode === "register")} onClick={() => setMode("register")}>
              {t("auth.create")}
            </button>
          </div>
          <div role="tabpanel" id="auth-panel" aria-labelledby={`tab-${mode}`}>

          {params.get("changed") === "1" && !active.isError && (
            <p role="status" className="mt-6 border border-ink px-3 py-2 text-sm">{t("auth.passwordChanged")}</p>
          )}
          {googleFailure && (
            <p role="alert" className="mt-6 border border-danger px-3 py-2 text-sm text-danger">{t(googleFailure)}</p>
          )}
          {providers.data?.google && (
            <>
              {/* A real navigation, not a fetch: the browser goes to Google and comes back signed in. */}
              <a
                href={`/api/v1/auth/google/start?lang=${lang}&next=${encodeURIComponent(next)}`}
                className="mt-6 flex w-full items-center justify-center gap-3 border border-line bg-card px-4 py-3 text-sm font-medium hover:border-ink"
              >
                <GoogleMark />
                {t("auth.google")}
              </a>
              <p className="mt-6 flex items-center gap-3 text-xs text-stone before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
                {t(mode === "signin" ? "auth.orEmail" : "auth.orCreate")}
              </p>
            </>
          )}
          {formError && (
            <p role="alert" className="mt-6 border border-danger px-3 py-2 text-sm text-danger">{formError}</p>
          )}

          {mode === "signin" && needsTwoStep(signIn.data) ? (
            <TwoStepForm onBack={() => { signIn.reset(); signInForm.setValue("password", ""); }} />
          ) : mode === "signin" ? (
            <form method="post" noValidate className="mt-6 space-y-4" onSubmit={signInForm.handleSubmit((values) => signIn.mutate(values))}>
              <Field label={t("auth.email")} type="email" autoComplete="email" error={signInForm.formState.errors.email} registration={signInForm.register("email")} />
              <div>
                <Field label={t("auth.password")} type="password" autoComplete="current-password" error={signInForm.formState.errors.password} registration={signInForm.register("password")} />
                <Link to={href("/reset-password")} className="mt-2 inline-block text-xs text-stone underline underline-offset-4 hover:text-ink">
                  {t("auth.forgot")}
                </Link>
              </div>
              <button type="submit" className="btn btn-primary w-full" disabled={!hydrated || signIn.isPending}>
                {signIn.isPending ? t("auth.working") : t("auth.submitSignIn")}
              </button>
            </form>
          ) : (
            <form method="post" noValidate className="mt-6 space-y-4" onSubmit={registerForm.handleSubmit((values) => register.mutate({ ...values, lang }))}>
              <Field label={t("auth.fullName")} autoComplete="name" error={registerForm.formState.errors.fullName} serverError={failure?.fields?.fullName} registration={registerForm.register("fullName")} />
              <Field label={t("auth.email")} type="email" autoComplete="email" error={registerForm.formState.errors.email} serverError={failure?.fields?.email} registration={registerForm.register("email")} />
              <Field label={t("auth.phone")} type="tel" inputMode="tel" autoComplete="tel-national" error={registerForm.formState.errors.phone} serverError={failure?.fields?.phone} registration={registerForm.register("phone")} />
              <Field label={t("auth.password")} type="password" autoComplete="new-password" hint={t("auth.passwordHint")} error={registerForm.formState.errors.password} serverError={failure?.fields?.password} registration={registerForm.register("password")} />
              <button type="submit" className="btn btn-primary w-full" disabled={!hydrated || register.isPending}>
                {register.isPending ? t("auth.working") : t("auth.submitCreate")}
              </button>
            </form>
          )}
          </div>
        </div>
      </section>
    </div>
  );
}
