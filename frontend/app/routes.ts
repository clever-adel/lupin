import { index, route, type RouteConfig } from "@react-router/dev/routes";

// English at /…, Arabic at /ar/…. The layout loader rejects any other first segment with a 404.
export default [
  route("sitemap.xml", "routes/sitemap.tsx"),
  route("robots.txt", "routes/robots.tsx"),
  route("catalog/meta.csv", "routes/catalog-meta.tsx"),
  // Staff dashboard. English only for now; a static segment, so it wins over the optional :lang below.
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/orders.tsx"),
    route("orders/:reference", "routes/admin/order.tsx"),
    route("transfers", "routes/admin/transfers.tsx"),
    route("customers", "routes/admin/customers.tsx"),
    route("shop", "routes/admin/shop.tsx"),
    route("products", "routes/admin/products.tsx"),
    route("products/:id", "routes/admin/product.tsx"),
    route("looks", "routes/admin/looks.tsx"),
    route("looks/:id", "routes/admin/look.tsx"),
    route("promotions", "routes/admin/promotions.tsx"),
    route("content", "routes/admin/content.tsx"),
    route("staff", "routes/admin/staff.tsx"),
    route("settings", "routes/admin/settings.tsx"),
  ]),
  route(":lang?", "routes/store/layout.tsx", [
    index("routes/store/home.tsx"),
    route("shop/:department?", "routes/store/shop.tsx"),
    route("product/:slug", "routes/store/product.tsx"),
    route("looks", "routes/store/looks.tsx"),
    route("looks/:slug", "routes/store/look.tsx"),
    route("bag", "routes/store/bag.tsx"),
    route("sign-in", "routes/store/sign-in.tsx"),
    route("reset-password", "routes/store/reset-password.tsx"),
    route("account", "routes/store/account.tsx"),
    route("faq", "routes/store/faq.tsx"),
    route("policies/:slug", "routes/store/policy.tsx"),
    route("checkout", "routes/store/checkout.tsx"),
    route("orders/:reference", "routes/store/order.tsx"),
  ]),
] satisfies RouteConfig;
