import { useState } from "react";
import type { BottomSocialKind } from "../notifications";

export function SocialIcon({ kind, className }: { kind: BottomSocialKind; className?: string }) {
  const src = kind === "discord" ? "/launcher-assets/discord.png" : "/launcher-assets/telegram.png";
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span className="text-sm font-extrabold text-white">
        {kind === "discord" ? "D" : "T"}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={className ?? "h-10 w-10 object-contain"}
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}
