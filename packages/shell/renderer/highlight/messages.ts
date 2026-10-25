// highlight Worker에 보내는 요청과 답. CodeLine은 type으로만 가져와 worker bundle에 React가 들어가지 않는다.
import type { CodeLine } from "@lophn/ui/reading";

export interface HighlightRequest {
  readonly id: number;
  readonly code: string;
  readonly language: string;
}

export interface HighlightReply {
  readonly id: number;
  readonly lines: readonly CodeLine[] | null;
}
