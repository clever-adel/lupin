import type { Route } from "./+types/looks";
import { LookLineup } from "~/components/look";
import { apiGet } from "~/lib/api.server";
import { toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { LookCard } from "~/lib/types";

export async function loader({ context }: Route.LoaderArgs) {
  const looks = await apiGet<LookCard[]>(context, "/api/v1/catalog/looks");
  return { looks };
}

export function meta({ params, matches, location }: Route.MetaArgs) {
  const lang = toLang(params.lang);
  return seo({
    origin: layoutOrigin(matches),
    pathname: location.pathname,
    title: translate(lang, "look.indexTitle"),
    description: translate(lang, "look.indexText"),
  });
}

export default function Looks({ loaderData }: Route.ComponentProps) {
  const { t } = useT();
  const { looks } = loaderData;
  return (
    <div className="shell pt-10">
      <header data-reveal className="max-w-xl">
        <p className="label flex items-center gap-3 text-stone">
          <span aria-hidden="true" className="h-px w-8 bg-gold" />
          {t("look.label")}
        </p>
        <h1 className="display mt-3 text-3xl md:text-4xl">{t("look.indexTitle")}</h1>
        <p className="mt-4 text-stone">{t("look.indexText")}</p>
      </header>
      {looks.length === 0 ? (
        <p className="mt-10 text-stone">{t("look.empty")}</p>
      ) : (
        <div className="mt-10">
          <LookLineup looks={looks} heading={false} />
        </div>
      )}
    </div>
  );
}
