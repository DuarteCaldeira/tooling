import test from 'node:test';
import assert from 'node:assert/strict';
import { lockPageScroll } from '../dashboard/src/lib/scroll-lock.js';

function style(initial = {}) {
  const values = new Map(Object.entries(initial).map(([name, value]) => [name, [value, '']]));
  return {
    getPropertyValue: (name) => values.get(name)?.[0] ?? '',
    getPropertyPriority: (name) => values.get(name)?.[1] ?? '',
    setProperty: (name, value, priority = '') => values.set(name, [value, priority]),
    removeProperty: (name) => values.delete(name),
  };
}

test('conversation lock fixes the page, preserves existing styles and restores its scroll once', () => {
  const classes = new Set();
  const body = { style: style({ position: 'relative', top: '2px', width: '95%' }) };
  const html = {
    style: style({ 'scroll-behavior': 'smooth' }),
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  body.style.setProperty('left', '3px', 'important');
  const calls = [];
  const view = {
    scrollX: 12, scrollY: 640,
    scrollTo: (position) => {
      assert.equal(html.style.getPropertyValue('scroll-behavior'), 'auto');
      calls.push(position);
    },
  };
  const unlock = lockPageScroll(view, { body, documentElement: html });
  assert.equal(body.style.getPropertyValue('position'), 'fixed');
  assert.equal(body.style.getPropertyValue('top'), '-640px');
  assert.equal(body.style.getPropertyValue('left'), '-12px');
  assert.equal(html.style.getPropertyValue('overflow'), 'hidden');
  assert.ok(classes.has('conversation-open'));
  unlock();
  unlock();
  assert.deepEqual(calls, [{ left: 12, top: 640, behavior: 'instant' }]);
  assert.equal(body.style.getPropertyValue('position'), 'relative');
  assert.equal(body.style.getPropertyValue('top'), '2px');
  assert.equal(body.style.getPropertyValue('width'), '95%');
  assert.equal(body.style.getPropertyValue('left'), '3px');
  assert.equal(body.style.getPropertyPriority('left'), 'important');
  assert.equal(html.style.getPropertyValue('overflow'), '');
  assert.equal(html.style.getPropertyValue('scroll-behavior'), 'smooth');
  assert.equal(classes.has('conversation-open'), false);
});
