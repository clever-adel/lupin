import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminReports from "./reports";

const api = vi.fn();
vi.mock("~/lib/http", () => ({ api: (...args: unknown[]) => api(...args) }));

const report = {
  from: "2026-11-01", to: "2026-11-03", totalRevenue: 3500,
  online: { orders: 2, revenue: 2500, itemsRevenue: 2380, deliveryFees: 120, discounts: 100, averageOrder: 1250, cancelled: 1, items: 3 },
  inStore: { sales: 2, returns: 1, revenue: 1000, items: 2 },
  days: [
    { date: "2026-11-01", orders: 1, onlineRevenue: 1000, shopRevenue: 0 },
    { date: "2026-11-02", orders: 0, onlineRevenue: 0, shopRevenue: 1000 },
    { date: "2026-11-03", orders: 1, onlineRevenue: 1500, shopRevenue: 0 },
  ],
  topProducts: [{ name: "The Blackout", quantity: 3, revenue: 2070 }],
  sizes: [{ size: "M", quantity: 3 }, { size: "L", quantity: 1 }],
  paymentMethods: [{ method: "COD", orders: 2, revenue: 2500 }],
};

function show(isOwner: boolean) {
  const router = createMemoryRouter([{ path: "/", element: <Outlet context={{ isOwner }} />, children: [{ index: true, element: <AdminReports /> }] }]);
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); api.mockReset(); });

describe("reports", () => {
  it("shows totals, best sellers, sizes and the spreadsheet link", async () => {
    api.mockResolvedValue(report);
    show(true);
    expect(await screen.findByText("The Blackout")).toBeTruthy();
    expect(screen.getByText("33% of orders")).toBeTruthy();
    expect(screen.getByText("3 · 75%")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Download orders (Excel)" });
    expect(link.getAttribute("href")).toMatch(/^\/api\/v1\/admin\/reports\/orders\.csv\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect(api.mock.calls[0]![1]).toMatch(/^\/api\/v1\/admin\/reports\?from=/);
  });

  it("is for the owner only", () => {
    show(false);
    expect(screen.getByText("Reports are for the owner only.")).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
});
