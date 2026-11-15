// An item is { name, category, priceCents, quantity }.

export function makeItem({ name, category = 'other', priceCents, quantity = 1 }) {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('name is required');
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error('priceCents must be a non-negative integer');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('quantity must be a positive integer');
  return { name: name.trim(), category, priceCents, quantity };
}

export function lineTotalCents(item) {
  return item.priceCents * item.quantity;
}

export function totalCents(items) {
  return items.reduce((sum, item) => sum + lineTotalCents(item), 0);
}
