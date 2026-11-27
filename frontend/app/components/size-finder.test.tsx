import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SizeFinder } from "./size-finder";
import type { SizeGuide } from "~/lib/types";

const guide: SizeGuide = {
  kind: "BODY",
  rows: [{ labelEn: "Chest", labelAr: "الصدر", values: { XS: "78-86", S: "86-94", M: "94-102", L: "102-110" } }],
};

function show(available: (s: string) => boolean, onPick = vi.fn()) {
  const router = createMemoryRouter([
    { path: "/:lang?", element: <SizeFinder guide={guide} sizes={["XS", "S", "M", "L"]} department="men" available={available} onPick={onPick} /> },
  ]);
  render(<RouterProvider router={router} />);
  fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "175" } });
  fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "70" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
  return onPick;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("find my size", () => {
  it("suggests a size from height and weight and selects it", () => {
    const onPick = show(() => true);
    expect(screen.getByRole("status").textContent).toContain("M");
    fireEvent.click(screen.getByRole("button", { name: "Choose M" }));
    expect(onPick).toHaveBeenCalledWith("M");
    expect(JSON.parse(localStorage.getItem("lupin.fit") ?? "{}")).toEqual({ height: 175, weight: 70 });
  });

  it("says when the suggested size is sold out", () => {
    show((s) => s !== "M");
    expect(screen.getByText("M is sold out in this colour right now.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose M" })).toBeNull();
  });
});
