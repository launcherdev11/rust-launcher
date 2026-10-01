import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export function useProfileIconSrc(profileId: string, refreshKey = 0): string | null {
  const [iconSrc, setIconSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIconSrc(null);

    void (async () => {
      try {
        const uri = await invoke<string | null>("get_profile_icon_data_uri", {
          profileId,
        });
        if (!cancelled && uri) {
          setIconSrc(uri);
        }
      } catch {
        if (!cancelled) {
          setIconSrc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileId, refreshKey]);

  return iconSrc;
}
