// `file.record_result`: 성공한 파일 작업 하나를 FileWritten·FileRenamed·FileDeleted
// event 하나로 남긴다. 파일 작업 자체는 ledger transaction이 아니다(worker가 한다).
// 이 command는 짧은 기록일 뿐이고, 같은 `(request_key, operation)`의 재전달은 공통 command
// 결과(idempotency key)가 막는다. event payload는 경로와 hash만 담고 본문은 없다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  fileDeleted,
  type FileOperationResult,
  fileRecordResult,
  fileRenamed,
  fileWritten,
} from "../../contracts/documents/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { loadDocument } from "../versions/mod.ts";

// 기록은 사람 요청을 결합해 받은 worker의 machine credential만 한다. 사람·agent·앱의
// 직접 기록은 감사 사실을 꾸밀 수 있어 거절한다.
function machineOnly(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine"
    ? ok(undefined)
    : err({ code: "forbidden", message: "file results are machine only" });
}

const OUTCOME_OF = {
  write: "written",
  rename: "renamed",
  delete: "deleted",
} as const;

// event의 subject: project 파일은 project, working copy는 원본 연결이 없는 문서다.
// instruction_file 목표는 이 command의 범위 밖이다.
function subjectOf(tx: Tx, result: FileOperationResult): Result<string> {
  const invalid = () =>
    err({ code: "invalid_input" as const, message: "file result is invalid" });
  const target = result.target;
  if (target.kind === "project_file") {
    const found = tx.sql.get("SELECT 1 AS found FROM projects WHERE id = ?", [
      target.project,
    ]);
    return found === undefined ? invalid() : ok(target.project);
  }
  if (target.kind === "working_copy") {
    const document = loadDocument(tx.sql, target.document);
    if (!document.ok) return document;
    if (document.value === null || document.value.file_source !== null) {
      return invalid();
    }
    return ok(target.document);
  }
  return invalid();
}

export function createFileCommands(): {
  recordResult: CommandDefinition<typeof fileRecordResult>;
} {
  return {
    recordResult: {
      route: fileRecordResult,
      handle(tx, ctx, input) {
        const allowed = machineOnly(ctx);
        if (!allowed.ok) return allowed;
        const outcome = OUTCOME_OF[input.operation];
        const invalid = () =>
          err({
            code: "invalid_input" as const,
            message: "file result is invalid",
          });
        // 성공한 작업만 기록한다. 실패·결과 불명은 event가 아니다.
        if (input.outcome !== outcome) return invalid();
        const subject = subjectOf(tx, input);
        if (!subject.ok) return subject;
        let seq: string;
        if (input.operation === "write") {
          if (input.after_path === null || input.written_hash === null) {
            return invalid();
          }
          seq = tx.emit(fileWritten, subject.value, {
            path: input.after_path,
            before_hash: input.before_hash,
            after_hash: input.written_hash,
          });
        } else if (input.operation === "rename") {
          if (
            input.before_path === null || input.after_path === null ||
            input.before_hash === null
          ) return invalid();
          // 이름 변경은 바이트를 바꾸지 않는다. 앞뒤 hash가 같다.
          seq = tx.emit(fileRenamed, subject.value, {
            before_path: input.before_path,
            after_path: input.after_path,
            before_hash: input.before_hash,
            after_hash: input.before_hash,
          });
        } else {
          if (input.before_path === null || input.before_hash === null) {
            return invalid();
          }
          seq = tx.emit(fileDeleted, subject.value, {
            path: input.before_path,
            before_hash: input.before_hash,
            after_hash: null,
          });
        }
        return ok({ ...input, recording: "recorded", event_seq: seq });
      },
    },
  };
}
