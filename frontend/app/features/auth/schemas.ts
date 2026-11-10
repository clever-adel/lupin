import { z } from "zod";

// Messages are i18n keys; the form translates them. The server validates everything again.

export const signInSchema = z.object({
  email: z.email("auth.err.email").max(254, "auth.err.email"),
  password: z.string().min(1, "auth.err.passwordRequired").max(128, "auth.err.password"),
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "auth.err.name").max(120, "auth.err.name"),
  email: z.email("auth.err.email").max(254, "auth.err.email"),
  phone: z
    .string()
    .trim()
    .regex(/^(01[0125][0-9]{8})?$/, "auth.err.phone"),
  password: z.string().min(10, "auth.err.password").max(128, "auth.err.password"),
});

export type SignInValues = z.infer<typeof signInSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
