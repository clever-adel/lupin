import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SizesAndStock } from "./sizes-stock";

const api = vi.fn();
vi.mock("~/lib/http", () => ({ api: (...args: unknown[]) => api(...args) }));

const variants = [
  { variantId: 1, color: "Black", sizeCode: "S", sku: "LP-1", onHand: 2, reserved: 0, available: 2 },
  { variantId: 2, color: "Black", sizeCode: "M", sku: "LP-2", onHand: 0, reserved: 0, available: 0 },
];

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SizesAndStock productId={7} sizes={["S", "M"]} colours={[{ id: 11, nameEn: "Black" }]} variants={variants}
        sizeOptions={["XS", "S", "M", "L", "XL"]} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.mockReset();
});

describe("sizes and stock while editing", () => {
  it("shows every colour and size with its stock", () => {
    show();
    expect(screen.getByText(/Sold in:/).textContent).toContain("S · M");
    expect(screen.getByRole("rowheader", { name: /Black · S/ })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: /Black · M/ })).toBeTruthy();
  });

  it("offers only the sizes not sold yet and adds one with its stock", async () => {
    api.mockResolvedValue({ variantIds: [3] });
    show();
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Choose…", "XS", "L", "XL"]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "L" } });
    fireEvent.change(screen.getByLabelText("Stock · Black"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add size L" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/v1/admin/products/7/sizes", { sizeCode: "L", stockByColor: { 11: 5 } }));
    expect(await screen.findByText("Size added.")).toBeTruthy();
  });
});
