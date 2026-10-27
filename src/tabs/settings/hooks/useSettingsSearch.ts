import type { Language } from "../../../i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SETTING_SEARCH_CATALOG, type SettingSearchId } from "../searchCatalog";
import { isSeasonalThemePeriod } from "../../../lib/seasonalTheme";
import { type SettingsTabId } from "../../../app/types";
import {
  SETTINGS_SEARCH_EVENT,
  takePendingSettingsSearch,
} from "../../../lib/settingsSearchBridge";

type SettingsSearchDeps = {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  language: Language;
  settingsTab: SettingsTabId;
  setSettingsTab: (id: SettingsTabId) => void;
};

export function useSettingsSearch(deps: SettingsSearchDeps) {
  const {
    tt,
    language,
    settingsTab,
    setSettingsTab,
  } = deps;

  const [settingsSearch, setSettingsSearch] = useState(() => takePendingSettingsSearch() ?? "");

  useEffect(() => {
    const onRequest = (e: Event) => {
      takePendingSettingsSearch();
      setSettingsSearch((e as CustomEvent<string>).detail ?? "");
    };
    window.addEventListener(SETTINGS_SEARCH_EVENT, onRequest);
    return () => window.removeEventListener(SETTINGS_SEARCH_EVENT, onRequest);
  }, []);

  const settingsSearchQuery = settingsSearch.trim().toLowerCase();

  const settingsSearchActive = settingsSearchQuery.length > 0;

  const matchedSettingIds = useMemo(() => {
    if (!settingsSearchActive) return null;
    const ids = new Set<SettingSearchId>();
    const seasonalActive = isSeasonalThemePeriod();
    for (const item of SETTING_SEARCH_CATALOG) {
      if (item.id === "launcher.disableThematicDecorations" && !seasonalActive) {
        continue;
      }
      const haystack = item.keys
        .map((key) => tt(key))
        .join(" ")
        .toLowerCase();
      if (haystack.includes(settingsSearchQuery)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [settingsSearchActive, settingsSearchQuery, tt, language]);

  const showSetting = useCallback(
    (id: SettingSearchId) => !matchedSettingIds || matchedSettingIds.has(id),
    [matchedSettingIds],
  );

  const searchHasAnyMatches = !matchedSettingIds || matchedSettingIds.size > 0;

  const searchHasMatchesOnTab = useMemo(() => {
    if (!matchedSettingIds) return true;
    return SETTING_SEARCH_CATALOG.some(
      (item) => item.tab === settingsTab && matchedSettingIds.has(item.id),
    );
  }, [matchedSettingIds, settingsTab]);

  const tabMatchCounts = useMemo(() => {
    if (!matchedSettingIds) return null;
    const counts: Record<SettingsTabId, number> = { game: 0, versions: 0, launcher: 0 };
    for (const item of SETTING_SEARCH_CATALOG) {
      if (matchedSettingIds.has(item.id)) counts[item.tab] += 1;
    }
    return counts;
  }, [matchedSettingIds]);

  const anyVisible = (...ids: SettingSearchId[]) => ids.some((id) => showSetting(id));

  useEffect(() => {
    if (!matchedSettingIds || matchedSettingIds.size === 0) return;
    const firstMatch = SETTING_SEARCH_CATALOG.find((item) => matchedSettingIds.has(item.id));
    if (!firstMatch) return;
    const hasOnCurrentTab = SETTING_SEARCH_CATALOG.some(
      (item) => item.tab === settingsTab && matchedSettingIds.has(item.id),
    );
    if (!hasOnCurrentTab) {
      setSettingsTab(firstMatch.tab);
    }
  }, [settingsSearchQuery]);

  return {
    settingsSearch,
    setSettingsSearch,
    settingsSearchActive,
    showSetting,
    searchHasAnyMatches,
    searchHasMatchesOnTab,
    tabMatchCounts,
    anyVisible,
  };
}
