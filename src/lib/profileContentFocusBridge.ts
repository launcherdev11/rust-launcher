export type ProfileContentTab = "mods" | "resourcepacks" | "shaderpacks";

export type ProfileContentFocus = {
  profileId: string;
  contentTab: ProfileContentTab;
  query: string;
};

export const PROFILE_CONTENT_FOCUS_EVENT = "launcher:profile-content-focus";

let pending: ProfileContentFocus | null = null;

export function requestProfileContentFocus(focus: ProfileContentFocus) {
  pending = focus;
  window.dispatchEvent(
    new CustomEvent<ProfileContentFocus>(PROFILE_CONTENT_FOCUS_EVENT, { detail: focus }),
  );
}

export function takePendingProfileContentFocus(): ProfileContentFocus | null {
  const focus = pending;
  pending = null;
  return focus;
}
