/**
 * How far a bag is from free delivery: the amount still to add and the share reached (0 to 1).
 * Null when the shop has no free-delivery threshold or the bag is empty.
 */
export function freeDeliveryProgress(subtotal: number, threshold: number | null | undefined) {
  if (!threshold || threshold <= 0 || !(subtotal > 0)) return null;
  const left = Math.max(0, Math.round((threshold - subtotal) * 100) / 100);
  return { left, share: Math.min(1, subtotal / threshold) };
}
