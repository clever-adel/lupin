import { useEffect } from "react";

/**
 * Shows every [data-reveal] element as it scrolls into view by adding "is-in" (styles in app.css).
 * Watches the page for elements added later (new route, more products), and shows everything at once
 * where IntersectionObserver is missing, so nothing can stay hidden.
 */
export function useScrollReveal() {
  useEffect(() => {
    const show = (el: Element) => el.classList.add("is-in");
    const pending = () => document.querySelectorAll("[data-reveal]:not(.is-in)");

    if (!("IntersectionObserver" in window)) {
      pending().forEach(show);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            show(e.target);
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    const watch = () => pending().forEach((el) => io.observe(el));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}
