'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, X } from 'lucide-react';
import styles from './ActionDialog.module.css';

export function ActionDialog({ open, onClose, title, children, actions }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.surface}>
        <div className={styles.header}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        </div>
        <div className={styles.content}>{children}</div>
        <div className={styles.actions}>
          {actions || <button type="button" className="btn btn--secondary" onClick={onClose}>Got it</button>}
        </div>
      </div>
    </dialog>, document.body,
  );
}

export function HelpButton({ title, children, label = 'How it works' }: {
  title: string;
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={styles.help} aria-label={`${label}: ${title}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <CircleHelp size={16} aria-hidden="true" /><span>{label}</span>
    </button>
    <ActionDialog open={open} onClose={() => setOpen(false)} title={title}>{children}</ActionDialog>
  </>;
}
