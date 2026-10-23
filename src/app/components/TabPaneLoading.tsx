import { LoadingState } from "../../components/ui";
import { readStoredLanguage, t } from "../../i18n";

export function TabPaneLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center py-8">
      <LoadingState label={t(readStoredLanguage() ?? "ru", "common.loading")} />
    </div>
  );
}
