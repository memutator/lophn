import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  answerQuestion,
  cancelQuestion,
  createQuestion,
  deferQuestion,
  expireQuestion,
  questionAnswered,
  questionCancelled,
  questionCreated,
  questionExpired,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  actionAllowed,
  assignmentState,
  DEFERRED_REASON_BLOB,
  EMPTY_TEXT_BLOB,
  EXPIRED_REASON_BLOB,
  loadQuestion,
  loadRunRef,
  type QuestionRow,
  type RunRef,
  sameContent,
  settingChangesOf,
} from "./model.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다. 본문은 hash만 받는다(blob 변환·
// redaction은 준비 단계, secret 판정은 screen.ts가 그 앞에서 한다).

type Code = "invalid_input" | "conflict" | "not_found" | "forbidden";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

function questionNotFound(): Result<never> {
  return reject("not_found", "question not found");
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : reject(
    "forbidden",
    "only a person does this",
  );
}

// agent 자격은 자기 assignment의 run 질문만 다룬다. 자격에 run이 묶여 있으면 그
// run의 질문만이다. 그 밖은 없는 질문과 똑같이 답한다.
function agentOwns(ctx: RequestContext, run: RunRef): boolean {
  const actor = parseActor(ctx.actor);
  if (actor === undefined || actor.kind !== "agent") return false;
  if (actor.id !== run.assignment) return false;
  return ctx.run === undefined || ctx.run === null || ctx.run === run.id;
}

function closedOutput(
  row: QuestionRow,
  status: "answered" | "expired" | "cancelled",
  closedSeq: string,
  replayed: boolean,
) {
  return ok({ id: row.id, status, closed_seq: closedSeq, replayed });
}

// 답은 now < expires_at일 때만 받는다. 경계 시각부터는 받지 않는다(R7).
function pastDeadline(row: QuestionRow, now: string): boolean {
  return row.expires_at !== null &&
    Date.parse(now) >= Date.parse(row.expires_at);
}

function closeRow(
  tx: Tx,
  row: QuestionRow,
  closed: {
    status: "answered" | "expired" | "cancelled";
    seq: string;
    answer?: string;
    bindingHash?: string | null;
    reason?: string;
    reasonBlob?: string;
  },
): void {
  tx.sql.run(
    `update questions set status = ?, answer = ?, binding_hash = ?,
       closed_reason = ?, closed_reason_blob = ?, closed_seq = ?
     where id = ?`,
    [
      closed.status,
      closed.answer ?? null,
      closed.bindingHash ?? null,
      closed.reason ?? null,
      closed.reasonBlob ?? null,
      Number(closed.seq),
      row.id,
    ],
  );
}

type LoadedPending = { row: QuestionRow; run: RunRef };

// 질문을 읽고 호출자가 볼 수 있는지 본다. 보이지 않으면 없는 질문과 같다.
function loadVisible(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  visible: (run: RunRef) => boolean,
): Result<LoadedPending> {
  const row = loadQuestion(tx, id);
  if (row === undefined) return questionNotFound();
  const run = loadRunRef(tx, row.run);
  if (run === undefined || !visible(run)) return questionNotFound();
  return ok({ row, run });
}

export function createQuestionCommands(): {
  create: CommandDefinition<typeof createQuestion>;
  answer: CommandDefinition<typeof answerQuestion>;
  defer: CommandDefinition<typeof deferQuestion>;
  cancel: CommandDefinition<typeof cancelQuestion>;
  expire: CommandDefinition<typeof expireQuestion>;
} {
  return {
    create: {
      route: createQuestion,
      handle(tx, ctx, input: Input<typeof createQuestion>) {
        const actor = parseActor(ctx.actor);
        if (actor === undefined || actor.kind !== "agent") {
          return reject("forbidden", "only an agent asks a question");
        }
        const run = loadRunRef(tx, input.run);
        if (run === undefined || !agentOwns(ctx, run)) {
          return reject("not_found", "run not found");
        }
        const existing = loadQuestion(tx, input.id);
        if (existing !== undefined) {
          if (!sameContent(existing, input)) {
            return reject("conflict", "question id already used");
          }
          if (existing.status !== "pending") {
            return reject("conflict", "the question is already closed");
          }
          return ok({
            id: existing.id,
            status: "pending" as const,
            created_seq: existing.created_seq,
          });
        }
        // 끝난 run은 새 질문을 받지 않는다. 시작 전·이미 답을 기다리는 run도 같다.
        if (run.state === "finished") {
          return reject("forbidden", "the run is finished");
        }
        if (run.state !== "running") {
          return reject("conflict", "the run is not running");
        }
        if (assignmentState(tx, run.assignment) !== "enabled") {
          return reject("forbidden", "the assignment is not enabled");
        }
        // 세션은 선택이다. 있으면 run의 세션이어야 한다(R2).
        if (input.session !== null && input.session !== run.session) {
          return reject("invalid_input", "session does not belong to the run");
        }
        // run 하나에 답을 기다리는 질문은 하나다(R2).
        if (
          tx.sql.get(
            "select 1 as found from questions where run = ? and status = 'pending'",
            [run.id],
          ) !== undefined
        ) {
          return reject("conflict", "the run already waits for an answer");
        }
        // 이미 받은 답을 같은 본문으로 다시 묻지 않는다(R1).
        if (
          tx.sql.get(
            `select 1 as found from questions
             where run = ? and status = 'answered' and prompt_blob = ?`,
            [run.id, input.prompt_blob],
          ) !== undefined
        ) {
          return reject("conflict", "this question was already answered");
        }
        const now = tx.now();
        if (
          input.expires_at !== null &&
          Date.parse(input.expires_at) <= Date.parse(now)
        ) {
          return reject("invalid_input", "the deadline must be in the future");
        }
        const summary = [];
        for (const option of input.options) {
          if (option.action !== null && !actionAllowed(option.action)) {
            // 권한 부여·외부 효과·등록되지 않은 동작은 선택지로 열 수 없다(R12).
            return reject("forbidden", "this action cannot be an option");
          }
          const changes = settingChangesOf(option);
          if (changes === undefined) {
            return reject("invalid_input", "settings action has no changes");
          }
          summary.push({ key: option.key, changes: changes ?? null });
        }
        const seq = tx.emit(questionCreated, input.id, {
          run: input.run,
          session: input.session,
          options: summary,
        });
        tx.sql.run(
          `insert into questions (id, run, session, created_by, prompt_blob,
             reason_blob, options, recommendation, expires_at, status,
             created_seq)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [
            input.id,
            input.run,
            input.session,
            ctx.actor,
            input.prompt_blob,
            input.reason_blob,
            JSON.stringify(input.options),
            input.recommendation === null
              ? null
              : JSON.stringify(input.recommendation),
            input.expires_at,
            Number(seq),
          ],
        );
        return ok({
          id: input.id,
          status: "pending" as const,
          created_seq: seq,
        });
      },
    },
    answer: {
      route: answerQuestion,
      handle(tx, ctx, input: Input<typeof answerQuestion>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const loaded = loadVisible(tx, ctx, input.question, () => true);
        if (!loaded.ok) return loaded;
        const { row, run } = loaded.value;
        if (row.created_seq !== compare.created_seq) {
          return reject("conflict", "question changed");
        }
        if (row.created_seq !== input.created_seq) {
          return reject("conflict", "question changed");
        }
        const answer = input.answer;
        if (row.status !== "pending") {
          // 같은 답의 재전송은 저장된 결과만 돌려주고 새 결정으로 쓰지 않는다.
          if (
            row.status === "answered" && row.answer !== null &&
            row.closed_seq !== null &&
            canonicalize(JSON.parse(row.answer)) === canonicalize(answer) &&
            row.binding_hash === input.binding_hash
          ) {
            return closedOutput(row, "answered", row.closed_seq, true);
          }
          return reject("conflict", "the question is already closed");
        }
        if (run.state === "finished") {
          return reject("conflict", "the run is finished");
        }
        if (pastDeadline(row, tx.now())) {
          return reject("conflict", "the deadline has passed");
        }
        const options = JSON.parse(row.options) as {
          key: string;
          action: { binding_hash: string } | null;
        }[];
        let bindingHash: string | null = null;
        if (answer.kind === "option") {
          const chosen = options.find((option) =>
            option.key === answer.option_key
          );
          if (chosen === undefined) {
            return reject("invalid_input", "unknown option");
          }
          if (chosen.action === null) {
            if (input.binding_hash !== null) {
              return reject("invalid_input", "this option has no action");
            }
          } else {
            // 고정 action 선택은 만든 때의 내용과 같은 binding이어야 한다.
            if (input.binding_hash !== chosen.action.binding_hash) {
              return reject("conflict", "the action content changed");
            }
            bindingHash = input.binding_hash;
          }
        } else {
          // 자유 답은 동작으로 읽지 않는다. 빈 답은 답이 아니다(R6).
          if (answer.text_blob === EMPTY_TEXT_BLOB) {
            return reject("invalid_input", "an empty answer is not an answer");
          }
          if (input.binding_hash !== null) {
            return reject("invalid_input", "a free answer has no action");
          }
        }
        const seq = tx.emit(questionAnswered, row.id, {
          created_seq: row.created_seq,
          answer,
          binding_hash: bindingHash,
        });
        closeRow(tx, row, {
          status: "answered",
          seq,
          answer: JSON.stringify(answer),
          bindingHash,
        });
        return closedOutput(row, "answered", seq, false);
      },
    },
    defer: {
      route: deferQuestion,
      handle(tx, ctx, input: Input<typeof deferQuestion>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const loaded = loadVisible(tx, ctx, input.question, () => true);
        if (!loaded.ok) return loaded;
        const { row } = loaded.value;
        if (
          row.created_seq !== compare.created_seq ||
          row.created_seq !== input.created_seq
        ) {
          return reject("conflict", "question changed");
        }
        if (row.status !== "pending") {
          return reject("conflict", "the question is already closed");
        }
        // 미루기는 답이 아니다. 답 없음으로 닫는다(R6, R8).
        const seq = tx.emit(questionCancelled, row.id, {
          created_seq: row.created_seq,
          closed_reason_blob: DEFERRED_REASON_BLOB,
          deferred: true,
        });
        closeRow(tx, row, {
          status: "cancelled",
          seq,
          reason: "deferred",
          reasonBlob: DEFERRED_REASON_BLOB,
        });
        return closedOutput(row, "cancelled", seq, false);
      },
    },
    cancel: {
      route: cancelQuestion,
      handle(tx, ctx, input: Input<typeof cancelQuestion>, compare) {
        const actor = parseActor(ctx.actor);
        if (
          actor === undefined ||
          (actor.kind !== "user" && actor.kind !== "agent" &&
            actor.kind !== "machine")
        ) {
          return reject("forbidden", "this actor cannot cancel a question");
        }
        const loaded = loadVisible(
          tx,
          ctx,
          input.question,
          (run) => actor.kind !== "agent" || agentOwns(ctx, run),
        );
        if (!loaded.ok) return loaded;
        const { row, run } = loaded.value;
        if (
          row.created_seq !== compare.created_seq ||
          row.created_seq !== input.created_seq
        ) {
          return reject("conflict", "question changed");
        }
        if (row.status !== "pending") {
          return reject("conflict", "the question is already closed");
        }
        // 질문한 agent만 자기 질문을 거두고, machine은 원래 일이 끝났거나 전제가
        // 바뀐(superseded) 질문만 닫는다(R9).
        if (actor.kind === "agent" && row.created_by !== ctx.actor) {
          return reject("forbidden", "only the asking agent cancels it");
        }
        if (
          actor.kind === "machine" && run.state !== "finished" &&
          input.closed_reason !== "superseded"
        ) {
          return reject(
            "forbidden",
            "a running question closes only with a changed premise",
          );
        }
        const seq = tx.emit(questionCancelled, row.id, {
          created_seq: row.created_seq,
          closed_reason_blob: input.closed_reason_blob,
          deferred: false,
        });
        closeRow(tx, row, {
          status: "cancelled",
          seq,
          reason: input.closed_reason,
          reasonBlob: input.closed_reason_blob,
        });
        return closedOutput(row, "cancelled", seq, false);
      },
    },
    expire: {
      route: expireQuestion,
      handle(tx, ctx, input: Input<typeof expireQuestion>, compare) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject("forbidden", "only the machine expires a question");
        }
        const loaded = loadVisible(tx, ctx, input.question, () => true);
        if (!loaded.ok) return loaded;
        const { row } = loaded.value;
        if (
          row.created_seq !== compare.created_seq ||
          row.created_seq !== input.created_seq
        ) {
          return reject("conflict", "question changed");
        }
        if (row.status !== "pending") {
          return reject("conflict", "the question is already closed");
        }
        // 기한이 없거나 아직 오지 않은 질문은 닫지 않는다(R7).
        if (row.expires_at === null || !pastDeadline(row, tx.now())) {
          return reject("conflict", "the deadline has not passed");
        }
        const seq = tx.emit(questionExpired, row.id, {
          created_seq: row.created_seq,
          closed_reason_blob: EXPIRED_REASON_BLOB,
        });
        closeRow(tx, row, {
          status: "expired",
          seq,
          reason: "expired",
          reasonBlob: EXPIRED_REASON_BLOB,
        });
        return closedOutput(row, "expired", seq, false);
      },
    },
  };
}
