(() => {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const findCitationRoot = () => {
    const heading = Array.from(document.querySelectorAll('h1,h2,h3')).find((el) =>
      normalize(el.textContent).includes('citaciones para reconocimiento médico')
    );
    if (!heading) return null;
    return heading.closest('.space-y-8') || heading.closest('main') || heading.parentElement?.parentElement || document.body;
  };

  const findByText = (root, selector, text) => {
    const target = normalize(text);
    return Array.from(root.querySelectorAll(selector)).find((el) => normalize(el.textContent) === target) || null;
  };

  const hideButton = (root, text) => {
    const button = findByText(root, 'button', text);
    if (button) {
      button.style.display = 'none';
      button.setAttribute('aria-hidden', 'true');
      button.tabIndex = -1;
    }
    return button;
  };

  const renameButton = (root, from, to) => {
    const button = findByText(root, 'button', from);
    if (!button) return;
    const textNodes = Array.from(button.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && normalize(node.textContent));
    const span = Array.from(button.querySelectorAll('span')).find((el) => normalize(el.textContent) === normalize(from));
    if (span) {
      span.textContent = to;
      return;
    }
    if (textNodes.length) {
      textNodes[textNodes.length - 1].textContent = ` ${to}`;
      return;
    }
    const icon = button.querySelector('svg');
    button.textContent = '';
    if (icon) button.appendChild(icon);
    button.appendChild(document.createTextNode(` ${to}`));
  };

  const hideCardContainingText = (root, text) => {
    const target = normalize(text);
    const candidate = Array.from(root.querySelectorAll('h2,h3,h4,h5,h6,p,span,div,button')).find((el) => {
      const value = normalize(el.textContent);
      return value === target || value.startsWith(target);
    });
    if (!candidate) return;

    if (candidate.tagName === 'BUTTON') {
      const controlled = candidate.getAttribute('aria-controls');
      candidate.style.display = 'none';
      candidate.setAttribute('aria-hidden', 'true');
      candidate.tabIndex = -1;
      if (controlled) {
        const panel = document.getElementById(controlled);
        if (panel) panel.style.display = 'none';
      }
      const sibling = candidate.nextElementSibling;
      if (sibling && normalize(sibling.textContent).length > 0 && normalize(sibling.textContent).length < 2500) {
        sibling.style.display = 'none';
      }
      return;
    }

    let block = candidate;
    for (let i = 0; i < 5 && block.parentElement; i += 1) {
      const parent = block.parentElement;
      const className = String(parent.className || '');
      const textLength = normalize(parent.textContent).length;
      if ((/ui-surface|rounded|border|card|section/i.test(className) || ['SECTION', 'FIELDSET'].includes(parent.tagName)) && textLength < 3500) {
        block = parent;
        break;
      }
      block = parent;
    }
    if (block && block !== root) block.style.display = 'none';
  };

  const apply = () => {
    const root = findCitationRoot();
    if (!root) return;

    // Navegación principal de Citaciones.
    hideButton(root, 'Reconocimientos Médicos (IA PDF)');
    renameButton(root, 'Planificar Citas (IA)', 'Planificador automático de citas');

    // Selector interno: se prioriza el flujo automático.
    renameButton(root, 'Asistente con IA', 'Asistente automático');
    hideButton(root, 'Generador Manual');

    // Acción principal del planificador automático.
    renameButton(root, 'Organizar e Imprimir con IA', 'Generar y descargar citas automáticas');

    // Bloques que ya no aportan valor en esta pantalla.
    hideCardContainingText(root, 'Simulación de Horarios (Intervalos sugeridos)');
    hideCardContainingText(root, 'Jornada laboral');
  };

  let scheduled = false;
  const scheduleApply = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleApply, { once: true });
  } else {
    scheduleApply();
  }

  new MutationObserver(scheduleApply).observe(document.documentElement, { childList: true, subtree: true });
})();
