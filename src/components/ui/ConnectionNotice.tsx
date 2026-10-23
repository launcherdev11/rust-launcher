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
      className={`rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2.5 text-xs text-amber-100/90 ${className}`}
    >
      <p className="font-semibold">{t(language, "common.state.offlineTitle")}</p>
      <p className="mt-0.5 text-amber-100/70">{t(language, "common.state.offlineHint")}</p>
    </div>
  );
}
