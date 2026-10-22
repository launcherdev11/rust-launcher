import type { ReactNode, Ref } from "react";

const MICROSOFT_ICON = "/launcher-assets/brand/microsoft.svg";
const ELY_ICON = "/launcher-assets/brand/ely.svg";

type BadgeProps = {
  icon?: string;
  fallback: string;
  tip: string;
  children?: ReactNode;
};

function BrandBadge({ icon, fallback, tip, children }: BadgeProps) {
  return (
    <span className="brand-badge" data-tip={tip} tabIndex={0} aria-label={tip}>
      {children ??
        (icon ? (
          <span
            className="brand-badge-icon"
            style={{ maskImage: `url(${icon})`, WebkitMaskImage: `url(${icon})` }}
          />
        ) : (
          fallback
        ))}
    </span>
  );
}

function LauncherMark() {
  return (
    <svg viewBox="0 0 10 10" preserveAspectRatio="none" className="brand-mark" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.52246 7.60794V0.0146484H9.79884V1.46869H6.7712V2.98147H9.86165L9.99984 7.60794L9.79884 9.98725H4.52246V7.60794Z"
      />
      <path
        fill="currentColor"
        d="M1.53266 0H3.79397L3.70603 7.60795L3.79397 9.98727H1.53266L1.34422 7.60795L1.44472 2.2765H0V0.719663H1.44472L1.53266 0Z"
      />
      <path className="brand-mark-shade" d="M6.79659 6.06559V4.47937H7.55036L7.61318 6.06559H6.79659Z" />
      <path className="brand-mark-shade" d="M3.73137 7.62402H1.3584L1.52751 9.95335L3.78951 9.99042L3.73137 7.62402Z" />
      <path className="brand-mark-shade" d="M9.99221 7.65936H4.54688V9.94744L9.80547 9.99984L9.99221 7.65936Z" />
    </svg>
  );
}

type SidebarAccountProps = {
  avatar: ReactNode;
  label: string;
  kind: string;
  platformNickname: string;
  offlineText: string;
  title: string;
  active: boolean;
  collapsed?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

export function SidebarAccount({
  avatar,
  label,
  kind,
  platformNickname,
  offlineText,
  title,
  active,
  collapsed = false,
  buttonRef,
  onClick,
}: SidebarAccountProps) {
  const hasMicrosoft = kind === "microsoft";
  const hasEly = kind === "ely";
  const isOffline = !hasMicrosoft && !hasEly;

  return (
    <div className={`acct-card ${active ? "acct-card-active" : ""} ${collapsed ? "acct-card-collapsed" : ""}`} data-tour-id="tour-account-switcher">
      <button
        type="button"
        ref={buttonRef}
        onClick={onClick}
        title={collapsed ? label : title}
        className="acct-main interactive-press"
      >
        {avatar}
        <span className="acct-name">{label}</span>
      </button>
      <div className="acct-badges">
        {platformNickname ? (
          <BrandBadge fallback="16" tip={platformNickname}>
            <LauncherMark />
          </BrandBadge>
        ) : null}
        {hasMicrosoft ? (
          <BrandBadge icon={MICROSOFT_ICON} fallback="MS" tip={label} />
        ) : null}
        {hasEly ? <BrandBadge icon={ELY_ICON} fallback="Ely" tip={label} /> : null}
        {isOffline ? <span className="acct-offline">{offlineText}</span> : null}
      </div>
    </div>
  );
}
