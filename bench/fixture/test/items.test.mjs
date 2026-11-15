import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCents, formatItem, lineTotalCents, makeItem, totalCents } from '../src/index.mjs';

test('makeItem trims the name and fills defaults', () => {
  assert.deepEqual(makeItem({ name: ' milk ', priceCents: 199 }), {
    name: 'milk',
    category: 'other',
    priceCents: 199,
    quantity: 1,
  });
});

test('makeItem rejects bad input', () => {
  assert.throws(() => makeItem({ name: '', priceCents: 1 }), /name is required/);
  assert.throws(() => makeItem({ name: 'a', priceCents: -1 }), /priceCents/);
  assert.throws(() => makeItem({ name: 'a', priceCents: 1, quantity: 0 }), /quantity/);
});

test('totals add up quantity times price', () => {
  const items = [makeItem({ name: 'a', priceCents: 250, quantity: 2 }), makeItem({ name: 'b', priceCents: 5 })];
  assert.equal(lineTotalCents(items[0]), 500);
  assert.equal(totalCents(items), 505);
  assert.equal(totalCents([]), 0);
});

test('formatting shows dollars and cents', () => {
  assert.equal(formatCents(505), '$5.05');
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatItem(makeItem({ name: 'tea', priceCents: 350, quantity: 2 })), '2 x tea @ $3.50');
});
