import { describe, expect, it } from "vitest";
import { errorText, money, PAYMENT_LABEL, PAYMENT_STATUS_LABEL, STATUS_LABEL } from "~/features/admin/shared";
import { EDGE_KEY_HEADER, edgeKey } from "./edge";
import { ApiError } from "./http";
import { formatDateTime, translate, translateCode, type MessageKey } from "./i18n";

describe("server codes become readable text", () => {
  it("translates known error and promo codes in both languages", () => {
    expect(translateCode("en", "err", "OUT_OF_STOCK")).toBe("An item in your order has just sold out.");
    expect(translateCode("ar", "err", "PRICE_CHANGED")).toBe("تغيّر الإجمالي. راجعه ثم أكّد مرة أخرى.");
    expect(translateCode("en", "promo", "ALREADY_USED")).toBe("You have already used this code.");
  });

  it("falls back to a generic message for unknown or missing codes, never to the raw code", () => {
    expect(translateCode("en", "err", "SOME_NEW_CODE")).toBe("Something went wrong. Please try again.");
    expect(translateCode("ar", "err", undefined)).toBe("حدث خطأ. حاول مرة أخرى.");
    expect(translateCode("en", "err", "__proto__")).toBe("Something went wrong. Please try again.");
  });

  it("has a customer-facing label for every order status and payment method", () => {
    for (const status of ["PENDING", "AWAITING_PAYMENT", "PAID", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]) {
      for (const lang of ["en", "ar"] as const) {
        expect(translate(lang, `order.status.${status}` as MessageKey)).toBeTruthy();
      }
      expect(STATUS_LABEL[status]).toBeTruthy();
    }
    for (const method of ["COD", "CARD", "WALLET", "FAWRY", "INSTAPAY_MANUAL"]) {
      expect(translate("en", `pay.${method}` as MessageKey)).toBeTruthy();
      expect(translate("ar", `pay.note.${method}` as MessageKey)).toBeTruthy();
      expect(PAYMENT_LABEL[method]).toBeTruthy();
    }
    for (const status of ["PENDING", "VERIFYING", "PAID", "FAILED", "REFUND_PENDING", "REFUNDED"]) {
      expect(PAYMENT_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it("formats dates with Latin digits in both languages", () => {
    const iso = "2026-11-10T08:04:00Z";
    expect(formatDateTime("en", iso)).toMatch(/10 Nov 2026/);
    expect(formatDateTime("ar", iso)).toMatch(/2026/);
    expect(formatDateTime("ar", iso)).not.toMatch(/[٠-٩]/);
  });
});

describe("staff dashboard helpers", () => {
  it("shows the server's message, and the field name when one field is wrong", () => {
    expect(errorText(new ApiError(409, "INVALID_TRANSITION", "An order that is SHIPPED cannot become CANCELLED."))).toBe(
      "An order that is SHIPPED cannot become CANCELLED.",
    );
    expect(errorText(new ApiError(400, "VALIDATION_FAILED", "Some fields need attention.", { fee: "must be at least 0" }))).toBe(
      "fee: must be at least 0",
    );
    expect(errorText(new ApiError(500, "INTERNAL_ERROR", ""))).toBe("INTERNAL_ERROR");
    expect(errorText(new TypeError("network down"))).toBe("Something went wrong. Please try again.");
  });

  it("formats money in EGP", () => {
    expect(money(11060)).toBe("EGP 11,060");
    expect(money(1999.5)).toBe("EGP 1,999.50");
  });
});

describe("edge key", () => {
  it("is sent only when the Worker has the secret", () => {
    expect(EDGE_KEY_HEADER).toBe("X-Lupin-Edge-Key");
    expect(edgeKey({ EDGE_SHARED_SECRET: "abc" })).toBe("abc");
    expect(edgeKey({ EDGE_SHARED_SECRET: "" })).toBeUndefined();
    expect(edgeKey({})).toBeUndefined();
  });
});
