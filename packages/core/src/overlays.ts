import { createComponent, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';
import { Portal } from './portal.js';
import { lockScroll } from './overlays/scroll-lock.js';
import type { CSSProperties } from './types.js';

export type DialogCloseReason = 'escape' | 'backdrop' | 'native';
export type DialogProps = {
  open: boolean;
  /** Close request: set open=false to accept, or leave it true to keep the dialog. */
  onClose: (reason: DialogCloseReason) => void;
  children?: JSX.Element;
  id?: string;
  className?: string;
  style?: CSSProperties;
  role?: 'dialog' | 'alertdialog';
  'aria-describedby'?: string;
  /** Optional explicit initial focus; otherwise the browser uses autofocus/first control. */
  initialFocus?: () => HTMLElement | null | undefined;
  /** Explicit opener, useful in browsers that do not focus buttons on pointer clicks. */
  returnFocus?: () => HTMLElement | null | undefined;
  closeOnBackdrop?: boolean;
} & ({ 'aria-label': string; 'aria-labelledby'?: string } | { 'aria-label'?: string; 'aria-labelledby': string });

/** Controlled, client-only modal. Native top-layer behavior owns focus isolation and Escape. */
export function Dialog(props: DialogProps): JSX.Element {
  if (isServer) return null;
  return Show({
    keyed: false,
    get when() { return props.open; },
    get children() { return createComponent(Portal, { get children() { return createComponent(DialogSurface, props); } }); },
  });
}

function DialogSurface(props: DialogProps): JSX.Element {
  let dialog!: HTMLDialogElement;
  let disposed = false;
  let restore = () => {};
  let trigger: HTMLElement | null = null;
  let backdropPointer = false;
  const request = (reason: DialogCloseReason) => { if (!disposed && props.open) props.onClose(reason); };
  onMount(() => {
    const document = dialog.ownerDocument;
    trigger = props.returnFocus?.() ?? (document.activeElement instanceof document.defaultView!.HTMLElement ? document.activeElement as HTMLElement : null);
    dialog.showModal();
    restore = lockScroll(document);
    const initial = props.initialFocus?.();
    if (initial && dialog.contains(initial)) initial.focus({ preventScroll: true });
  });
  onCleanup(() => {
    disposed = true;
    if (dialog.open) dialog.close();
    restore();
    // Event batches may re-enable the trigger only after this cleanup finishes.
    queueMicrotask(() => {
      const modal = [...dialog.ownerDocument.querySelectorAll<HTMLDialogElement>('dialog:modal')].at(-1);
      if (trigger?.isConnected && (!modal || modal.contains(trigger))) trigger.focus({ preventScroll: true });
    });
  });
  const outside = (event: MouseEvent) => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  return createComponent(Dynamic, {
    component: 'dialog', ref: (element: HTMLDialogElement) => { dialog = element; },
    get id() { return props.id; }, get class() { return props.className; }, get style() { return props.style; },
    get role() { return props.role ?? 'dialog'; }, 'aria-modal': 'true',
    get 'aria-label'() { return props['aria-label']; }, get 'aria-labelledby'() { return props['aria-labelledby']; },
    get 'aria-describedby'() { return props['aria-describedby']; },
    onCancel: (event: Event) => { event.preventDefault(); request('escape'); },
    onClose: () => {
      if (disposed || dialog.open) return;
      request('native');
      // A native method="dialog" form can request closure too. Controlled state remains authoritative.
      queueMicrotask(() => { if (!disposed && props.open && !dialog.open) dialog.showModal(); });
    },
    onPointerDown: (event: PointerEvent) => { backdropPointer = outside(event); },
    onClick: (event: MouseEvent) => {
      if (props.closeOnBackdrop && backdropPointer && outside(event)) request('backdrop');
      backdropPointer = false;
    },
    get children() { return props.children; },
  });
}
