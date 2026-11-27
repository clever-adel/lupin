import type { ProductCard, ProductDetail } from "./types";

/** "You may also steal": up to four other pieces, same category first, then the rest, in the API's order. */
export function relatedPieces(product: ProductDetail, cards: ProductCard[]): ProductCard[] {
  const others = cards.filter((c) => c.slug !== product.slug);
  const same = others.filter((c) => c.categoryEn === product.category.nameEn);
  const rest = others.filter((c) => c.categoryEn !== product.category.nameEn);
  return [...same, ...rest].slice(0, 4);
}
