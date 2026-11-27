import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductReviews, RateYourPieces } from "./reviews";

const api = vi.fn();
vi.mock("~/lib/http", async (original) => ({ ...(await original<object>()), api: (...args: unknown[]) => api(...args) }));

function show(node: ReactNode) {
  const router = createMemoryRouter([{ path: "/:lang?", element: node }]);
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); api.mockReset(); });

describe("reviews", () => {
  it("shows nothing on a product until a review is published", async () => {
    api.mockResolvedValue({ count: 0, average: 0, reviews: [] });
    show(<ProductReviews slug="the-blackout" />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByText("Reviews")).toBeNull();
  });

  it("shows the average and each published review", async () => {
    api.mockResolvedValue({ count: 2, average: 4.5, reviews: [
      { id: 1, rating: 5, body: "Perfect fit", name: "Ahmed M.", createdAt: "2026-11-20T10:00:00Z" },
      { id: 2, rating: 4, body: "", name: "Mona", createdAt: "2026-11-21T10:00:00Z" },
    ] });
    show(<ProductReviews slug="the-blackout" />);
    expect(await screen.findByText("Perfect fit")).toBeTruthy();
    expect(screen.getByText("4.5")).toBeTruthy();
    expect(screen.getByText("· 2 reviews")).toBeTruthy();
  });

  it("lets the customer rate a delivered piece", async () => {
    api.mockImplementation((method: string) => Promise.resolve(method === "GET"
      ? [{ orderItemId: 9, nameEn: "The Blackout", nameAr: "ذا بلاك آوت", color: "Black", size: "L" }]
      : { id: 1 }));
    show(<RateYourPieces reference="LP-1" />);
    expect(await screen.findByText("Rate your pieces")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send review" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "4 out of 5 stars" }));
    fireEvent.change(screen.getByPlaceholderText(/How is the fit/), { target: { value: " Great " } });
    fireEvent.click(send);
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/v1/reviews", { orderItemId: 9, rating: 4, body: "Great" }));
  });
});
