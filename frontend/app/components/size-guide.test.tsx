import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { SizeGuidePanel } from "./size-guide";
import type { SizeGuide } from "~/lib/types";

const guide: SizeGuide = {
  kind: "BODY",
  rows: [{ labelEn: "Chest", labelAr: "الصدر", values: { XXS: "75-78", XS: "78-82", S: "82-90", M: "90-98", L: "98-107", XL: "107-119" } }],
};

function show(department: string) {
  const router = createMemoryRouter([
    { path: "/:lang?", element: <SizeGuidePanel guide={guide} sizes={["XXS", "XS", "S", "M", "L", "XL"]} department={department} /> },
  ]);
  render(<RouterProvider router={router} />);
}

describe("size guide panel", () => {
  it("splits sizes into tabs, switches to inches and explains how to measure", () => {
    show("men");
    expect(screen.getByText("75-78")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "M-XL" }));
    expect(screen.getByText("90-98")).toBeTruthy();
    expect(screen.queryByText("75-78")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "in" }));
    expect(screen.getByText("35½-38½")).toBeTruthy();
    expect(screen.getByText(/measure around the fullest part, keeping/)).toBeTruthy();
    expect(screen.queryByText("International sizes")).toBeNull();
  });

  it("adds the international conversion for women's pieces", () => {
    show("women");
    expect(screen.getByText("International sizes")).toBeTruthy();
  });
});
