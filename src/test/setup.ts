import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  configurable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Radix Select relies on pointer capture APIs that are missing in JSDOM.
if (!Element.prototype.hasPointerCapture) {
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    writable: true,
    configurable: true,
    value: () => false,
  });
}

if (!Element.prototype.setPointerCapture) {
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    writable: true,
    configurable: true,
    value: () => {},
  });
}

if (!Element.prototype.releasePointerCapture) {
  Object.defineProperty(Element.prototype, "releasePointerCapture", {
    writable: true,
    configurable: true,
    value: () => {},
  });
}

if (!Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    writable: true,
    configurable: true,
    value: () => {},
  });
}
