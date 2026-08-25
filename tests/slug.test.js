const { test } = require('node:test');
const assert = require('node:assert');
const { slug } = require('../scripts/lib/slug');

test('slug flattens ids to safe filenames', () => {
  assert.strictEqual(slug('http.POST./api/orders/{id}/ship'), 'http-post-api-orders-id-ship');
  assert.strictEqual(slug('queue.order.shipped'), 'queue-order-shipped');
  assert.strictEqual(slug('--Weird__Id--'), 'weird-id');
});
