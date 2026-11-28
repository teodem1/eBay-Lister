/**
 * The seller accepts Best Offer, so buyers offer below the listed price. A lowered price is listed
 * high enough that a typical offer lands on the sales-based target (seller, 2026-11-28); the skill's
 * reprice.py does the same. Raises are untouched.
 */
export const OFFER_SHARE = 0.85;

export function offerRoom(current: number | null, target: number | null): number | null {
  if (target === null || current === null || target >= current) return target;
  return Math.min(Math.round(current * 100) / 100, Math.round((target / OFFER_SHARE) * 100) / 100);
}
