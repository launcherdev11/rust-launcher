import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { InputClearButton, clearInputValue } from "./InputClearButton";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  pill?: boolean;
  clearable?: boolean;
};

const NON_CLEARABLE_TYPES = new Set([
  "checkbox",
  "radio",
  "file",
  "range",
  "hidden",
  "button",
  "submit",
  "reset",
  "image",
  "color",
]);

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { className = "", pill = false, disabled, clearable, type = "text", value, onChange, readOnly, ...rest },
  ref,
) {
  const canClear =
    (clearable ?? !NON_CLEARABLE_TYPES.has(String(type))) &&
    !disabled &&
    !readOnly &&
    typeof onChange === "function";
  const showClear = canClear && value != null && String(value).length > 0;

  return (
    <div className={["relative w-full", className].filter(Boolean).join(" ")}>
      <input
        ref={ref}
        type={type}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        onChange={onChange}
        className={[
          "ui-body w-full border bg-black/40 text-white outline-none transition-colors",
          "placeholder:text-white/40",
          "focus:border-white/25",
          "disabled:cursor-not-allowed disabled:opacity-60",
          pill ? "rounded-full px-4 py-2.5" : "rounded-xl px-3 py-2.5",
          "border-white/12",
          showClear ? "pr-9" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      />
      {showClear ? (
        <InputClearButton
          value={value}
          onClear={() => clearInputValue(onChange)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
        />
      ) : null}
    </div>
  );
});
