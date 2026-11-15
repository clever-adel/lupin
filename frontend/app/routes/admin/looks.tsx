import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { errorText, type AdminLookRow } from "~/features/admin/shared";
import { api } from "~/lib/http";

const STATUS: Record<string, string> = { DRAFT: "Draft (hidden)", PUBLISHED: "On the store" };

/** Every look, with what still stops it from appearing on the store. */
export default function AdminLooks() {
  const looks = useQuery({ queryKey: ["admin", "looks"], queryFn: () => api<AdminLookRow[]>("GET", "/api/v1/admin/looks") });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-2xl">Looks</h1>
          <p className="mt-2 max-w-2xl text-sm text-stone">
            A look is a complete outfit from your products, shown on one model photo with “Shop the look”. Customers can add
            every piece in one click. A look appears on the store once it has an approved photo and is published.
          </p>
        </div>
        <Link to="/admin/looks/new" className="btn btn-primary">New look</Link>
      </div>

      {looks.isError && <p role="alert" className="mt-6 text-danger">{errorText(looks.error)}</p>}
      {looks.isPending && <p className="mt-6 text-stone" aria-busy="true">Loading…</p>}
      {looks.data?.length === 0 && <p className="mt-6 text-stone">No looks yet. Create the first one.</p>}

      {looks.data && looks.data.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {looks.data.map((look) => (
            <li key={look.id} className="border border-line bg-card">
              <Link to={`/admin/looks/${look.id}`} className="block">
                {look.imageUrl ? (
                  <img src={look.imageUrl} alt="" className="aspect-[2/3] w-full bg-studio object-cover" />
                ) : (
                  <div className="grid aspect-[2/3] w-full place-items-center bg-studio text-xs text-stone">No photo yet</div>
                )}
                <div className="p-3">
                  <p className="font-semibold">{look.titleEn}</p>
                  <p className="mt-1 text-xs text-stone">
                    {look.itemCount} pieces · {STATUS[look.status]}
                    {look.imageSource === "AI" && " · AI photo"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
