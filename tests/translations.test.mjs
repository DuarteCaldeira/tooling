import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogues } from '../packages/tooling/checks/translations.mjs';

test('translation parity checks nested keys, interpolation and plural siblings', () => {
  const base = {
    x: { title: 'Hello {{name}}', count_one: 'One {{value}}', count_other: '{{value}} items' },
  };
  base.names = ['First', 'Second'];
  assert.deepEqual(validateCatalogues({ pt: base, en: base }, 'pt'), []);
  const errors = validateCatalogues(
    { pt: base, en: { x: { title: 'Hello {{person}}', count_one: '', extra: 'x' } } },
    'pt',
  );
  assert.ok(errors.some((e) => e.includes('interpolation')));
  assert.ok(errors.some((e) => e.includes('count_other')));
  assert.ok(errors.some((e) => e.includes('extra')));
  assert.ok(errors.some((e) => e.includes('non-empty')));
  assert.deepEqual(
    validateCatalogues({ pt: { long_one: 'A long session' } }, 'pt', {
      pluralExceptions: ['long'],
    }),
    [],
  );
});
