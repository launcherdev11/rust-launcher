import type { ReactNode } from "react";
import { ActionButton } from "./ActionButton";
import { EmptyState } from "./EmptyState";

type Props = {
  title: string;
  description: string;
  ctaLabel: string;
  onSignIn: () => void;
  icon?: ReactNode;
  className?: string;
};

const DEFAULT_ICON = (
  <img
    src="/launcher-assets/account.png"
    alt=""
    className="h-5 w-5 object-contain"
    aria-hidden="true"
  />
);

export function AuthGate({
  title,
  description,
  ctaLabel,
  onSignIn,
  icon,
  className = "",
}: Props) {
  return (
    <div className={`mx-auto flex w-full max-w-lg flex-col py-10 ${className}`}>
      <EmptyState
        icon={icon ?? DEFAULT_ICON}
        title={title}
        description={description}
        action={
          <ActionButton variant="primary" size="md" onClick={onSignIn}>
            {ctaLabel}
          </ActionButton>
        }
      />
    </div>
  );
}
