export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

export type PendingConfirm = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

type Listener = (current: PendingConfirm | null) => void;

const queue: PendingConfirm[] = [];
let listener: Listener | null = null;

function publish() {
  listener?.(queue[0] ?? null);
}

export function subscribeConfirm(next: Listener): () => void {
  listener = next;
  publish();
  return () => {
    if (listener === next) listener = null;
  };
}

export function settleConfirm(confirmed: boolean) {
  const current = queue.shift();
  current?.resolve(confirmed);
  publish();
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue.push({ ...options, resolve });
    if (queue.length === 1) publish();
  });
}
