import type { ChangeEvent, ChangeEventHandler } from "react";

type Props = {
  value: string | number | readonly string[] | undefined | null;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function InputClearButton({
  value,
  onClear,
  disabled = false,
  className = "",
  "aria-label": ariaLabel = "Clear",
}: Props) {
  const hasValue = value != null && String(value).length > 0;
  if (!hasValue || disabled) return null;

  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClear();
      }}
      className={[
        "interactive-press inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
        "text-white/55 hover:bg-white/10 hover:text-white/90",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
    >
      <img
        src="/launcher-assets/toggle_close.png"
        alt=""
        className="h-3.5 w-3.5 object-contain opacity-80"
        draggable={false}
      />
    </button>
  );
}

export function clearInputValue(onChange?: ChangeEventHandler<HTMLInputElement>): void {
  if (!onChange) return;
  const target = { value: "" } as HTMLInputElement;
  onChange({
    target,
    currentTarget: target,
  } as ChangeEvent<HTMLInputElement>);
}
