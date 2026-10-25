// turn trace(ReadAgentTrace)에서 그리는 활동 줄·카드의 화면 값. trace에 없는
// 줄은 그리지 않는다.

/** 보기 상세 select의 값: Messages·Compact(기본)·Everything. */
export type ViewDetail = "messages" | "compact" | "everything";

/** tool 줄이 받는 모양. Messages는 hidden, Compact는 collapsed, Everything은 expanded다. 메시지와 카드는 그대로다. */
export type ToolLineDetail = "hidden" | "collapsed" | "expanded";

export interface ToolLineView {
  /** tool call ID(tcl_…) 또는 묶음 key. */
  id: string;
  /** 접힌 한 줄, 예: "Read 3 documents". */
  label: string;
  /** 펼쳤을 때의 하위 줄. */
  lines: readonly string[];
}
