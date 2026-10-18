import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Code,
  EllipsisVertical,
  ExternalLink,
  Globe,
  type LucideIcon,
  RotateCw,
  Star,
} from "lucide-react";

// browser 탭의 toolbar와 새 탭 화면이 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const browserIcons = {
  globe: Globe,
  back: ArrowLeft,
  forward: ArrowRight,
  reload: RotateCw,
  openExternal: ExternalLink,
  more: EllipsisVertical,
  inspect: Code,
  star: Star,
  bookmarks: Bookmark,
} as const satisfies Record<string, LucideIcon>;
