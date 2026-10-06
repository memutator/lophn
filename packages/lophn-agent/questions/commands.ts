import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  answerQuestion,
  answerQuestionAction,
  cancelQuestion,
  createQuestion,
  deferQuestion,
  expireQuestion,
  QUESTION_BLOB_FIELDS,
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
  assignmentState,
  fixedVersionsExist,
  loadQuestion,
  loadRunRef,
  type QuestionRow,
  registerTextBlobs,
  type RunRef,
  sameContent,
  settingChangesOf,
  storedContent,
  type TextBlob,
  textBlob,
} from "./model.ts";
import { checkOptionAction } from "./option-actions.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다. 글(본문·이유·설명·추천·자유 답·취소
// 이유)은 값으로 받는다. core가 redaction(자유 답은 screen.ts의 secret 판정까지)을
// 거쳐 blob으로 준비해 두었고, 이 command가 같은 transaction에서 그 blob의 영구
// 참조를 등록한다(Q38). 준비 증거는 같은 값에서 정해진다: UTF-8 bytes의 hash·크기,
// 보낸 자격의 principal, 글 purpose. 살아 있는 준비가 없으면 등록이 거절되어 전체가
// 되돌아간다.

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

type ClosedOutput = {
  id: string;
  status: "answered" | "expired" | "cancelled";
  closed_seq: string;
  replayed: boolean;
};

function closedOutput(
  row: QuestionRow,
  status: "answered" | "expired" | "cancelled",
  closedSeq: string,
  replayed: boolean,
): Result<ClosedOutput> {
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
  id: string,
  visible: (run: RunRef) => boolean,
): Result<LoadedPending> {
  const row = loadQuestion(tx, id);
  if (row === undefined) return questionNotFound();
  const run = loadRunRef(tx, row.run);
  if (run === undefined || !visible(run)) return questionNotFound();
  return ok({ row, run });
}

type StoredAnswer =
  | { kind: "option"; option_key: string; text_blob: null }
  | { kind: "text"; option_key: null; text_blob: string };

type AnswerInput = {
  question: string;
  created_seq: string;
  answer:
    | { kind: "option"; option_key: string }
    | { kind: "text"; text: string };
};

// 일반 답(binding이 null)과 action 답(binding_hash가 있음)이 같은 규칙을 쓴다. 다른 점은
// 선택지의 고정 action뿐이다: action이 있는 선택지는 사람 결정 확인을 거친 action 답으로만
// 받고(platform/identity#R14, user token은 클릭의 증거가 아니다), action이 없는 선택지와
// 자유 답은 확인 없이 받는다.
function answerHandle(
  tx: Tx,
  ctx: RequestContext,
  input: AnswerInput,
  compare: { created_seq: string },
  binding: string | null,
): Result<ClosedOutput> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const loaded = loadVisible(tx, input.question, () => true);
  if (!loaded.ok) return loaded;
  const { row, run } = loaded.value;
  if (row.created_seq !== compare.created_seq) {
    return reject("conflict", "question changed");
  }
  if (row.created_seq !== input.created_seq) {
    return reject("conflict", "question changed");
  }
  const answer = input.answer;
  let text: TextBlob | null = null;
  let stored: StoredAnswer;
  if (answer.kind === "option") {
    stored = {
      kind: "option",
      option_key: answer.option_key,
      text_blob: null,
    };
  } else {
    text = textBlob(ctx, answer.text);
    stored = { kind: "text", option_key: null, text_blob: text.hash };
  }
  if (row.status !== "pending") {
    // 같은 답의 재전송은 저장된 결과만 돌려주고 새 결정으로 쓰지 않는다.
    if (
      row.status === "answered" && row.answer !== null &&
      row.closed_seq !== null &&
      canonicalize(JSON.parse(row.answer)) === canonicalize(stored) &&
      row.binding_hash === binding
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
  if (stored.kind === "option") {
    const chosen = options.find((option) => option.key === stored.option_key);
    if (chosen === undefined) {
      return reject("invalid_input", "unknown option");
    }
    if (chosen.action === null) {
      if (binding !== null) {
        return reject("invalid_input", "this option has no action");
      }
    } else if (binding === null) {
      // 고정 action이 있는 선택지는 확인 없이 답으로 받지 않는다.
      return reject("forbidden", "this option needs a confirmation");
    } else {
      // 고정 action 선택은 만든 때의 내용과 같은 binding이어야 한다.
      if (binding !== chosen.action.binding_hash) {
        return reject("conflict", "the action content changed");
      }
      bindingHash = binding;
    }
  }
  const seq = tx.emit(questionAnswered, row.id, {
    created_seq: row.created_seq,
    answer: stored,
    binding_hash: bindingHash,
  });
  closeRow(tx, row, {
    status: "answered",
    seq,
    answer: JSON.stringify(stored),
    bindingHash,
  });
  if (text !== null) {
    const registered = registerTextBlobs(tx, row.id, seq, [{
      field: QUESTION_BLOB_FIELDS.answer,
      blob: text,
    }]);
    if (!registered.ok) return registered;
  }
  return closedOutput(row, "answered", seq, false);
}

export function createQuestionCommands(): {
  create: CommandDefinition<typeof createQuestion>;
  answer: CommandDefinition<typeof answerQuestion>;
  answerAction: CommandDefinition<typeof answerQuestionAction>;
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
        const content = storedContent(ctx, input);
        const existing = loadQuestion(tx, input.id);
        if (existing !== undefined) {
          if (!sameContent(existing, input, content)) {
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
            [run.id, content.prompt_blob],
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
          if (option.action !== null) {
            // 권한 부여·외부 효과·등록되지 않은 동작은 선택지로 열 수 없고, 등록된 동작도
            // 소유 command 입력·CAS·지문이 맞아야 고정한다(R12, R13).
            const checked = checkOptionAction(input.id, option.action);
            if (!checked.ok) return checked;
          }
          const fixed = fixedVersionsExist(tx, option);
          if (!fixed.ok) return fixed;
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
            content.prompt_blob,
            content.reason_blob,
            JSON.stringify(content.options),
            content.recommendation === null
              ? null
              : JSON.stringify(content.recommendation),
            input.expires_at,
            Number(seq),
          ],
        );
        const registered = registerTextBlobs(tx, input.id, seq, content.blobs);
        if (!registered.ok) return registered;
        return ok({
          id: input.id,
          status: "pending" as const,
          created_seq: seq,
        });
      },
    },
    answer: {
      route: answerQuestion,
      handle: (tx, ctx, input: Input<typeof answerQuestion>, compare) =>
        answerHandle(tx, ctx, input, compare, null),
    },
    answerAction: {
      route: answerQuestionAction,
      handle: (tx, ctx, input: Input<typeof answerQuestionAction>, compare) =>
        answerHandle(tx, ctx, input, compare, input.binding_hash),
    },
    defer: {
      route: deferQuestion,
      handle(tx, ctx, input: Input<typeof deferQuestion>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const loaded = loadVisible(tx, input.question, () => true);
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
          closed_reason_blob: null,
          deferred: true,
        });
        closeRow(tx, row, {
          status: "cancelled",
          seq,
          reason: "deferred",
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
        const reason = textBlob(ctx, input.closed_reason_text);
        const seq = tx.emit(questionCancelled, row.id, {
          created_seq: row.created_seq,
          closed_reason_blob: reason.hash,
          deferred: false,
        });
        closeRow(tx, row, {
          status: "cancelled",
          seq,
          reason: input.closed_reason,
          reasonBlob: reason.hash,
        });
        const registered = registerTextBlobs(tx, row.id, seq, [{
          field: QUESTION_BLOB_FIELDS.closed,
          blob: reason,
        }]);
        if (!registered.ok) return registered;
        return closedOutput(row, "cancelled", seq, false);
      },
    },
    expire: {
      route: expireQuestion,
      handle(tx, ctx, input: Input<typeof expireQuestion>, compare) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject("forbidden", "only the machine expires a question");
        }
        const loaded = loadVisible(tx, input.question, () => true);
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
        });
        closeRow(tx, row, {
          status: "expired",
          seq,
          reason: "expired",
        });
        return closedOutput(row, "expired", seq, false);
      },
    },
  };
}
