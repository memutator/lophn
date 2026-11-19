import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  House,
  Monitor,
  type LucideIcon,
} from "lucide-react";

// 왼쪽 sidebar의 workspace 줄(Home, project), 다른 기계 묶음 머리와 Recent 접기·page 화살표. 나머지 아이콘은 shellIcons를 쓴다.
export const sidebarIcons = {
  home: House,
  project: FolderOpen,
  collapsed: ChevronRight,
  machine: Monitor,
  previous: ChevronLeft,
  next: ChevronRight,
} as const satisfies Record<string, LucideIcon>;
