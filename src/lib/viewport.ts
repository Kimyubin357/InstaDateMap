/** Installed iOS apps can under-report innerHeight / visualViewport; the CSS root uses 100vh there. */
export function layoutViewportHeight() {
  return Math.max(window.innerHeight, document.documentElement.clientHeight,
    Number.parseFloat(getComputedStyle(document.documentElement).height) || 0);
}

export function visibleViewport(layoutHeight: number, visibleHeight: number, offsetTop: number, editable: boolean) {
  const keyboard = editable && layoutHeight - visibleHeight > 120;
  return { keyboard, height: keyboard ? visibleHeight : layoutHeight,
    top: keyboard ? Math.max(0, Math.min(offsetTop, layoutHeight - visibleHeight)) : 0 };
}
