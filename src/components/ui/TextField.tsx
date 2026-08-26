import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  pill?: boolean;
};

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { className = "", pill = false, disabled, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      disabled={disabled}
      className={[
        "ui-body w-full border bg-black/40 text-white outline-none transition-colors",
        "placeholder:text-white/40",
        "focus:border-white/25",
        "disabled:cursor-not-allowed disabled:opacity-60",
        pill ? "rounded-full px-4 py-2.5" : "rounded-xl px-3 py-2.5",
        "border-white/12",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
});
