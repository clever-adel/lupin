import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { errorText } from "~/features/admin/shared";
import { api } from "~/lib/http";
import type { SizeGuide } from "~/lib/types";

const KIDS = ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y", "12-13Y"];

export interface DuplicableProduct {
  nameEn: string;
  nameAr: string;
  departmentSlug: string;
  categorySlug: string;
  descriptionEn: string;
  descriptionAr: string;
  fabricEn: string;
  fabricAr: string;
  fitEn: string;
  fitAr: string;
  brand?: string | null;
  badge?: string;
  badgeEn?: string;
  badgeAr?: string;
  price: number;
  salePrice?: number;
  colors: { nameEn: string; nameAr: string; hex: string; main?: boolean }[];
  sizes?: string[];
  sizeGuide?: SizeGuide | null;
}

/** The new-product request for a copy: same details, sizes, colours and size chart; no photos, no stock. */
export function copyRequest(p: DuplicableProduct) {
  const sizes = p.sizes ?? [];
  const mainIndex = Math.max(0, p.colors.findIndex((c) => c.main));
  return {
    nameEn: `${p.nameEn} (copy)`.slice(0, 160),
    nameAr: `${p.nameAr} (نسخة)`.slice(0, 160),
    departmentSlug: p.departmentSlug,
    categorySlug: p.categorySlug,
    descriptionEn: p.descriptionEn, descriptionAr: p.descriptionAr,
    fabricEn: p.fabricEn, fabricAr: p.fabricAr, fitEn: p.fitEn, fitAr: p.fitAr,
    brand: (p.brand ?? "").trim() || null,
    badge: p.badge || null,
    badgeEn: p.badge === "CUSTOM" ? p.badgeEn ?? null : null,
    badgeAr: p.badge === "CUSTOM" ? p.badgeAr ?? null : null,
    price: p.price,
    salePrice: p.salePrice ?? null,
    sizeGroup: sizes.some((s) => KIDS.includes(s)) ? "KIDS" : "ADULT",
    sizes,
    colors: p.colors.map((c, i) => ({ nameEn: c.nameEn, nameAr: c.nameAr, hex: c.hex, main: i === mainIndex, images: [] })),
    initialStockPerVariant: 0,
  };
}

/**
 * Starts a new product from this one: a hidden draft with the same text, price, category, sizes, colours
 * and size chart, but no photos and no stock (the next piece has its own). Opens the copy to finish it.
 */
export function DuplicateProduct({ product }: { product: DuplicableProduct }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const copy = useMutation({
    mutationFn: async () => {
      const created = await api<{ id: number }>("POST", "/api/v1/admin/products", copyRequest(product));
      if (product.sizeGuide) {
        await api<void>("PUT", `/api/v1/admin/products/${created.id}/size-guide`, product.sizeGuide);
      }
      return created.id;
    },
    onSuccess: (id) => {
      client.invalidateQueries({ queryKey: ["admin", "products"] });
      navigate(`/admin/products/${id}`);
    },
  });
  const ready = (product.sizes?.length ?? 0) > 0 && product.colors.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn btn-outline" disabled={!ready || copy.isPending} onClick={() => copy.mutate()}>
        {copy.isPending ? "Copying…" : "Duplicate product"}
      </button>
      <span className="text-xs text-stone">A hidden draft with the same details, sizes, colours and size chart. Add its photos and stock.</span>
      {copy.isError && <span role="alert" className="text-sm text-danger">{errorText(copy.error)}</span>}
    </div>
  );
}
