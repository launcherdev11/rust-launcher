import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeDisabled?: boolean;
  closeLabel?: string;
  maxWidthClassName?: string;
};

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  closeDisabled = false,
  closeLabel = "Close",
  maxWidthClassName = "w-[min(96vw,26rem)]",
}: Props) {
  const contentRef = useRef({ title, subtitle, children, footer });
  if (open) contentRef.current = { title, subtitle, children, footer };
  const content = contentRef.current;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closeDisabled) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDisabled, onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="ui-modal"
          className="glass-overlay motion-managed pointer-events-auto fixed inset-0 z-[340] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={() => {
            if (!closeDisabled) onClose();
          }}
        >
          <motion.div
            className={`glass-modal pointer-events-auto flex max-h-[min(90vh,40rem)] flex-col overflow-hidden ${maxWidthClassName}`}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: "easeIn" } }}
            transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ui-modal-title"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
              <div className="min-w-0">
                <h2 id="ui-modal-title" className="ui-title text-base">
                  {content.title}
                </h2>
                {content.subtitle ? <p className="ui-meta mt-0.5">{content.subtitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={closeDisabled}
                className="icon-btn -mr-1 disabled:opacity-60"
                aria-label={closeLabel}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-visible px-5 py-4">
              {content.children}
            </div>
            {content.footer ? (
              <div className="flex shrink-0 justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
                {content.footer}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
