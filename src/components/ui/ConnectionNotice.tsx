import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { t, type Language } from "../../i18n";

type Props = {
  language: Language;
  className?: string;
};

export function ConnectionNotice({ language, className = "" }: Props) {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      className={`rounded-xl border border-warn-line/30 bg-warn/15 px-4 py-2.5 text-xs text-warn-fg/90 ${className}`}
    >
      <p className="font-semibold">{t(language, "common.state.offlineTitle")}</p>
      <p className="mt-0.5 text-warn-fg/70">{t(language, "common.state.offlineHint")}</p>
    </div>
  );
}
