import { describe, expect, it } from "vitest";
import { move } from "./arrange-order";

describe("arrange shop", () => {
  it("moves a piece and shifts the others", () => {
    expect(move(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(move(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(move(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(move(["a", "b", "c"], 2, 9)).toEqual(["a", "b", "c"]);
  });
});
