import { useEffect, useRef } from "react";
import { IdleAnimation, SkinViewer } from "skinview3d";
import {
  DEFAULT_SKIN_URL,
  loadViewerSkinSource,
  type ProfileAvatarInput,
} from "../lib/avatar";

export type AccountSkinPreviewProps = {
  profile: ProfileAvatarInput;
  username: string;
};

export function AccountSkinPreview({ profile, username }: AccountSkinPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    container.appendChild(canvas);

    const width = Math.max(container.clientWidth, 280);
    const height = Math.max(container.clientHeight, 360);

    const viewer = new SkinViewer({
      canvas,
      width,
      height,
    });
    viewer.autoRotate = false;
    viewer.zoom = 0.82;
    viewer.animation = new IdleAnimation();
    viewerRef.current = viewer;

    const resize = () => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight;
      if (nextWidth > 0 && nextHeight > 0) {
        viewer.setSize(nextWidth, nextHeight);
      }
    };

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);
    resize();

    return () => {
      resizeObserver.disconnect();
      viewer.dispose();
      viewerRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;

    let cancelled = false;
    let blobUrl: string | null = null;

    const applySkin = async () => {
      try {
        const source = await loadViewerSkinSource(profile, username);
        if (cancelled || viewer.disposed) return;

        if (source.startsWith("blob:")) {
          blobUrl = source;
        }

        await viewer.loadSkin(source, { ears: false, model: "auto-detect" });
        if (cancelled || viewer.disposed) return;
        viewer.playerObject.ears.visible = false;
      } catch (error) {
        console.debug("[skin] failed to load skin preview", error);
        if (!cancelled && !viewer.disposed) {
          await viewer.loadSkin(DEFAULT_SKIN_URL, { ears: false, model: "auto-detect" });
          if (cancelled || viewer.disposed) return;
          viewer.playerObject.ears.visible = false;
        }
      }
    };

    void applySkin();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [
    profile.nickname,
    profile.ely_username,
    profile.ely_uuid,
    profile.mc_uuid,
    username,
  ]);

  return (
    <div className="relative flex h-full min-h-[min(360px,40vh)] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-xl backdrop-blur-md">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.12),transparent_68%)]"
        aria-hidden
      />
      <div ref={containerRef} className="relative min-h-0 flex-1" />
    </div>
  );
}
