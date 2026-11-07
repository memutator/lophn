// highlight Worker에 보내는 요청과 답. CodeLine은 type으로만 가져와 worker bundle에 React가 들어가지 않는다.
import type { CodeLine } from "@lophn/ui/reading";

export interface HighlightRequest {
  readonly id: number;
  readonly code: string;
  readonly language: string;
  // 같은 block이 자라며 보내는 요청의 짝. worker가 이 key로 앞 줄의 grammar state를 이어 쓴다.
  readonly key: string;
  // true면 마지막 줄까지 칠한다. false면 끝난 줄만 칠하고 마지막 줄은 plain으로 둔다.
  readonly final: boolean;
}

export interface HighlightReply {
  readonly id: number;
  readonly lines: readonly CodeLine[] | null;
}
