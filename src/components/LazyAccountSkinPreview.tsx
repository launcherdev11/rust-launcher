import { lazy, Suspense } from "react";
import type { AccountSkinPreviewProps } from "./account_skin_preview";

const loadPreview = () => import("./account_skin_preview");

const AccountSkinPreviewImpl = lazy(() =>
  loadPreview().then((m) => ({ default: m.AccountSkinPreview })),
);

if (typeof window !== "undefined") {
  const warm = () => void loadPreview().catch(() => {});
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: 4000 });
  } else {
    window.setTimeout(warm, 1500);
  }
}

const DEFAULT_CLASS =
  "relative flex h-full min-h-[min(360px,40vh)] w-full flex-col overflow-hidden glass-panel";

export function AccountSkinPreview(props: AccountSkinPreviewProps) {
  return (
    <Suspense
      fallback={
        <div className={props.className ?? DEFAULT_CLASS}>
          <div className="relative min-h-0 flex-1" />
          {props.children}
        </div>
      }
    >
      <AccountSkinPreviewImpl {...props} />
    </Suspense>
  );
}
