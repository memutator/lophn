import {
  ExternalLink,
  type LucideIcon,
  Play,
  RotateCw,
  ScanSearch,
  Square,
  SquareTerminal,
} from "lucide-react";

// project commands 아이콘. 화면이 lucide를 직접 들이지 않도록 여기서 고른다.
export const projectCommandIcon: LucideIcon = SquareTerminal;

export const projectCommandActionIcons = {
  run: Play,
  stop: Square,
  restart: RotateCw,
  terminal: SquareTerminal,
  preview: ExternalLink,
  detect: ScanSearch,
} as const satisfies Record<string, LucideIcon>;
