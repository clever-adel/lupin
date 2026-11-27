import type { Route } from "./+types/policy";
import { apiGet } from "~/lib/api.server";
import { RichText } from "~/components/rich-text";
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
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: summary(data && pick(lang, data.policy, "body"), title) });
}

/** The policy's own opening words as its description, cut at a word boundary near 155 characters. */
function summary(body: string | undefined, fallback: string): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  if (text.length <= 160) return text;
  const cut = text.slice(0, 155);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,.;:]$/, "") + "…";
}

/** Staff-written text with simple marks (headings, lists, bold, links); never treated as HTML. */
export function Paragraphs({ text }: { text: string }) {
  return <RichText text={text} />;
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
