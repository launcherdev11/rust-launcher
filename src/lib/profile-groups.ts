export type ProfileGroupColor = "purple" | "orange" | "red" | "yellow" | "green";

export type ProfileGroup = {
  id: string;
  name: string;
  color: ProfileGroupColor;
  profileIds: string[];
  collapsed: boolean;
};

export const PROFILE_GROUPS_STORAGE_KEY = "modpacks_profile_groups";

export const PROFILE_GROUP_COLORS: ProfileGroupColor[] = [
  "purple",
  "orange",
  "red",
  "yellow",
  "green",
];

export const PROFILE_GROUP_COLOR_STYLES: Record<
  ProfileGroupColor,
  { border: string; headerBg: string; accent: string; dot: string; ring: string }
> = {
  purple: {
    border: "border-violet-400/45",
    headerBg: "bg-violet-500/12",
    accent: "text-violet-200",
    dot: "bg-violet-400",
    ring: "ring-violet-400/50",
  },
  orange: {
    border: "border-orange-400/45",
    headerBg: "bg-orange-500/12",
    accent: "text-orange-200",
    dot: "bg-orange-400",
    ring: "ring-orange-400/50",
  },
  red: {
    border: "border-red-400/45",
    headerBg: "bg-red-500/12",
    accent: "text-red-200",
    dot: "bg-red-400",
    ring: "ring-red-400/50",
  },
  yellow: {
    border: "border-yellow-400/45",
    headerBg: "bg-yellow-500/12",
    accent: "text-yellow-200",
    dot: "bg-yellow-400",
    ring: "ring-yellow-400/50",
  },
  green: {
    border: "border-emerald-400/45",
    headerBg: "bg-emerald-500/12",
    accent: "text-emerald-200",
    dot: "bg-emerald-400",
    ring: "ring-emerald-400/50",
  },
};

export function newProfileGroupId(): string {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function loadProfileGroups(): ProfileGroup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROFILE_GROUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const groups = parsed
      .filter((g): g is ProfileGroup => {
        return (
          g != null &&
          typeof g === "object" &&
          typeof (g as ProfileGroup).id === "string" &&
          typeof (g as ProfileGroup).name === "string" &&
          PROFILE_GROUP_COLORS.includes((g as ProfileGroup).color) &&
          Array.isArray((g as ProfileGroup).profileIds)
        );
      })
      .map((g) => ({
        ...g,
        collapsed: Boolean(g.collapsed),
        profileIds: [...new Set(g.profileIds.filter((id) => typeof id === "string"))],
      }));
    return dedupeProfileGroupAssignments(groups);
  } catch {
    return [];
  }
}

export function dedupeProfileGroupAssignments(groups: ProfileGroup[]): ProfileGroup[] {
  const claimed = new Set<string>();
  return groups.map((group) => {
    const profileIds: string[] = [];
    for (const id of group.profileIds) {
      if (claimed.has(id)) continue;
      claimed.add(id);
      profileIds.push(id);
    }
    return { ...group, profileIds };
  });
}

const profileGroupsListeners = new Set<() => void>();

export function subscribeProfileGroups(listener: () => void): () => void {
  profileGroupsListeners.add(listener);
  return () => {
    profileGroupsListeners.delete(listener);
  };
}

function notifyProfileGroupsListeners(): void {
  const run = () => {
    for (const listener of profileGroupsListeners) {
      listener();
    }
  };
  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
    return;
  }
  setTimeout(run, 0);
}

export function saveProfileGroups(groups: ProfileGroup[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_GROUPS_STORAGE_KEY, JSON.stringify(groups));
    notifyProfileGroupsListeners();
  } catch {
  }
}

export function sanitizeProfileGroups(
  groups: ProfileGroup[],
  validProfileIds: Set<string>,
): ProfileGroup[] {
  return groups.map((g) => ({
    ...g,
    profileIds: g.profileIds.filter((id) => validProfileIds.has(id)),
  }));
}

export function assignProfilesToGroup(
  groups: ProfileGroup[],
  groupId: string,
  profileIds: string[],
): ProfileGroup[] {
  const idsSet = new Set(profileIds);
  const next = groups.map((g) => {
    if (g.id === groupId) {
      return { ...g, profileIds: [...new Set([...g.profileIds, ...profileIds])] };
    }
    return { ...g, profileIds: g.profileIds.filter((id) => !idsSet.has(id)) };
  });
  return pruneEmptyProfileGroups(next);
}

export function ungroupProfiles(groups: ProfileGroup[], profileIds: string[]): ProfileGroup[] {
  const idsSet = new Set(profileIds);
  return groups.map((g) => ({
    ...g,
    profileIds: g.profileIds.filter((id) => !idsSet.has(id)),
  }));
}

export function pruneEmptyProfileGroups(groups: ProfileGroup[]): ProfileGroup[] {
  return groups.filter((g) => g.profileIds.length > 0);
}
