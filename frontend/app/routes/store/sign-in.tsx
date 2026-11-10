import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/sign-in";
import { LogoLockup } from "~/components/brand";
import { Field } from "~/components/form";
import { registerSchema, signInSchema, type RegisterValues, type SignInValues } from "~/features/auth/schemas";
import { useMe, useRegister, useSignIn } from "~/features/auth/session";
import { ApiError } from "~/lib/http";
import { toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "auth.signIn");
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

/** Only same-site paths are accepted as a return address, so the form cannot be used as an open redirect. */
function safeNext(value: string | null, fallback: string): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

export default function SignIn() {
  const { t, href, lang } = useT();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe().data;
  const next = safeNext(params.get("next"), href("/account"));

  // Once only: `navigate` changes identity while a navigation is in flight, and redirecting again on
  // every change loops until the next page has loaded.
  const redirected = useRef(false);
  useEffect(() => {
    if (me && !redirected.current) {
      redirected.current = true;
      navigate(next, { replace: true });
    }
  }, [me, navigate, next]);

  const signIn = useSignIn();
  const register = useRegister();
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

          {formError && (
            <p role="alert" className="mt-6 border border-danger px-3 py-2 text-sm text-danger">{formError}</p>
          )}

          {mode === "signin" ? (
            <form noValidate className="mt-6 space-y-4" onSubmit={signInForm.handleSubmit((values) => signIn.mutate(values))}>
              <Field label={t("auth.email")} type="email" autoComplete="email" error={signInForm.formState.errors.email} registration={signInForm.register("email")} />
              <Field label={t("auth.password")} type="password" autoComplete="current-password" error={signInForm.formState.errors.password} registration={signInForm.register("password")} />
              <button type="submit" className="btn btn-primary w-full" disabled={signIn.isPending}>
                {signIn.isPending ? t("auth.working") : t("auth.submitSignIn")}
              </button>
            </form>
          ) : (
            <form noValidate className="mt-6 space-y-4" onSubmit={registerForm.handleSubmit((values) => register.mutate({ ...values, lang }))}>
              <Field label={t("auth.fullName")} autoComplete="name" error={registerForm.formState.errors.fullName} serverError={failure?.fields?.fullName} registration={registerForm.register("fullName")} />
              <Field label={t("auth.email")} type="email" autoComplete="email" error={registerForm.formState.errors.email} serverError={failure?.fields?.email} registration={registerForm.register("email")} />
              <Field label={t("auth.phone")} type="tel" inputMode="tel" autoComplete="tel-national" error={registerForm.formState.errors.phone} serverError={failure?.fields?.phone} registration={registerForm.register("phone")} />
              <Field label={t("auth.password")} type="password" autoComplete="new-password" hint={t("auth.passwordHint")} error={registerForm.formState.errors.password} serverError={failure?.fields?.password} registration={registerForm.register("password")} />
              <button type="submit" className="btn btn-primary w-full" disabled={register.isPending}>
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
