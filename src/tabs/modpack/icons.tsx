import type { IconProps } from "./types";

export function ImageIcon({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt ?? ""}
      className={className ?? "h-4 w-4 object-contain"}
      aria-hidden={alt ? undefined : true}
    />
  );
}

export function FolderIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/folder.png" className={className} />;
}

export function FileIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/file.png" className={className} />;
}

export function EditIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/edit.png" className={className} />;
}

export function ExportIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/export.png" className={className} />;
}

export function BackupIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 15.5V17a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/add.png" className={className} />;
}

export function RefreshIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/refresh.png" className={className} />;
}

export function ModsIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/mods.svg" className={className} />;
}

export function SettingsIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/settings.svg" className={className} />;
}

export function SearchIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/search.png" className={className} />;
}

export function WeightIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/weight.png" className={className} />;
}

export function GridViewIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/grid.png" className={className} />;
}

export function ListViewIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/list.png" className={className} />;
}

export function ScreenshotsIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/pack_image.png" className={className} />;
}
