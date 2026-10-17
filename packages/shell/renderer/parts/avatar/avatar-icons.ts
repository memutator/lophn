import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  Bookmark,
  BookOpen,
  Bot,
  FileText,
  GitCompare,
  Layers,
  Library,
  MessageSquare,
  PencilLine,
  Search,
  SquareTerminal,
  Users,
} from "lucide-react";

// agent profile icon 집합의 정본. 저장되는 것은 id뿐이라 화면이 lucide를 직접 들이지 않는다.
export const AVATAR_ICONS = {
  dock: MessageSquare,
  roles: Users,
  contexts: Library,
  documents: FileText,
  apps: AppWindow,
  search: Search,
  series: Layers,
  bookmark: Bookmark,
  terminal: SquareTerminal,
  read: BookOpen,
  edit: PencilLine,
  compare: GitCompare,
} as const satisfies Record<string, LucideIcon>;

export type AvatarIconId = keyof typeof AVATAR_ICONS;

export const AVATAR_ICON_IDS = Object.keys(AVATAR_ICONS) as AvatarIconId[];

// 집합이 바뀌어도 이미 저장된 id가 이니셜이나 빈 칸으로 깨지지 않게 하는 기본 얼굴.
export const DEFAULT_AVATAR_ICON: LucideIcon = Bot;

export function isAvatarIconId(id: string): id is AvatarIconId {
  return Object.hasOwn(AVATAR_ICONS, id);
}
