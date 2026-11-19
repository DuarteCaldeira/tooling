/** Discount for an order total, in the same currency unit. */
export function discount(total: number): number {
  if (total > 100) return total * 0.1;
  return 0;
}
