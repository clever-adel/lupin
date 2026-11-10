import type { Route } from "./+types/policy";
import { apiGet } from "~/lib/api.server";
import { pick, toLang, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { Policy } from "~/lib/types";

/** Only policies the owner has published exist here; anything else is a 404 from the API. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const policy = await apiGet<Policy>(context, `/api/v1/content/policies/${encodeURIComponent(params.slug)}`);
  return { policy };
}

export function meta({ params, matches, location, data }: Route.MetaArgs) {
  const lang = toLang(params.lang);
  const title = data ? pick(lang, data.policy, "title") : "LUPIN.";
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title });
}

/** Plain text split into paragraphs. The text is never treated as HTML. */
export function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((block, i) => (
        <p key={i} className="whitespace-pre-line">{block.trim()}</p>
      ))}
    </>
  );
}

export default function PolicyPage({ loaderData }: Route.ComponentProps) {
  const { pick: p } = useT();
  return (
    <article className="shell max-w-3xl pt-10">
      <h1 className="display text-3xl md:text-4xl">{p(loaderData.policy, "title")}</h1>
      <div className="mt-8 space-y-4 leading-relaxed">
        <Paragraphs text={p(loaderData.policy, "body")} />
      </div>
    </article>
  );
}
