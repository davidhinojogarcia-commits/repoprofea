const SWIPE_THRESHOLD = 56;
const EDGE_ZONE = 28;

let installed = false;

type SwipeStart = {
  x: number;
  y: number;
  fromSidebar: boolean;
};

const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

const clickFirst = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  element?.click();
};

export const installSidebarSwipe = () => {
  if (installed || !isTouchDevice()) return;
  installed = true;

  let start: SwipeStart | null = null;

  document.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      const target = event.target instanceof Element ? event.target : null;
      start = {
        x: touch.clientX,
        y: touch.clientY,
        fromSidebar: Boolean(target?.closest('.profea-sidebar-shell')),
      };
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    (event) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      if (!touch) {
        start = null;
        return;
      }

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const beganAtEdge = start.x <= EDGE_ZONE;
      const beganInSidebar = start.fromSidebar;
      start = null;

      if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
      if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;

      const desktopLike = window.innerWidth >= 1024;

      if (deltaX > 0) {
        if (desktopLike) {
          clickFirst('.profea-sidebar-shell button[title="Expandir menú"]');
        } else if (beganAtEdge) {
          clickFirst('button[aria-label="Abrir menú"]');
        }
        return;
      }

      if (!beganInSidebar) return;

      if (desktopLike) {
        clickFirst('.profea-sidebar-shell button[title="Colapsar menú"]');
      } else {
        clickFirst('.profea-sidebar-shell button[aria-label="Cerrar menú"]');
      }
    },
    { passive: true },
  );
};
