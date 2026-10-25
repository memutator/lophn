// tool 호출 기록과 agent event에서 그리는 활동 줄·카드의 화면 값. 기록에 없는
// 줄은 그리지 않는다.
import type { ToolCallCategory } from "../../../../protocol/lophn-agent/tool-values.ts";

/** 보기 상세 select의 값: Messages·Compact(기본)·Everything. */
export type ViewDetail = "messages" | "compact" | "everything";

/** tool 줄이 받는 모양. Messages는 hidden, Compact는 collapsed, Everything은 expanded다. 메시지와 카드는 그대로다. */
export type ToolLineDetail = "hidden" | "collapsed" | "expanded";

/** call 하나의 화면 값. `state`는 `ToolCallEnded.outcome`에 running을 더한 값이다. */
export interface ToolCallView {
  /** tool call ID(`tcl_…`). */
  readonly id: string;
  /** 정본 이름(`file.read`, `shell.run`). */
  readonly tool: string;
  readonly category: ToolCallCategory;
  /** core가 만든 한 줄 제목. */
  readonly title: string;
  readonly state: ToolCallState;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
}

export type ToolCallState = "running" | "ok" | "error" | "denied" | "cancelled";
