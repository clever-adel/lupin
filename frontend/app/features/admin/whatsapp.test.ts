import { describe, expect, it } from "vitest";
import { whatsAppLink } from "./shared";

describe("whatsAppLink", () => {
  it("turns an Egyptian mobile into a wa.me link", () => {
    expect(whatsAppLink("01022088004")).toBe("https://wa.me/201022088004");
    expect(whatsAppLink("010 2208 8004")).toBe("https://wa.me/201022088004");
    expect(whatsAppLink("+20 102 208 8004")).toBe("https://wa.me/201022088004");
  });

  it("gives no link for anything else", () => {
    expect(whatsAppLink(null)).toBeNull();
    expect(whatsAppLink("")).toBeNull();
    expect(whatsAppLink("0223456789")).toBeNull();
    expect(whatsAppLink("0102208800")).toBeNull();
  });
});
