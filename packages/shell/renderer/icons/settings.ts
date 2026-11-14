import {
  Activity,
  Bot,
  Globe,
  Keyboard,
  Palette,
  Plug,
  Puzzle,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  SquareTerminal,
  Wrench,
} from "lucide-react";

// Settings 항목(Settings 공간 sidebar)이 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const settingsIcons = {
  general: SlidersHorizontal,
  appearance: Palette,
  browser: Globe,
  remote: Smartphone,
  keyboard: Keyboard,
  quickLaunch: Rocket,
  providers: Plug,
  agents: Bot,
  tools: Wrench,
  extensionPackages: Puzzle,
  coding: SquareTerminal,
  shellRules: ShieldCheck,
  diagnostics: Activity,
};
