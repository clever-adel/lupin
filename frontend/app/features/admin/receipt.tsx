/**
 * The customer's transfer screenshot. Served only to staff by the API (never from the public /media
 * store), so it can be opened full size in a new tab while checking the bank or wallet app.
 */
export function TransferReceipt({ paymentId, size = "md" }: { paymentId: string; size?: "sm" | "md" }) {
  const src = `/api/v1/admin/payments/${encodeURIComponent(paymentId)}/receipt`;
  return (
    <a href={src} target="_blank" rel="noopener" className="inline-block" title="Open the screenshot full size">
      <img
        src={src}
        alt="Transfer screenshot from the customer"
        loading="lazy"
        className={`${size === "sm" ? "h-20" : "h-40"} w-auto max-w-[12rem] border border-line bg-white object-contain`}
      />
      <span className="mt-1 block text-xs underline">Open screenshot</span>
    </a>
  );
}
