declare module "./tabs/ModpackTab" {
  import * as React from "react";

  export interface ModpackTabProps {
    language: "ru" | "en";
    showNotification: (kind: string, message: string) => void;
    onProfileSelectionChange?: (profile: {
      id: string;
      name: string;
      game_version: string;
      loader: string;
    } | null) => void;
  }

  export const ModpackTab: React.FC<ModpackTabProps>;
  export default ModpackTab;
}

