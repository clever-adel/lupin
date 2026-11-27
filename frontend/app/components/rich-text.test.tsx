import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RichText } from "./rich-text";

afterEach(cleanup);
const html = (text: string) => render(<div><RichText text={text} /></div>).container.innerHTML;

describe("rich text for policies and FAQ", () => {
  it("keeps old plain text as paragraphs with line breaks", () => {
    expect(html("First line\nsecond line\n\nNew paragraph")).toBe("<div><p>First line<br>second line</p><p>New paragraph</p></div>");
  });

  it("turns marks into headings, lists, bold and links", () => {
    const out = html("## Returns\n- Within **24 hours**\n- See [delivery](/policies/delivery)\n\n1. Call us\n2. Send it back");
    expect(out).toContain("<h3 class=\"pt-2 font-semibold\">Returns</h3>");
    expect(out).toContain("<li>Within <strong>24 hours</strong></li>");
    expect(out).toContain("<a href=\"/policies/delivery\" class=\"underline underline-offset-2\">delivery</a>");
    expect(out).toContain("<ol class=\"list-decimal space-y-1 ps-6\"><li>Call us</li><li>Send it back</li></ol>");
  });

  it("opens outside links in a new tab", () => {
    expect(html("[WhatsApp](https://wa.me/201000000000)")).toContain("target=\"_blank\" rel=\"noopener noreferrer\"");
  });

  it("never runs HTML or unsafe links", () => {
    const out = html("<img src=x onerror=alert(1)> [click](javascript:alert(1)) [x](//evil.example)");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("href=\"javascript");
    expect(out).not.toContain("href=\"//evil");
    expect(out).toContain("&lt;img");
  });
});
