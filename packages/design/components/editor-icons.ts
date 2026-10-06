import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Ellipsis,
  GitCompareArrows,
  type LucideIcon,
  PencilLine,
  Replace,
  ReplaceAll,
  RotateCw,
  TriangleAlert,
  X,
} from "lucide-react";

// 문서 머리·찾기 줄·형식 문제·저장 상태·notice가 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 design이 고른다
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
  // 저장 상태 줄과 문서 옆 notice(shell/editor#R2, R15).
  saveWarning: TriangleAlert,
  saveFailed: CircleAlert,
  conflict: GitCompareArrows,
  reloaded: RotateCw,
  detailsOpen: ChevronUp,
  detailsClosed: ChevronDown,
} as const satisfies Record<string, LucideIcon>;
