declare module "lucide-react" {
  import * as React from "react";

  export interface IconProps extends React.SVGProps<SVGSVGElement> {
    color?: string;
    size?: number | string;
    strokeWidth?: number | string;
  }

  export type LucideIcon = React.ForwardRefExoticComponent<
    IconProps & React.RefAttributes<SVGSVGElement>
  >;

  export const ChevronDown: LucideIcon;
  export const Download: LucideIcon;
  export const FolderOpen: LucideIcon;
  export const PencilLine: LucideIcon;
  export const Plus: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const Search: LucideIcon;
  export const Trash2: LucideIcon;
  export const UploadCloud: LucideIcon;
  export const Cloud: LucideIcon;
  export const Puzzle: LucideIcon;
  export const HardDrive: LucideIcon;
  export const ArrowLeft: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const Check: LucideIcon;
  export const AlertCircle: LucideIcon;
  export const CheckCircle2: LucideIcon;
  export const ExternalLink: LucideIcon;
  export const Loader2: LucideIcon;
  export const PartyPopper: LucideIcon;
}

