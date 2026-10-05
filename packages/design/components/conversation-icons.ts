import {
  ArrowDown,
  ArrowUp,
  FileText,
  ListPlus,
  type LucideIcon,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  PanelRightClose,
  PencilLine,
  RotateCw,
  SearchCheck,
  Square,
} from "lucide-react";

// 대화 도크가 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 design이 고른다.
export const conversationIcons = {
  dock: MessageSquare,
  close: PanelRightClose,
  newSession: MessageSquarePlus,
  empty: MessagesSquare,
  send: ArrowUp,
  stop: Square,
  request: ListPlus,
  correction: PencilLine,
  checkDelivery: SearchCheck,
  resend: RotateCw,
  jumpLatest: ArrowDown,
  result: FileText,
} as const satisfies Record<string, LucideIcon>;
