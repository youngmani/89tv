"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

export interface DialogOptions {
  title: string;
  body: React.ReactNode;
  /** Label for the confirm button. Omit for an alert with a single button. */
  confirmLabel?: string;
  /** The single button's label on an alert (default "OK"). */
  okLabel?: string;
  destructive?: boolean;
  /** Whether clicking outside or pressing Escape closes it (default true). */
  dismissable?: boolean;
}

/**
 * Promise-based confirm/alert built on react-aria's Modal (replaces window.confirm/alert).
 * Render `dialog` somewhere, then `await ask({...})`. Resolves true when confirmed.
 */
export function useDialog() {
  const [opts, setOpts] = useState<DialogOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  const ask = useCallback(
    (o: DialogOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );

  const dialog = (
    <ModalShell
      isOpen={!!opts}
      dismissable={opts?.dismissable ?? true}
      alert={!!opts?.confirmLabel}
      onDismiss={() => close(false)}
    >
      {opts && <DialogContent {...opts} onClose={close} />}
    </ModalShell>
  );

  return { dialog, ask };
}

/**
 * The modal around every dialog in the app. `dismissable`: whether clicking outside or pressing Escape closes it
 * (calling `onDismiss`). `alert`: it asks for a decision (role "alertdialog").
 */
export function ModalShell({
  isOpen,
  dismissable,
  alert,
  onDismiss,
  children,
}: {
  isOpen: boolean;
  dismissable: boolean;
  alert: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <ModalOverlay
      className="modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => !open && onDismiss()}
      isDismissable={dismissable}
      isKeyboardDismissDisabled={!dismissable}
    >
      <Modal className="modal">
        <Dialog className="dialog" role={alert ? "alertdialog" : "dialog"}>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** A dialog's title, body and buttons; goes inside react-aria's <Dialog>. */
export function DialogContent({
  title,
  body,
  confirmLabel,
  okLabel,
  destructive,
  onClose,
}: DialogOptions & { onClose: (ok: boolean) => void }) {
  return (
    <>
      <Heading slot="title">{title}</Heading>
      <div className="dialog-body">{body}</div>
      <div className="dialog-actions">
        {confirmLabel ? (
          <>
            <Button className="btn" onPress={() => onClose(false)}>
              Cancel
            </Button>
            <Button
              className={`btn ${destructive ? "danger-solid" : "primary"}`}
              onPress={() => onClose(true)}
              autoFocus
            >
              {confirmLabel}
            </Button>
          </>
        ) : (
          <Button className="btn primary" onPress={() => onClose(true)} autoFocus>
            {okLabel ?? "OK"}
          </Button>
        )}
      </div>
    </>
  );
}
