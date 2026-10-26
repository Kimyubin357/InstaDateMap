type AppEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone?: boolean;
  displayModeStandalone: boolean;
};

const BACK_EDGE_WIDTH = 20;
const NATIVE_CONTROLS = 'a[href],button,input,textarea,select,summary,label,[role="button"],[contenteditable]:not([contenteditable="false"])';
const BACK_ALLOWED_PAGES = new Set(["/settings", "/add", "/settings/trash"]);

export function allowsEdgeBack(pathname: string, overlayOpen = false) {
  return !overlayOpen && BACK_ALLOWED_PAGES.has(pathname);
}

export function isStandaloneIOS(environment: AppEnvironment) {
  const ios = /iPhone|iPad|iPod/.test(environment.userAgent)
    || environment.platform === "MacIntel" && environment.maxTouchPoints > 1;
  return ios && (environment.standalone === true || environment.displayModeStandalone);
}

/** Suppress Safari's edge gesture where it supplies a cancelable DOM touch event. */
export function installEdgeBackGuard(root: EventTarget, environment: AppEnvironment, allowBack: () => boolean = () => false) {
  if (!isStandaloneIOS(environment)) return () => {};

  const onTouchStart = (event: Event) => {
    // Read on every gesture: shell navigation updates history without remounting this guard.
    if (allowBack()) return;
    const touchEvent = event as TouchEvent;
    if (!touchEvent.cancelable || touchEvent.defaultPrevented
      || touchEvent.touches.length !== 1 || touchEvent.changedTouches.length !== 1) return;
    const x = touchEvent.touches[0].clientX;
    if (!Number.isFinite(x) || x < 0 || x > BACK_EDGE_WIDTH) return;
    // Canceling touchstart suppresses native taps too: keep controls and text editing usable.
    if (touchEvent.target instanceof Element && touchEvent.target.closest(NATIVE_CONTROLS)) return;
    touchEvent.preventDefault();
    // Keep propagation so map and sheet handlers still receive their touch sequence.
  };

  // A non-passive start listener is needed before iOS commits to its history gesture.
  root.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
  return () => root.removeEventListener("touchstart", onTouchStart, { capture: true });
}
