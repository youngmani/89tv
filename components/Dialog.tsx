"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

interface DialogOptions {
  title: string;
  body: React.ReactNode;
  /** Label for the confirm button. Omit for an alert with a single "OK" button. */
  confirmLabel?: string;
  destructive?: boolean;
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
    <ModalOverlay
      className="modal-overlay"
      isOpen={!!opts}
      onOpenChange={(open) => !open && close(false)}
      isDismissable
    >
      <Modal className="modal">
        <Dialog className="dialog" role={opts?.confirmLabel ? "alertdialog" : "dialog"}>
          {opts && (
            <>
              <Heading slot="title">{opts.title}</Heading>
              <div className="dialog-body">{opts.body}</div>
              <div className="dialog-actions">
                {opts.confirmLabel ? (
                  <>
                    <Button className="btn" onPress={() => close(false)}>
                      Cancel
                    </Button>
                    <Button
                      className={`btn ${opts.destructive ? "danger-solid" : "primary"}`}
                      onPress={() => close(true)}
                      autoFocus
                    >
                      {opts.confirmLabel}
                    </Button>
                  </>
                ) : (
                  <Button className="btn primary" onPress={() => close(true)} autoFocus>
                    OK
                  </Button>
                )}
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );

  return { dialog, ask };
}
