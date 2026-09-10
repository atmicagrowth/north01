import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/**
 * **Plan §27.1b's environment**, and the three browser APIs jsdom does not implement.
 *
 * Each stub below exists because a Radix primitive or a component in this project calls it and jsdom
 * throws. They are stubs, not behaviour: a test that needs to assert *what* an observer saw should
 * assert the rendered result instead, which is what Testing Library is for.
 */

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/* Radix uses it for collision detection; jsdom has no layout. */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    disconnect() {}
    observe() {}
    takeRecords() {
      return []
    }
    unobserve() {}
  } as unknown as typeof IntersectionObserver
}

/* `matchMedia` is read by anything that branches on a breakpoint. */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
    writable: true,
  })
}

/* Radix's Dialog/Popover call these on open; jsdom implements neither. */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
