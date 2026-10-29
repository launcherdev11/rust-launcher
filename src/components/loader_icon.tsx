import { LOADER_ICONS } from "../lib/loaderIcons";
import { AssetIcon } from "./asset_icon";

type Props = {
  loader: string;
  className?: string;
  reserveSpace?: boolean;
};

export function LoaderIcon({ loader, className = "h-4 w-4", reserveSpace = false }: Props) {
  const icon = LOADER_ICONS[loader];
  if (!icon) {
    return reserveSpace ? <span aria-hidden className={`inline-block shrink-0 ${className}`} /> : null;
  }
  if (icon.mono) return <AssetIcon name={icon.name} className={className} />;
  return (
    <img
      src={`/launcher-assets/${icon.name}.svg`}
      alt=""
      draggable={false}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
