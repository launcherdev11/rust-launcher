import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  padding?: "sm" | "md" | "lg";
};

const paddingClasses = {
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
} as const;

export function Panel({
  children,
  className = "",
  padding = "md",
  ...rest
}: Props) {
  return (
    <div
      className={[
        "glass-panel",
        paddingClasses[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
