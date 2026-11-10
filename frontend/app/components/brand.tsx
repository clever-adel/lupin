import { useEffect, useState } from "react";
import { useT } from "~/lib/i18n";

/*
 * Every logo on the site is an untouched crop of the owner's master file
 * (brand-assets/LUPIN — Cap Logo@2x.png), produced by tools/derive-logo-assets.py.
 * Off-white on black only. Never recolour, stretch, outline or add effects.
 */

/** Header logo: the L mark and the cap wordmark, side by side as in the approved header. */
export function HeaderLogo() {
  return (
    <span className="flex items-center gap-2.5 md:gap-3" dir="ltr">
      <img src="/brand/lupin-mark.png" alt="" width={396} height={251} className="h-5 w-auto md:h-6" />
      <img src="/brand/lupin-wordmark.png" alt="LUPIN." width={991} height={124} className="h-[13px] w-auto md:h-[18px]" />
    </span>
  );
}

/** The complete approved lockup: mark, cap wordmark and STEAL THE LOOK. */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <img
      src="/brand/lupin-logo.png"
      alt="LUPIN. Steal the look"
      width={1023}
      height={742}
      className={className}
    />
  );
}

const REPLAY_EVENT = "lupin:replay-intro";

export function replayIntro() {
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

/** Opening animation. Styles and the once-per-session rule live in app.css and root.tsx. */
export function Intro() {
  const { t } = useT();
  const [run, setRun] = useState(0);

  useEffect(() => {
    const skip = () => document.documentElement.classList.add("intro-seen");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") skip();
    };
    const onReplay = () => {
      document.documentElement.classList.remove("intro-seen");
      setRun((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(REPLAY_EVENT, onReplay);
    };
  }, []);

  return (
    <div
      key={run}
      className="intro"
      aria-hidden="true"
      onClick={() => document.documentElement.classList.add("intro-seen")}
      onAnimationEnd={(event) => {
        if (event.animationName === "intro-out") document.documentElement.classList.add("intro-seen");
      }}
    >
      <LogoLockup />
      <span className="intro-skip label">{t("intro.skip")}</span>
    </div>
  );
}
