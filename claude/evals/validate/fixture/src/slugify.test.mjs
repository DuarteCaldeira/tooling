import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './slugify.mjs';

test('slugify joins words with hyphens', () => {
  assert.equal(slugify(' Hello World '), 'hello-world');
});
