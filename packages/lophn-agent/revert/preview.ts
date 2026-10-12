import type { Result } from "../../base/mod.ts";
import type {
  PreviewItem,
  RewindChoice,
} from "../../contracts/lophn-agent/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";
import type { FileStat, JudgedFile } from "./judge.ts";
import type { RevertDeps } from "./commands.ts";

// 되돌리기 preview(RevertPreview)와 그 지문(preview_hash)이다(lophn-agent/revert R3). 구현은
// agent-RW3b가 채운다. 앱 항목(`apps`)은 agent-RW3c가 app-revert.ts에서 만든다.

// 되돌릴 수 없는 사실 한 줄(외부 요청, 질문 답·승인 결정 같은 남는 영향).
export type PreviewFact = {
  target: string;
  reason: "external_effect" | "answered_fact";
  source: string[];
};

export type PreviewInput = {
  kind: "rewind" | "undo";
  choice: RewindChoice | null;
  checkpoint: string | null;
  tool_call: string | null;
  judged: readonly JudgedFile[];
  // 실행 순서(원래 호출 역순)로 놓은 앱 항목. ordinal은 여기서 다시 매긴다.
  apps: readonly PreviewItem[];
  facts: readonly PreviewFact[];
  // 판정에 든 경로의 지금 상태. preview_hash가 이 hash를 지문에 넣는다.
  current: ReadonlyMap<string, FileStat>;
};

export type PreviewResult = {
  restore: PreviewItem[];
  skip: PreviewItem[];
  remain: PreviewItem[];
  // 앱 복원 항목이 있으면 false, 또 summarize와 undo도 false다.
  redo: boolean;
  preview_hash: string;
};

// ordinal은 실행 순서다: 앱 항목, 문서 파일(판정 순서), 남는 사실 순으로 0부터 이어서 매긴다.
//   restore_all   : apps + files + facts
//   messages_only : facts만(파일·앱은 바뀌지 않으므로 restore·skip이 없다)
//   summarize     : 모두 비어 있다(아무것도 바뀌지 않는다)
//   undo(choice=null): files만
// preview_hash는 위 목록과 kind·choice·checkpoint·tool_call과 판정에 든 경로의 지금 hash로 정한 sha256이다.
// 같은 입력은 같은 hash, 하나라도 다르면 다른 hash다. 앱 항목의 step_key와 revert_invocation은 지문에
// 넣지 않는다(step_key는 아직 없는 revert id를 앞에 두므로 preview와 적용이 달라진다).
export function assemblePreview(input: PreviewInput): PreviewResult {
  void input;
  throw new Error("not implemented: agent-RW3b");
}

export type RewindTarget =
  | {
    kind: "rewind";
    session: string;
    checkpoint: string;
    choice: RewindChoice;
  }
  | { kind: "undo"; session: string; tool_call: string };

export type RewindPlan = {
  target: RewindTarget;
  judged: JudgedFile[];
  current: Map<string, FileStat>;
  preview: PreviewResult;
};

export type PlanDeps = Pick<RevertDeps, "observe" | "rootOf" | "appRevision">;

// ledger 기록(rewind_files·tool_calls)을 읽어 판정하고 preview를 만든다. preview 읽기, 파일 준비,
// Rewind·UndoEdit command가 같은 함수를 쓴다.
//   options.observed: 주면 파일을 다시 읽지 않고 그 관측을 쓴다(command는 준비 때 본 관측으로 다시 판정한다).
//   options.revert: 앱 단계 근거(step_key)에 붙일 revert id. preview에는 없다.
// 파일 판정은 choice=restore_all(과 undo)일 때만 한다. messages_only·summarize는 파일을 건드리지
// 않으므로 judged가 비어 있다. 거절 규칙:
//   checkpoint가 session에 없거나 사람 메시지가 아니면 `not_found`.
//   correction 메시지(checkpoints 행 없음)에 restore_all이면, files_restorable=false인 checkpoint에
//   restore_all이면 `invalid_input`. 이미 숨긴 구간 안의 checkpoint 검사는 hidden.ts(agent-RW3d)다.
//   undo는 tool_call의 기록이 없으면 `not_found`. 같은 경로에 되돌려지지 않은 더 최근 기록이 있으면 skip
//   `later_edit`, 그렇지 않고 지금 hash가 그 call의 after와 다르면 skip `edited_outside`로 읽는다(거절하지
//   않고 preview에서 막는다).
// 앱 항목은 app-revert.ts의 readAppWrites·classifyAppWrites(agent-RW3c)로 만든다: checkpoint 메시지의
// 생성 seq 이후의 성공한 앱 write이고 revisions는 deps.appRevision으로 읽는다.
export function planRewind(
  lookup: { sql: Pick<Sql, "get" | "all"> },
  deps: PlanDeps,
  target: RewindTarget,
  options: {
    observed?: ReadonlyMap<string, FileStat>;
    revert?: string;
  } = {},
): Result<RewindPlan> {
  void lookup;
  void deps;
  void target;
  void options;
  throw new Error("not implemented: agent-RW3b");
}
