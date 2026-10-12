import type { Result } from "../../base/mod.ts";
import type {
  amendRevertInstall,
  checkpointRevert,
  finishRevert,
  recordRewindFile,
  redo,
  rewind,
  undoEdit,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Sql,
  Tx,
} from "../../contracts/platform/mod.ts";
import type { FileStat } from "./judge.ts";

// 되돌리기 command들(lophn-agent/revert). Rewind·UndoEdit·Redo는 agent-RW3b(문서 파일)가 채우고,
// 앱 단계가 있는 Rewind와 CheckpointRevert·FinishRevert는 agent-RW3c, 숨김·summarize·대화 밖
// 효과는 agent-RW3d가 이어 채운다. RecordRewindFile은 record.ts(agent-RW3a)다.
//
// 규칙(시험 rewind_test·app_rewind_test·rewind_effects_test·hidden_test가 정한다). 세 command는 사람만
// 부른다(그 밖은 forbidden). 같은 id를 다시 보내면 저장된 결과를 replayed=true로 돌려주고 아무것도 다시
// 하지 않는다. 파일 복원은 command 안에서 하지 않는다: core가 observeFiles → planRewind →
// prepareRestore → command → installRestore 순서로 잇고, command는 input.files의 관측으로 다시 판정한다.
//
// Rewind
//   1. session이 없으면 not_found, 닫혔으면 forbidden, 끝나지 않은 run이 있으면 conflict.
//   2. 숨긴 구간 안의 checkpoint면 invalid_input(hidden.ts). choice=summarize인데 effects.summaryOk가
//      아니면 invalid_input이고 아무것도 바뀌지 않는다.
//   3. planRewind(observed = input.files, revert = input.id)로 판정한다.
//   4. preview_hash가 다르거나, 건너뜀·남는 영향이 있는데 accept_remaining이 아니면 blocked: revert 행
//      (redo=none)과 RevertBlocked를 남기고 아무것도 복원하지 않는다. blocked는 항목을 남기지 않는다.
//   5. 복원할 앱 항목이 있으면 applying: RevertStarted(steps = 앱 단계의 step_key, 실행 순서), result_seq=null,
//      redo=none, 항목은 복원 대상 result=unchanged(reason 없음)·건너뜀 skipped·남는 영향 remained. 앱 단계가 끝나면
//      FinishRevert가 적용 또는 partial·uncertain으로 확정한다.
//   6. 아니면 applied: restore_all·messages_only는 effects.cancelWaiting(from_seq = boundary_seq)과
//      resetReadState(before_seq = boundary_seq)를 부르고(실패하면 command 전체가 되돌려진다), restore_all은
//      복원한 항목을 restored로, 그 기록의 rewind_files.reverted_by를 이 revert로 표시한다.
//      redo는 summarize면 none, 아니면 available. RevertApplied(partial = 건너뜀·남는 영향 유무,
//      results = 결과별 수, boundary_seq, redo)를 낸다.
// UndoEdit: planRewind(undo). 해시가 다르거나 복원 대상이 없으면 blocked(항목 없음). 적용하면 reverted_by를 표시하고
//   deps.recordFact("Undid edit to <경로>")를 같은 transaction에서 부른다. redo는 none.
// Redo: redo=available일 때만(아니면 conflict). 복원했던 파일 중 input.files의 관측 hash가 항목의
//   restored_sha256과 같은 것만 다시 쓴 것으로 세고 그 기록의 reverted_by를 풀어 다시 rewind할 수 있게
//   한다. redo=done, RevertRedone(messages = boundary_seq 이후 메시지 수, files = 다시 쓴 파일 수).
// CheckpointRevert(machine): applying인 revert의 앱 단계를 step_key로 한 번 기록한다. 같은 결과를 다시
//   보내면 recorded=false, 다른 결과이거나 모르는 step_key면 conflict. invocation은 단계 근거의
//   revert_invocation에 남는다.
// FinishRevert(machine): 앱 단계의 step_key가 저장한 단계와 같아야 하고, 멈춘 자리(실패·불명) 앞의 단계는
//   모두 기록되어 있어야 한다(아니면 conflict). 모두 restored면 input.files로 다시 판정해 문서 파일을
//   복원하고 applied(redo=none, RevertApplied), 아니면 partial·uncertain(RevertFinished)이다. 끝나면 항목의
//   이유가 정해진다: 실패한 앱 단계 `app_failed`, 응답을 잃은 단계 `app_uncertain`, 부르지 않은 앱 단계
//   `app_not_started`, 시작하지 않은 문서 파일 `app_not_settled`(둘 다 result=unchanged). 끝난 revert는 다시
//   끝낼 수 없다(conflict).
// AmendRevertInstall(machine): applied인 revert에서 설치가 hash 불일치로 건너뛴 경로(paths)의 항목
//   (plan=restore, result=restored, 문서 파일)을 result=skipped, reason=edited_outside로 한 번 고친다. outcome은
//   applied 그대로이고, 그 기록의 reverted_by를 풀고, 그 항목의 restored_sha256·redo_ref를 비워 redo 근거에서
//   뺀다. RevertAmended(amended = 고친 수, results = 고친 뒤 결과별 수)를 낸다. 사람은 forbidden, applied가
//   아니거나 복원된 파일 항목이 아닌 경로(이미 고친 경로 포함)는 conflict, 모르는 revert는 not_found.
//
// Undo 비활성: planRewind(undo)에서 같은 경로에 더 최근 agent 기록이 있으면 skip `later_edit`, 사람이
// 고쳐 hash가 다르면 `edited_outside`다.

// 대화 쪽 효과를 core 조립이 주입하는 port다. 시험은 가짜로 대신한다.
export type RewindEffects = {
  // 같은 session의 완전 성공한 요약 model call인가(choice=summarize의 근거).
  summaryOk(
    lookup: { sql: Pick<Sql, "get" | "all"> },
    input: { session: string; call: string },
  ): boolean;
  // 숨김 시작 이후에 기다리던 질문 묶음·approval request를 취소한다.
  cancelWaiting(
    tx: Tx,
    input: { session: string; from_seq: string },
  ): Result<{ questions: number; approvals: number }>;
  // harness가 읽은 문서의 상태(읽은 hash 등)를 숨김 시작 이전 기준으로 다시 잡는다.
  resetReadState(
    tx: Tx,
    input: { session: string; before_seq: string },
  ): Result<void>;
};

export type RevertDeps = {
  // 경로마다 지금 파일 상태를 동기로 읽는다(preview 읽기가 쓴다).
  observe(root: string, paths: readonly string[]): Map<string, FileStat>;
  // session 자리의 project 폴더(절대 경로).
  rootOf(lookup: { sql: Pick<Sql, "get" | "all"> }, session: string): string;
  // 앱의 지금 revision. 앱이 없거나 알 수 없으면 null이다(apps 소유 CAS의 읽기 통로).
  appRevision(app: string): string | null;
  effects: RewindEffects;
  // Undo가 session에 사실 메시지를 남긴다("Undid edit to <경로>", machine 메시지).
  recordFact(
    tx: Tx,
    input: { session: string; text: string },
  ): Result<string>;
};

export function createRevertCommands(deps: RevertDeps): {
  record: CommandDefinition<typeof recordRewindFile>;
  rewind: CommandDefinition<typeof rewind>;
  undo: CommandDefinition<typeof undoEdit>;
  redo: CommandDefinition<typeof redo>;
  checkpoint: CommandDefinition<typeof checkpointRevert>;
  finish: CommandDefinition<typeof finishRevert>;
  amend: CommandDefinition<typeof amendRevertInstall>;
} {
  void deps;
  throw new Error("not implemented: agent-RW3b");
}
