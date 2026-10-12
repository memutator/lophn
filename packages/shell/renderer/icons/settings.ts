import {
  Activity,
  Bell,
  Download,
  Plug,
  SlidersHorizontal,
  SquareTerminal,
  Wrench,
} from "lucide-react";

// settings 화면 왼쪽 nav가 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const settingsIcons = {
  connections: Plug,
  coding: SquareTerminal,
  extensions: Wrench,
  general: SlidersHorizontal,
  notifications: Bell,
  update: Download,
  diagnostics: Activity,
};
