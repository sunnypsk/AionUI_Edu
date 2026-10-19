import React, { useId, useLayoutEffect, useRef } from 'react';
import { useTheme } from '@openuidev/react-ui';
import styles from './OpenUI.module.css';

/** Namespace the pinned library's field/label IDs across independent programs and their portals. */
export default function FieldScope({ children, disabled }: { children: React.ReactNode; disabled: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const prefix = 'openui-' + useId().replace(/[^\w-]/g, '') + '-';
  const { portalThemeClassName } = useTheme();
  useLayoutEffect(() => {
    if (!root.current) return;
    const scopes = new Set<Element>([root.current]);
    const namespace = () => {
      for (const scope of scopes) {
        const fields = Array.from(scope.querySelectorAll<HTMLElement>('[id]'));
        for (const label of scope.querySelectorAll<HTMLLabelElement>('label[for]')) {
          const name = label.htmlFor;
          if (!name || name.startsWith(prefix)) continue;
          const target = fields.find((field) => field.id === name || field.id === prefix + name);
          if (!target) continue;
          target.id = prefix + name;
          label.htmlFor = target.id;
        }
      }
    };
    const scoped = new MutationObserver(namespace);
    const discover = () => {
      for (const scope of scopes) if (!scope.isConnected) scopes.delete(scope);
      for (const portal of document.getElementsByClassName(portalThemeClassName)) scopes.add(portal);
      const modalOpen = Array.from(scopes).some((scope) => scope.classList.contains('openui-modal-root'));
      for (const scope of scopes)
        if (scope !== root.current)
          scope.classList.toggle(styles.modalPopup, modalOpen && !scope.classList.contains('openui-modal-root'));
      scoped.disconnect();
      for (const scope of scopes)
        scoped.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ['id', 'for'] });
      namespace();
    };
    // Official portals attach to body; keep detached portals out of the observer set.
    const portals = new MutationObserver(discover);
    portals.observe(document.body, { childList: true });
    discover();
    return () => {
      scoped.disconnect();
      portals.disconnect();
    };
  }, [prefix, portalThemeClassName]);
  return (
    <div ref={root} inert={disabled}>
      {children}
    </div>
  );
}
