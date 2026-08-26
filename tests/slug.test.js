const { test } = require('node:test');
const assert = require('node:assert');
const { slug } = require('../scripts/lib/slug');

test('slug flattens ids to safe filenames', () => {
  assert.strictEqual(slug('http.POST./api/orders/{id}/ship'), 'http-post-api-orders-id-ship');
  assert.strictEqual(slug('queue.order.shipped'), 'queue-order-shipped');
  assert.strictEqual(slug('--Weird__Id--'), 'weird-id');
});

// slug() names .archie/flows/<slug>.json, so these pin the exact filename for the
// shapes that actually reach it: runs of separators, non-ASCII, and nothing left.
test('slug collapses runs and trims both ends to exactly one dash', () => {
  assert.strictEqual(slug('a///b'), 'a-b');
  assert.strictEqual(slug('...lead'), 'lead');
  assert.strictEqual(slug('trail...'), 'trail');
  assert.strictEqual(slug('---a---b---'), 'a-b');
  assert.strictEqual(slug('a-b'), 'a-b');
});

test('slug yields an empty name when nothing survives, rather than a stray dash', () => {
  assert.strictEqual(slug(''), '');
  assert.strictEqual(slug('-'), '');
  assert.strictEqual(slug('----'), '');
  assert.strictEqual(slug('///'), '');
});

test('slug drops non-ASCII rather than passing it into a filename', () => {
  assert.strictEqual(slug('sipariş'), 'sipari');   // the trailing ş becomes a dash, then is trimmed
  assert.strictEqual(slug('app/sipariş.php'), 'app-sipari-php');
  assert.strictEqual(slug('Ünlü'), 'nl');
});
