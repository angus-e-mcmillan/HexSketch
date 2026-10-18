/**
 * Menus: the menu bar's drop-downs and the right-click context menu, with
 * submenus, check marks, shortcuts and panels (colour swatches) as items.
 * One look for both, like the Mac menus ChemDraw uses.
 */
export type MenuItem =
  | 'sep'
  | { heading: string }
  | {
      label: string;
      /** Shown on the right, e.g. "⌘S". */
      shortcut?: string;
      /** Small icon (SVG markup) before the label. */
      icon?: string;
      run?: () => void;
      enabled?: boolean;
      checked?: boolean;
      submenu?: () => MenuItem[];
      /** A custom panel instead of a list (swatches); call close() when done. */
      panel?: (panel: HTMLElement, close: () => void) => void;
    };

let openRoot: { close: () => void } | null = null;

/** Close whatever menu is open. */
export function closeMenus(): void { openRoot?.close(); }

/**
 * Open a menu at a point (context menu) or under an element (menu bar).
 * Returns a handle to close it; opening another menu closes this one.
 */
export function openMenu(items: MenuItem[], at: { x: number; y: number } | HTMLElement, onClose?: () => void): { close: () => void } {
  closeMenus();
  const panels: HTMLElement[] = [];
  const close = () => {
    for (const p of panels) p.remove();
    panels.length = 0;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys, true);
    window.removeEventListener('blur', close);
    if (openRoot === handle) openRoot = null;
    onClose?.();
  };
  const outside = (e: Event) => {
    const t = e.target as Node;
    if (panels.some((p) => p.contains(t))) return;
    if (at instanceof HTMLElement && at.contains(t)) return;
    close();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };

  /** Show a list (or panel) at depth `level`, dropping deeper ones. */
  const show = (list: MenuItem[], x: number, y: number, level: number, side: { left: number } | null = null): HTMLElement => {
    for (const p of panels.splice(level)) p.remove();
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.setAttribute('role', 'menu');
    for (const item of list) {
      if (item === 'sep') { panel.append(Object.assign(document.createElement('div'), { className: 'menu-sep' })); continue; }
      if ('heading' in item) { panel.append(Object.assign(document.createElement('div'), { className: 'menu-heading', textContent: item.heading })); continue; }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'menu-row';
      row.setAttribute('role', item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
      if (item.checked !== undefined) row.setAttribute('aria-checked', String(item.checked));
      const disabled = item.enabled === false;
      row.disabled = disabled;
      row.innerHTML = `<span class="menu-check">${item.checked ? '✓' : ''}</span>${item.icon ? `<span class="menu-icon">${item.icon}</span>` : ''}<span class="menu-label"></span><span class="menu-key"></span>`;
      row.querySelector('.menu-label')!.textContent = item.label;
      row.querySelector('.menu-key')!.textContent = item.submenu || item.panel ? '›' : item.shortcut ?? '';
      const opensChild = !!(item.submenu || item.panel);
      const openChild = () => {
        if (disabled) return;
        for (const r of Array.from(panel.querySelectorAll('.menu-row.open'))) r.classList.remove('open');
        row.classList.add('open');
        const r = row.getBoundingClientRect();
        if (item.submenu) show(item.submenu(), r.right - 2, r.top - 5, level + 1, { left: r.left });
        else {
          for (const p of panels.splice(level + 1)) p.remove();
          const sub = document.createElement('div');
          sub.className = 'menu-panel menu-custom';
          item.panel!(sub, close);
          place(sub, r.right - 2, r.top - 5, { left: r.left });
          panels.push(sub);
        }
      };
      row.addEventListener('pointerenter', () => {
        if (opensChild) openChild();
        else { for (const p of panels.splice(level + 1)) p.remove(); for (const r of Array.from(panel.querySelectorAll('.menu-row.open'))) r.classList.remove('open'); }
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (disabled) return;
        if (opensChild) { openChild(); return; }
        close();
        item.run?.();
      });
      panel.append(row);
    }
    place(panel, x, y, side);
    panels.push(panel);
    return panel;
  };

  /** Put a panel on screen at (x, y), flipping left of `side` when it would run off the right. */
  const place = (panel: HTMLElement, x: number, y: number, side: { left: number } | null) => {
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    document.body.append(panel);
    const r = panel.getBoundingClientRect();
    if (r.right > innerWidth - 4) panel.style.left = `${Math.max(4, side ? side.left - r.width + 2 : innerWidth - r.width - 4)}px`;
    if (r.bottom > innerHeight - 4) panel.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
  };

  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect();
    show(items, r.left, r.bottom + 2, 0);
  } else show(items, at.x, at.y, 0);
  const handle = { close };
  openRoot = handle;
  // Listen after the event that opened the menu has finished.
  setTimeout(() => {
    if (openRoot !== handle) return;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keys, true);
    window.addEventListener('blur', close);
  });
  return handle;
}

/**
 * A menu bar of titles whose drop-downs are built when opened (so check
 * marks and enabled states are current). Once one is open, moving to another
 * title opens that one, as on the Mac.
 */
export function menuBar(host: HTMLElement, menus: { title: string; items: () => MenuItem[] }[]): void {
  let active: HTMLButtonElement | null = null;
  const open = (b: HTMLButtonElement, items: () => MenuItem[]) => {
    active?.classList.remove('open');
    active = b;
    b.classList.add('open');
    openMenu(items(), b, () => { if (active === b) { b.classList.remove('open'); active = null; } });
  };
  for (const m of menus) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menubar-title';
    b.textContent = m.title;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (active === b) { closeMenus(); return; }
      open(b, m.items);
    });
    b.addEventListener('pointerenter', () => { if (active && active !== b) open(b, m.items); });
    host.append(b);
  }
}
