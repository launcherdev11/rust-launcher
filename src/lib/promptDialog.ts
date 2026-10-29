export type PromptOptions = {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
};

export type PendingPrompt = PromptOptions & {
  resolve: (value: string | null) => void;
};

type Listener = (current: PendingPrompt | null) => void;

const queue: PendingPrompt[] = [];
let listener: Listener | null = null;

function publish() {
  listener?.(queue[0] ?? null);
}

export function subscribePrompt(next: Listener): () => void {
  listener = next;
  publish();
  return () => {
    if (listener === next) listener = null;
  };
}

export function settlePrompt(value: string | null) {
  const current = queue.shift();
  current?.resolve(value);
  publish();
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    queue.push({ ...options, resolve });
    if (queue.length === 1) publish();
  });
}
