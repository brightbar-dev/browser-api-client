import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { IconClose } from './icons';
import { t } from '@/utils/i18n';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
}

/** A modal on the native <dialog>: focus is trapped, Escape closes, the page behind is inert. */
export function Dialog({ title, onClose, children, footer, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useRef(`bac-dialog-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class={`bac-dialog${wide ? ' is-wide' : ''}`}
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div class="bac-dialog-inner">
        <header class="bac-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" class="bac-icon-btn" aria-label={t('dialogClose')} onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <div class="bac-dialog-body">{children}</div>
        {footer && <footer class="bac-dialog-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}
