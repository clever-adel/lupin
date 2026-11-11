import { describe, expect, it } from "vitest";
import { checkoutSchema } from "~/features/checkout/schema";
import { registerSchema, signInSchema } from "./schemas";

const messages = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("sign-in form rules", () => {
  it("accepts an email and any non-empty password", () => {
    expect(signInSchema.safeParse({ email: "a@example.test", password: "x" }).success).toBe(true);
  });

  it("names the field that is wrong", () => {
    expect(messages(signInSchema.safeParse({ email: "nope", password: "" }))).toEqual({
      email: "auth.err.email",
      password: "auth.err.passwordRequired",
    });
  });
});

describe("sign-up form rules", () => {
  const valid = { fullName: "Mona Adel", email: "mona@example.test", phone: "", password: "long-enough-pw" };

  it("accepts a valid form, with or without a phone", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, phone: "01012345678" }).success).toBe(true);
  });

  it("requires 10 characters, a real name and a valid email", () => {
    expect(messages(registerSchema.safeParse({ ...valid, password: "123456789" }))).toEqual({ password: "auth.err.password" });
    expect(messages(registerSchema.safeParse({ ...valid, fullName: " A " }))).toEqual({ fullName: "auth.err.name" });
    expect(messages(registerSchema.safeParse({ ...valid, email: "mona@" }))).toEqual({ email: "auth.err.email" });
  });

  it.each(["0101234567", "010123456789", "01312345678", "+201012345678", "abcdefghijk"])(
    "rejects the phone number %s",
    (phone) => {
      expect(messages(registerSchema.safeParse({ ...valid, phone }))).toEqual({ phone: "auth.err.phone" });
    },
  );

  it.each(["01012345678", "01112345678", "01212345678", "01512345678"])("accepts the phone number %s", (phone) => {
    expect(registerSchema.safeParse({ ...valid, phone }).success).toBe(true);
  });
});

describe("checkout form rules", () => {
  const valid = {
    recipientName: "Mona Adel", phone: "01012345678", governorateId: "1", city: "Nasr City",
    addressLine: "12 Example Street", notes: "",
  };

  it("accepts a complete address and trims spaces", () => {
    const parsed = checkoutSchema.parse({ ...valid, city: "  Nasr City  " });
    expect(parsed.city).toBe("Nasr City");
  });

  it("requires a governorate, a phone, a city and a street address", () => {
    expect(messages(checkoutSchema.safeParse({ ...valid, governorateId: "", phone: "", city: " ", addressLine: "12" }))).toEqual({
      governorateId: "checkout.err.governorate",
      phone: "auth.err.phone",
      city: "checkout.err.city",
      addressLine: "checkout.err.address",
    });
  });

  it("does not accept a governorate that is not a number, or very long notes", () => {
    expect(messages(checkoutSchema.safeParse({ ...valid, governorateId: "1 or 1=1" }))).toEqual({
      governorateId: "checkout.err.governorate",
    });
    expect(messages(checkoutSchema.safeParse({ ...valid, notes: "x".repeat(301) }))).toEqual({ notes: "checkout.err.notes" });
  });
});
