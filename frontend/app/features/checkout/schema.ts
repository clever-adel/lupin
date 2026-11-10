import { z } from "zod";

// Messages are i18n keys; the form translates them. The server validates everything again.
export const checkoutSchema = z.object({
  recipientName: z.string().trim().min(2, "auth.err.name").max(120, "auth.err.name"),
  phone: z.string().trim().regex(/^01[0125][0-9]{8}$/, "auth.err.phone"),
  governorateId: z.string().regex(/^\d+$/, "checkout.err.governorate"),
  city: z.string().trim().min(2, "checkout.err.city").max(80, "checkout.err.city"),
  addressLine: z.string().trim().min(5, "checkout.err.address").max(300, "checkout.err.address"),
  notes: z.string().trim().max(300, "checkout.err.notes"),
});

export type CheckoutValues = z.infer<typeof checkoutSchema>;
