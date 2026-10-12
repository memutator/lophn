import {
  ArrowUp,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  type LucideIcon,
  Mail,
  MailOpen,
  MessageCircleQuestionMark,
  ShieldCheck,
  ThumbsUp,
  X,
} from "lucide-react";

// 질문 칸·things-to-confirm·notification chip이 쓰는 아이콘. 화면이 lucide를 직접 들이지
// 않도록 이 묶음이 고른다.
export const confirmIcons = {
  question: MessageCircleQuestionMark,
  decision: ShieldCheck,
  review: ShieldCheck,
  previous: ChevronLeft,
  next: ChevronRight,
  answer: ArrowUp,
  later: Clock,
  cancel: Ban,
  confirmCancel: Check,
  keep: X,
  recommended: ThumbsUp,
  unread: Mail,
  markRead: MailOpen,
} as const satisfies Record<string, LucideIcon>;
