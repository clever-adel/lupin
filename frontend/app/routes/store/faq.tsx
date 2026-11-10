import type { Route } from "./+types/faq";
import { Paragraphs } from "./policy";
import { apiGet } from "~/lib/api.server";
import { toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { Faq } from "~/lib/types";

export async function loader({ context }: Route.LoaderArgs) {
  return { items: await apiGet<Faq[]>(context, "/api/v1/content/faq") };
}

export function meta({ params, matches, location, data }: Route.MetaArgs) {
  const lang = toLang(params.lang);
  const title = translate(lang, "faq.title");
  const tags = seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title });
  const items = data?.items ?? [];
  if (items.length === 0) return tags;
  const suffix = lang === "ar" ? "Ar" : "En";
  return [
    ...tags,
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item[`question${suffix}`],
          acceptedAnswer: { "@type": "Answer", text: item[`answer${suffix}`] },
        })),
      },
    },
  ];
}

export default function FaqPage({ loaderData }: Route.ComponentProps) {
  const { t, pick } = useT();
  return (
    <div className="shell max-w-3xl pt-10">
      <h1 className="display text-3xl md:text-4xl">{t("faq.title")}</h1>
      {loaderData.items.length === 0 ? (
        <p className="mt-8 text-stone">{t("faq.empty")}</p>
      ) : (
        <div className="mt-8 border-t border-line">
          {loaderData.items.map((item, i) => (
            <details key={i} className="border-b border-line py-4">
              <summary className="cursor-pointer font-semibold">{pick(item, "question")}</summary>
              <div className="mt-3 space-y-3 text-sm leading-relaxed">
                <Paragraphs text={pick(item, "answer")} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
