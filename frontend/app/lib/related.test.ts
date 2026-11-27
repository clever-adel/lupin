import { describe, expect, it } from "vitest";
import { relatedPieces } from "./related";
import type { ProductCard, ProductDetail } from "~/lib/types";

const card = (slug: string, categoryEn: string) => ({ slug, categoryEn }) as ProductCard;
const product = { slug: "crew", category: { slug: "sweatshirt", nameEn: "sweatshirt", nameAr: "" } } as ProductDetail;

describe("you may also steal", () => {
  it("leaves out the piece itself, puts the same category first and keeps four", () => {
    const cards = [card("crew", "sweatshirt"), card("h1", "hoodie"), card("s1", "sweatshirt"), card("h2", "hoodie"), card("j1", "jacket"), card("h3", "hoodie")];
    expect(relatedPieces(product, cards).map((c) => c.slug)).toEqual(["s1", "h1", "h2", "j1"]);
  });

  it("is empty when the piece is the only one", () => {
    expect(relatedPieces(product, [card("crew", "sweatshirt")])).toEqual([]);
  });
});
