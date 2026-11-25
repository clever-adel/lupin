import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/reset-password";
import { Field } from "~/components/form";
import { useHydrated } from "~/lib/hydrated";
import { api, ApiError } from "~/lib/http";
import { toLang, translate, useT, type MessageKey } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "reset.title");
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

const emailSchema = z.object({ email: z.email("auth.err.email").max(254, "auth.err.email") });
const passwordSchema = z
  .object({
    password: z.string().min(10, "auth.err.password").max(128, "auth.err.password"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "reset.err.mismatch" });

const KNOWN_ERRORS: Record<string, MessageKey> = {
  RESET_LINK_INVALID: "reset.err.invalid",
  WEAK_PASSWORD: "reset.err.staff",
  TOO_MANY_REQUESTS: "reset.err.tooMany",
};

/**
 * "Forgot password". Without a token: ask for the email and send a link. With the token from the
 * email (after "#", so it never reaches a server log): choose the new password.
 */
export default function ResetPassword() {
  const { t } = useT();
  // The fragment exists only in the browser, so the server renders the email form first.
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (value) {
        setToken(value);
        // Keep the token out of the address bar and browser history once it is read.
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      }
    };
    read();
    // A second link opened in the same tab changes only the "#" part, which does not reload the page.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  return (
    <section className="px-6 py-14 md:py-20">
      <div className="mx-auto max-w-sm">
        <h1 className="display text-2xl">{t(token ? "reset.newTitle" : "reset.title")}</h1>
        {token ? <NewPassword token={token} /> : <RequestLink />}
      </div>
    </section>
  );
}

function errorText(error: unknown, t: (key: MessageKey) => string) {
  const key = error instanceof ApiError ? KNOWN_ERRORS[error.code] : undefined;
  return t(key ?? "error.generic");
}

function RequestLink() {
  const { t, href, lang } = useT();
  const form = useForm<{ email: string }>({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });
  const hydrated = useHydrated();
  const send = useMutation({
    mutationFn: (email: string) => api<void>("POST", "/api/v1/auth/forgot-password", { email, lang }),
  });

  if (send.isSuccess) {
    return (
      <>
        <p role="status" className="mt-6 border border-ink px-4 py-3 text-sm leading-relaxed">
          {t("reset.sent").replace("{email}", send.variables ?? "")}
        </p>
        <p className="mt-4 text-sm text-stone">{t("reset.sentHint")}</p>
        <Link to={href("/sign-in")} className="btn btn-outline mt-6 w-full">{t("reset.back")}</Link>
      </>
    );
  }
  return (
    <>
      <p className="mt-3 text-sm text-stone">{t("reset.intro")}</p>
      {send.isError && <p role="alert" className="mt-6 border border-danger px-3 py-2 text-sm text-danger">{errorText(send.error, t)}</p>}
      <form method="post" noValidate className="mt-6 space-y-4" onSubmit={form.handleSubmit((v) => send.mutate(v.email.trim()))}>
        <Field label={t("auth.email")} type="email" autoComplete="email" error={form.formState.errors.email} registration={form.register("email")} />
        <button type="submit" className="btn btn-primary w-full" disabled={!hydrated || send.isPending}>
          {send.isPending ? t("auth.working") : t("reset.send")}
        </button>
      </form>
      <Link to={href("/sign-in")} className="mt-6 inline-block text-sm underline underline-offset-4">{t("reset.back")}</Link>
    </>
  );
}

function NewPassword({ token }: { token: string }) {
  const { t, href } = useT();
  const form = useForm<{ password: string; confirm: string }>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const hydrated = useHydrated();
  const reset = useMutation({
    mutationFn: (newPassword: string) => api<void>("POST", "/api/v1/auth/reset-password", { token, newPassword }),
  });

  if (reset.isSuccess) {
    return (
      <>
        <p role="status" className="mt-6 border border-ink px-4 py-3 text-sm">{t("reset.done")}</p>
        <Link to={href("/sign-in")} className="btn btn-primary mt-6 w-full">{t("auth.submitSignIn")}</Link>
      </>
    );
  }
  const invalid = reset.error instanceof ApiError && reset.error.code === "RESET_LINK_INVALID";
  return (
    <>
      <p className="mt-3 text-sm text-stone">{t("reset.newIntro")}</p>
      {reset.isError && (
        <div role="alert" className="mt-6 border border-danger px-3 py-2 text-sm text-danger">
          {errorText(reset.error, t)}
          {invalid && (
            <a href={href("/reset-password")} className="mt-1 block font-medium underline underline-offset-4">{t("reset.again")}</a>
          )}
        </div>
      )}
      <form method="post" noValidate className="mt-6 space-y-4" onSubmit={form.handleSubmit((v) => reset.mutate(v.password))}>
        <Field label={t("reset.newPassword")} type="password" autoComplete="new-password" hint={t("auth.passwordHint")} error={form.formState.errors.password} registration={form.register("password")} />
        <Field label={t("reset.confirm")} type="password" autoComplete="new-password" error={form.formState.errors.confirm} registration={form.register("confirm")} />
        <button type="submit" className="btn btn-primary w-full" disabled={!hydrated || reset.isPending}>
          {reset.isPending ? t("auth.working") : t("reset.save")}
        </button>
      </form>
    </>
  );
}
