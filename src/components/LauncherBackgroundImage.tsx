import { useEffect, useState } from "react";
import { isAnimatedBackgroundPath } from "../lib/launcherBackground";

type Props = {
  imageUrl: string;
  blurEnabled?: boolean;
  animated?: boolean;
  className?: string;
};

function useRasterizedBlurUrl(imageUrl: string): string | null {
  const [rasterUrl, setRasterUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRasterUrl(null);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const maxSide = 512;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
      const pad = 24;
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width + pad * 2;
      canvas.height = height + pad * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setRasterUrl(null);
        return;
      }
      ctx.filter = "blur(8px)";
      ctx.drawImage(img, pad, pad, width, height);
      try {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        if (!cancelled) setRasterUrl(dataUrl);
      } catch {
        if (!cancelled) setRasterUrl(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setRasterUrl(null);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return rasterUrl;
}

function CoverBackground({
  imageUrl,
  className,
  scale,
}: {
  imageUrl: string;
  className: string;
  scale?: number;
}) {
  return (
    <div
      className={`absolute inset-0 bg-center ${className}`.trim()}
      style={{
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        transform: scale ? `scale(${scale})` : undefined,
      }}
    />
  );
}

function LiveDownscaledBlur({
  imageUrl,
  className,
}: {
  imageUrl: string;
  className: string;
}) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden ${className}`.trim()}
      style={{ contain: "paint", isolation: "isolate" }}
    >
      <div
        className="absolute left-1/2 top-1/2 h-[40%] w-[40%]"
        style={{ transform: "translate(-50%, -50%) scale(2.7)" }}
      >
        <div
          className="absolute inset-0 bg-center bg-cover bg-no-repeat"
          style={{
            backgroundImage: `url(${imageUrl})`,
            filter: "blur(8px)",
          }}
        />
      </div>
    </div>
  );
}

function StaticBlurredBackground({
  imageUrl,
  className,
}: {
  imageUrl: string;
  className: string;
}) {
  const rasterUrl = useRasterizedBlurUrl(imageUrl);
  if (rasterUrl) {
    return <CoverBackground imageUrl={rasterUrl} className={className} scale={1.08} />;
  }
  return <LiveDownscaledBlur imageUrl={imageUrl} className={className} />;
}

export function LauncherBackgroundImage({
  imageUrl,
  blurEnabled = true,
  animated,
  className = "",
}: Props) {
  const isAnimated = animated ?? isAnimatedBackgroundPath(imageUrl);

  if (isAnimated) {
    return (
      <div className={`absolute inset-0 overflow-hidden ${className}`.trim()}>
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    );
  }

  if (blurEnabled) {
    return <StaticBlurredBackground imageUrl={imageUrl} className={className} />;
  }

  return <CoverBackground imageUrl={imageUrl} className={className} />;
}
