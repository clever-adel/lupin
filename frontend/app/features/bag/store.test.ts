import { beforeEach, describe, expect, it } from "vitest";
import { bagActions, bagCount, MAX_LINE_QUANTITY } from "./store";

function saved() {
  return JSON.parse(window.localStorage.getItem("lupin.bag.v1") ?? "{}");
}

describe("guest bag", () => {
  beforeEach(() => {
    window.localStorage.clear();
    bagActions.reset();
  });

  it("adds a line and merges repeated adds of the same variant", () => {
    bagActions.add(7, 1);
    bagActions.add(7, 2);
    bagActions.add(9, 1);
    expect(saved().bag).toEqual([
      { variantId: 7, quantity: 3 },
      { variantId: 9, quantity: 1 },
    ]);
    expect(bagCount(saved().bag)).toBe(4);
  });

  it("never lets a line exceed the per-line limit or drop below one", () => {
    bagActions.add(7, 8);
    bagActions.add(7, 8);
    expect(saved().bag[0].quantity).toBe(MAX_LINE_QUANTITY);
    bagActions.setQuantity(7, 0);
    expect(saved().bag[0].quantity).toBe(1);
    bagActions.setQuantity(7, 999);
    expect(saved().bag[0].quantity).toBe(MAX_LINE_QUANTITY);
  });

  it("removes lines and toggles favourites", () => {
    bagActions.add(7, 1);
    bagActions.remove(7);
    expect(saved().bag).toEqual([]);
    bagActions.toggleFavourite("night-bomber");
    expect(saved().favourites).toEqual(["night-bomber"]);
    bagActions.toggleFavourite("night-bomber");
    expect(saved().favourites).toEqual([]);
  });

  it("stores ids and quantities only, never prices", () => {
    bagActions.add(7, 2);
    expect(Object.keys(saved().bag[0]).sort()).toEqual(["quantity", "variantId"]);
  });
});
