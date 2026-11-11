import { index, route, type RouteConfig } from "@react-router/dev/routes";

// English at /…, Arabic at /ar/…. The layout loader rejects any other first segment with a 404.
export default [
  route("sitemap.xml", "routes/sitemap.tsx"),
  route("robots.txt", "routes/robots.tsx"),
  // Staff dashboard. English only for now; a static segment, so it wins over the optional :lang below.
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/orders.tsx"),
    route("orders/:reference", "routes/admin/order.tsx"),
    route("transfers", "routes/admin/transfers.tsx"),
    route("products", "routes/admin/products.tsx"),
    route("products/:id", "routes/admin/product.tsx"),
    route("promotions", "routes/admin/promotions.tsx"),
    route("content", "routes/admin/content.tsx"),
    route("staff", "routes/admin/staff.tsx"),
    route("settings", "routes/admin/settings.tsx"),
  ]),
  route(":lang?", "routes/store/layout.tsx", [
    index("routes/store/home.tsx"),
    route("shop/:department?", "routes/store/shop.tsx"),
    route("product/:slug", "routes/store/product.tsx"),
    route("bag", "routes/store/bag.tsx"),
    route("sign-in", "routes/store/sign-in.tsx"),
    route("account", "routes/store/account.tsx"),
    route("faq", "routes/store/faq.tsx"),
    route("policies/:slug", "routes/store/policy.tsx"),
    route("checkout", "routes/store/checkout.tsx"),
    route("orders/:reference", "routes/store/order.tsx"),
  ]),
] satisfies RouteConfig;
