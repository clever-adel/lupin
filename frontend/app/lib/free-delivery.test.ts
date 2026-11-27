import { describe, expect, it } from "vitest";
import { freeDeliveryProgress } from "./free-delivery";

describe("free delivery progress", () => {
  it("says how much is left and how far along the bag is", () => {
    expect(freeDeliveryProgress(1550, 2000)).toEqual({ left: 450, share: 0.775 });
    expect(freeDeliveryProgress(2000, 2000)).toEqual({ left: 0, share: 1 });
    expect(freeDeliveryProgress(2600, 2000)).toEqual({ left: 0, share: 1 });
  });

  it("shows nothing without a threshold or with an empty bag", () => {
    expect(freeDeliveryProgress(1000, null)).toBeNull();
    expect(freeDeliveryProgress(1000, undefined)).toBeNull();
    expect(freeDeliveryProgress(0, 2000)).toBeNull();
  });
});
