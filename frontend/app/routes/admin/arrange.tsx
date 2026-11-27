import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorText } from "~/features/admin/shared";
import { move } from "~/features/admin/arrange-order";
import { api } from "~/lib/http";
import { photoUrl } from "~/lib/photo-sizes";
import type { Page, ProductCard } from "~/lib/types";

interface Piece {
  id: number;
  slug: string;
  name: string;
  category: string;
  inStock: boolean;
  image?: string;
}

/** Every piece on sale, in the store's current order, with its id for saving a new order. */
async function loadPieces(): Promise<Piece[]> {
  const cards: ProductCard[] = [];
  for (let page = 0; page < 20; page++) {
    const result = await api<Page<ProductCard>>("GET", `/api/v1/catalog/products?pageSize=48&page=${page}`);
    cards.push(...result.items);
    if (page + 1 >= result.totalPages) break;
  }
  const ids = new Map<string, number>();
  for (let page = 0; page < 20; page++) {
    const result = await api<Page<{ id: number; slug: string }>>("GET", `/api/v1/admin/products?status=ACTIVE&pageSize=50&page=${page}`);
    for (const row of result.items) ids.set(row.slug, row.id);
    if (page + 1 >= result.totalPages) break;
  }
  return cards.flatMap((c) => {
    const id = ids.get(c.slug);
    return id === undefined ? [] : [{
      id, slug: c.slug, name: c.nameEn, category: c.categoryEn, inStock: c.inStock, image: c.colors[0]?.imageUrl,
    }];
  });
}

/**
 * The order pieces appear in on the store (home page, shop and departments). Pieces that are sold out
 * always show last, whatever their place here, and a newly added piece shows first until it is arranged.
 */
export default function AdminArrange() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "arrange"], queryFn: loadPieces });
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (query.data) {
      setPieces(query.data);
      setChanged(false);
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api<void>("PUT", "/api/v1/admin/products/order", { productIds: pieces.map((p) => p.id) }),
    onSuccess: async () => {
      setChanged(false);
      await client.invalidateQueries({ queryKey: ["admin", "arrange"] });
    },
  });

  const shift = (from: number, to: number) => {
    setPieces((list) => move(list, from, to));
    setChanged(true);
    save.reset();
  };
  const groupByKind = () => {
    const order = [...new Set(pieces.map((p) => p.category))];
    setPieces([...pieces].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)));
    setChanged(true);
    save.reset();
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Display order</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone">
        The order pieces appear in on the home page, the shop and each department. Drag a piece, or use the arrows,
        then save. Sold-out pieces always show last; a newly added piece shows first until you arrange it here.
      </p>

      <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-3 border-b border-line bg-bone py-3">
        <button type="button" className="btn btn-primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save order"}
        </button>
        <button type="button" className="btn btn-outline" disabled={pieces.length < 2} onClick={groupByKind}>
          Keep the same kind together
        </button>
        {changed && (
          <button type="button" className="cursor-pointer text-sm underline" onClick={() => { setPieces(query.data ?? []); setChanged(false); }}>
            Undo changes
          </button>
        )}
        {save.isSuccess && !changed && <span role="status" className="text-sm">Saved. The store shows this order now.</span>}
        {save.isError && <span role="alert" className="text-sm text-danger">{errorText(save.error)}</span>}
      </div>

      {query.isError && <p role="alert" className="mt-4 text-danger">{errorText(query.error)}</p>}
      {query.isLoading && <p className="mt-4 text-stone" aria-busy="true">Loading…</p>}
      {query.data && pieces.length === 0 && <p className="mt-4 text-stone">No pieces are on sale yet.</p>}

      <ol className="mt-4 space-y-2">
        {pieces.map((p, i) => (
          <li
            key={p.id}
            draggable
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging !== null) shift(dragging, i);
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            className={`flex items-center gap-3 border bg-card p-2 text-sm ${dragging === i ? "border-ink opacity-60" : "border-line"} cursor-grab`}
          >
            <span className="w-7 text-center font-semibold text-stone">{i + 1}</span>
            {p.image ? (
              <img src={photoUrl(p.image, 320)} alt="" width={48} height={60} className="h-15 w-12 bg-studio object-cover" />
            ) : (
              <span className="grid h-15 w-12 place-items-center bg-studio text-[10px] text-stone">No photo</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.name}</span>
              <span className="text-xs text-stone">{p.category}{!p.inStock && " · Sold out (shows last on the store)"}</span>
            </span>
            <span className="flex gap-1">
              <button type="button" className="btn btn-outline h-9 px-3" aria-label={`Move ${p.name} to the top`} disabled={i === 0} onClick={() => shift(i, 0)}>⤒</button>
              <button type="button" className="btn btn-outline h-9 px-3" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => shift(i, i - 1)}>↑</button>
              <button type="button" className="btn btn-outline h-9 px-3" aria-label={`Move ${p.name} down`} disabled={i === pieces.length - 1} onClick={() => shift(i, i + 1)}>↓</button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
