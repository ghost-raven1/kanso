import { expect, it } from 'vitest';
import { renderToString } from 'solid-js/web';
import { Dialog, type DialogProps } from '@kanso/core/overlays';
import { lockScroll } from '../packages/core/src/overlays/scroll-lock.js';
import { installDOM } from './dom-environment.js';

installDOM();

it('does not evaluate modal children or browser refs during SSR, even when open', () => {
  expect(renderToString(() => Dialog({
    open: true, 'aria-label': 'Editor', onClose() {},
    initialFocus() { throw new Error('browser reference'); },
    get children(): never { throw new Error('browser child'); },
  }))).toBe('');
});

it('restores inline scroll styles only after the last document lock is released', () => {
  document.body.style.setProperty('overflow', 'scroll', 'important');
  const first = lockScroll(document), second = lockScroll(document);
  expect(document.body.style.overflow).toBe('hidden');
  first(); first();
  expect(document.body.style.overflow).toBe('hidden');
  second();
  expect(document.body.style.overflow).toBe('scroll');
  expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  expect(document.documentElement.style.overflow).toBe('');
  document.body.removeAttribute('style');
});

// A modal needs an accessible name and a controlled close callback.
const valid: DialogProps = { open: true, 'aria-labelledby': 'heading', onClose() {} };
// @ts-expect-error Missing accessible name.
const unnamed: DialogProps = { open: true, onClose() {} };
void valid; void unnamed;
