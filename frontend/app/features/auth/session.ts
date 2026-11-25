import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { api, ApiError } from "~/lib/http";
import type { Me } from "~/lib/types";

const ME_KEY = ["me"] as const;

/** null = signed out. Private data: fetched in the browser only, never server-rendered or cached publicly. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Me | null> => {
      // The server sets this readable marker next to the HttpOnly session cookies. Without it there is
      // no session to ask about, so guests make no request at all.
      if (!document.cookie.split("; ").some((c) => c === "lw_s=1")) return null;
      try {
        return await api<Me>("GET", "/api/v1/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * For private pages: sends a signed-out visitor to sign in, once, and brings them back afterwards.
 * "Once" matters: redirecting again on every render restarts the navigation and it never finishes.
 */
export function useRequireSignIn(signInHref: string) {
  const me = useMe();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sent = useRef(false);
  useEffect(() => {
    if (me.data === null && !sent.current) {
      sent.current = true;
      navigate(`${signInHref}?next=${encodeURIComponent(pathname)}`, { replace: true });
    }
  }, [me.data, navigate, signInHref, pathname]);
  return me;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface RegisterInput extends SignInInput {
  fullName: string;
  phone?: string;
  lang: "en" | "ar";
}

/** Staff with two-step sign-in on get this instead of a session: the app code is asked for next. */
export interface TwoStepNeeded {
  mfaRequired: true;
}

export function needsTwoStep(result: Me | TwoStepNeeded | undefined): result is TwoStepNeeded {
  return Boolean(result && "mfaRequired" in result && result.mfaRequired);
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SignInInput) => api<Me | TwoStepNeeded>("POST", "/api/v1/auth/login", input),
    onSuccess: (result) => {
      if (!needsTwoStep(result)) client.setQueryData(ME_KEY, result);
    },
  });
}

/** The second sign-in step: the 6-digit code from the authenticator app, or a recovery code. */
export function useVerifyTwoStep() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<Me>("POST", "/api/v1/auth/mfa/verify", { code }),
    onSuccess: (me) => client.setQueryData(ME_KEY, me),
  });
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api<Me>("POST", "/api/v1/auth/register", { ...input, phone: input.phone || null }),
    onSuccess: (me) => client.setQueryData(ME_KEY, me),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("POST", "/api/v1/auth/logout"),
    onSettled: () => {
      // Drop every cached private response, not just the profile.
      client.clear();
      client.setQueryData(ME_KEY, null);
    },
  });
}
