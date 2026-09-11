const OVERLAY_SELECTOR = '.profea-modal-overlay, [class~="fixed"][class~="inset-0"]';

const isVisibleModalOverlay = (element: Element): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) return false;
  if (element.classList.contains('lg:hidden')) return false;
  if (element.closest('aside.app-navigation-panel')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const getModalOverlays = () =>
  Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).filter(isVisibleModalOverlay);

const findCloseButton = (overlay: HTMLElement): HTMLButtonElement | null => {
  const buttons = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button'));
  return buttons.find(button => {
    const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`.toLowerCase();
    if (/(cerrar|close|cancelar)/.test(label)) return true;
    return Boolean(button.querySelector('svg.lucide-x'));
  }) || null;
};

const syncModalState = () => {
  document.body.classList.toggle('profea-modal-open', getModalOverlays().length > 0);
};

const closeOpenModalsBeforeNavigation = (event: Event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const sidebarButton = target.closest('aside.app-navigation-panel button');
  if (!sidebarButton) return;

  // Close through each modal's own React onClose handler. This keeps component state
  // consistent instead of deleting DOM nodes behind React's back.
  getModalOverlays().forEach(overlay => findCloseButton(overlay)?.click());
};

let installed = false;

export const installModalRuntime = () => {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('click', closeOpenModalsBeforeNavigation, true);

  const observer = new MutationObserver(syncModalState);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  syncModalState();
};
