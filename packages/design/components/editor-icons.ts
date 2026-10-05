import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CaseSensitive,
  Ellipsis,
  type LucideIcon,
  PencilLine,
  Replace,
  ReplaceAll,
  TriangleAlert,
  X,
} from "lucide-react";

// 문서 머리·찾기 줄·형식 문제가 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 design이 고른다
// (shell/design-system#R43).
export const editorIcons = {
  edit: PencilLine,
  read: BookOpen,
  menu: Ellipsis,
  findPrevious: ArrowUp,
  findNext: ArrowDown,
  matchCase: CaseSensitive,
  close: X,
  replace: Replace,
  replaceAll: ReplaceAll,
  problem: TriangleAlert,
} as const satisfies Record<string, LucideIcon>;
