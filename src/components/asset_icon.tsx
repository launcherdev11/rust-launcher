import type { CSSProperties } from "react";

type AssetIconProps = {
  name: string;
  className?: string;
};

// Painted through a mask so the icon takes the text colour, whatever fill the svg itself uses.
export function AssetIcon({ name, className = "h-4 w-4" }: AssetIconProps) {
  const url = `url("/launcher-assets/${name}.svg")`;
  const style: CSSProperties = {
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  };
  return (
    <span aria-hidden className={`inline-block shrink-0 bg-current ${className}`} style={style} />
  );
}
