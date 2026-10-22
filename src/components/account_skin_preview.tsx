import { useEffect, useRef, type ReactNode } from "react";
import {
  IdleAnimation,
  SkinViewer,
  type PlayerAnimation,
} from "skinview3d";
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PointLight,
  type Light,
} from "three";
import {
  DEFAULT_SKIN_URL,
  loadViewerSkinSource,
  type ProfileAvatarInput,
} from "../lib/avatar";
import { applySkinLayer3D, removeSkinLayer3D } from "../lib/skin_layer_3d";

const HEAD_LOOK_YAW_MAX = 0.75;
const HEAD_LOOK_PITCH_MAX = 0.45;
const HEAD_LOOK_SMOOTH = 0.14;

function createIdleWithHeadLook(look: { x: number; y: number }): PlayerAnimation {
  const idle = new IdleAnimation();
  idle.speed = 0.9;
  idle.addAnimation((player) => {
    const head = player.skin.head;
    const targetYaw = look.x * HEAD_LOOK_YAW_MAX;
    const targetPitch = look.y * HEAD_LOOK_PITCH_MAX;
    head.rotation.y += (targetYaw - head.rotation.y) * HEAD_LOOK_SMOOTH;
    head.rotation.x += (targetPitch - head.rotation.x) * HEAD_LOOK_SMOOTH;
  });
  return idle;
}

function applyIdleAnimation(viewer: SkinViewer, look: { x: number; y: number }) {
  viewer.playerObject.resetJoints();
  viewer.playerObject.position.set(0, 0, 0);
  viewer.playerObject.rotation.set(0, Math.PI * 0.2, 0);
  viewer.playerObject.scale.set(1, 1, 1);
  viewer.animation = createIdleWithHeadLook(look);
}

export type AccountSkinPreviewProps = {
  profile: ProfileAvatarInput;
  username: string;
  skinUrl?: string | null;
  capeUrl?: string | null;
  children?: ReactNode;
  className?: string;
};

export function AccountSkinPreview({
  profile,
  username,
  skinUrl = null,
  capeUrl = null,
  children,
  className,
}: AccountSkinPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full cursor-grab active:cursor-grabbing";
    container.appendChild(canvas);

    const width = Math.max(container.clientWidth, 280);
    const height = Math.max(container.clientHeight, 360);

    const viewer = new SkinViewer({
      canvas,
      width,
      height,
    });
    viewer.autoRotate = false;
    viewer.zoom = 0.9;
    viewer.fov = 48;

    viewer.globalLight.intensity = 1.05;
    viewer.globalLight.color = new Color(0xeef3ff);
    viewer.cameraLight.intensity = 0.55;
    viewer.cameraLight.color = new Color(0xfff8ef);

    const extraLights: Light[] = [];

    const hemi = new HemisphereLight(0xf4f7ff, 0x1a1c24, 1.15);
    viewer.scene.add(hemi);
    extraLights.push(hemi);

    const keyLight = new DirectionalLight(0xfff5e8, 1.85);
    keyLight.position.set(-2.4, 5.6, 4.6);
    viewer.scene.add(keyLight);
    extraLights.push(keyLight);

    const fillLight = new DirectionalLight(0xb8d4ff, 0.95);
    fillLight.position.set(3.6, 2.2, -1.2);
    viewer.scene.add(fillLight);
    extraLights.push(fillLight);

    const frontFill = new PointLight(0xffffff, 0.45, 18, 2);
    frontFill.position.set(0, 3.2, 6.5);
    viewer.scene.add(frontFill);
    extraLights.push(frontFill);

    const headLook = { x: 0, y: 0 };
    viewerRef.current = viewer;
    applyIdleAnimation(viewer, headLook);

    const updateHeadLookFromEvent = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((clientY - rect.top) / rect.height) * 2 - 1;
      headLook.x = Math.max(-1, Math.min(1, nx));
      headLook.y = Math.max(-1, Math.min(1, ny));
    };

    const onPointerMove = (event: PointerEvent) => {
      updateHeadLookFromEvent(event.clientX, event.clientY);
    };
    const onPointerLeave = () => {
      headLook.x = 0;
      headLook.y = 0;
    };

    const trackRoot = rootRef.current ?? container;
    trackRoot.addEventListener("pointermove", onPointerMove);
    trackRoot.addEventListener("pointerleave", onPointerLeave);

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
      trackRoot.removeEventListener("pointermove", onPointerMove);
      trackRoot.removeEventListener("pointerleave", onPointerLeave);
      resizeObserver.disconnect();
      removeSkinLayer3D(viewer);
      for (const light of extraLights) {
        viewer.scene.remove(light);
        light.dispose();
      }
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
        let source = skinUrl;
        if (!source) {
          source = await loadViewerSkinSource(profile, username);
          if (cancelled || viewer.disposed) return;
          if (source.startsWith("blob:")) blobUrl = source;
        }

        await viewer.loadSkin(source, { ears: false, model: "auto-detect" });
        if (cancelled || viewer.disposed) return;
        viewer.playerObject.ears.visible = false;
        applySkinLayer3D(viewer);
      } catch (error) {
        console.debug("[skin] failed to load skin preview", error);
        if (!cancelled && !viewer.disposed) {
          await viewer.loadSkin(DEFAULT_SKIN_URL, { ears: false, model: "auto-detect" });
          if (cancelled || viewer.disposed) return;
          viewer.playerObject.ears.visible = false;
          applySkinLayer3D(viewer);
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
    skinUrl,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;

    let cancelled = false;

    const applyCape = async () => {
      if (!capeUrl) {
        viewer.loadCape(null);
        return;
      }
      try {
        await viewer.loadCape(capeUrl, { backEquipment: "cape" });
      } catch (error) {
        console.debug("[cape] failed to load cape preview", error);
        if (!cancelled && !viewer.disposed) {
          viewer.loadCape(null);
        }
      }
    };

    void applyCape();

    return () => {
      cancelled = true;
    };
  }, [capeUrl]);

  return (
    <div
      ref={rootRef}
      className={
        className ??
        "relative flex h-full min-h-[min(360px,40vh)] w-full flex-col overflow-hidden glass-panel"
      }
    >
      <div ref={containerRef} className="relative min-h-0 flex-1" />
      {children}
    </div>
  );
}

