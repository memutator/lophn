import {
  Bug,
  ExternalLink,
  Globe,
  Hammer,
  type LucideIcon,
  Play,
  RotateCw,
  ScanSearch,
  ShieldCheck,
  Square,
  SquareTerminal,
  TestTube2,
  Wrench,
} from "lucide-react";
import type { CommandIcon } from "../../../protocol/projects/project-commands.ts";

// project commands 아이콘. 화면이 lucide를 직접 들이지 않도록 여기서 고른다.
export const projectCommandIcons = {
  play: Play,
  terminal: SquareTerminal,
  build: Hammer,
  test: TestTube2,
  lint: ShieldCheck,
  debug: Bug,
  globe: Globe,
  wrench: Wrench,
} as const satisfies Record<CommandIcon, LucideIcon>;

export const projectCommandActionIcons = {
  run: Play,
  stop: Square,
  restart: RotateCw,
  terminal: SquareTerminal,
  preview: ExternalLink,
  detect: ScanSearch,
} as const satisfies Record<string, LucideIcon>;
