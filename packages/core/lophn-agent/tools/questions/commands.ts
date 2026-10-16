import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import {
  answerQuestionAction,
  answerQuestionGroup,
  cancelQuestionGroup,
  createQuestionGroup,
  deferQuestionGroup,
  expireQuestionGroup,
  QUESTION_BLOB_FIELDS,
  questionAnswered,
  questionCancelled,
  questionCreated,
  questionExpired,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../../../protocol/server/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import {
  checkGroupOpen,
  collectGroupAnswers,
  deferGroup,
  type GroupAnswerInput,
  validateNewGroup,
} from "./group.ts";
import {
  fixedVersionsExist,
  groupStateOf,
  loadGroup,
  loadTurnRef,
  optionsOf,
  type QuestionGroup,
  sameContent,
  settingChangesOf,
} from "./model.ts";
import type { TurnRef } from "./model.ts";
import {
  registerTextBlobs,
  storedContent,
  type TextBlob,
  textBlob,
} from "./text-blobs.ts";
import { checkOptionAction } from "./option-actions.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다. 묶음은 한 단위다: 만들 때 질문 1~4개가 함께
// 저장되고, 답은 묶음 전체에 한 번이며(일부만 답한 저장은 없다), Skip·취소·만료도 묶음
// 전체를 닫는다. 순수 검사는 group.ts가 하고 이 파일은 저장·event·CAS를 맡는다.
// 글(본문·이유·설명·추천·자유 답·취소 이유)은 값으로 받는다. core가 redaction(자유 답은
// screen.ts의 secret 판정까지)을 거쳐 blob으로 준비해 두었고, 이 command가 같은
// transaction에서 그 blob의 영구 참조를 등록한다. 준비 증거는 같은 값에서 정해진다:
// UTF-8 bytes의 hash·크기, 보낸 자격의 principal, 글 purpose. 살아 있는 준비가 없으면
// 등록이 거절되어 전체가 되돌아간다.

type Code = "invalid_input" | "conflict" | "not_found" | "forbidden";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

function groupNotFound(): Result<never> {
  return reject("not_found", "question group not found");
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : reject(
    "forbidden",
    "only a person does this",
  );
}

// agent 자격은 자기 session의 turn 묶음만 다룬다. 자격에 turn이 묶여 있으면 그
// turn의 묶음만이다. 그 밖은 없는 묶음과 똑같이 답한다.
function agentOwns(ctx: RequestContext, turn: TurnRef): boolean {
  const actor = parseActor(ctx.actor);
  if (actor === undefined || actor.kind !== "agent") return false;
  if (actor.id !== turn.session) return false;
  return ctx.turn === undefined || ctx.turn === null || ctx.turn === turn.id;
}

type ClosedStatus = "answered" | "expired" | "cancelled";

type ClosedOutput = {
  id: string;
  status: ClosedStatus;
  closed_seq: string;
  replayed: boolean;
};

function closedOutput(
  group: QuestionGroup,
  status: ClosedStatus,
  closedSeq: string,
  replayed: boolean,
): Result<ClosedOutput> {
  return ok({ id: group.id, status, closed_seq: closedSeq, replayed });
}

// 답은 now < expires_at일 때만 받는다. 경계 시각부터는 받지 않는다.
function pastDeadline(group: QuestionGroup, now: string): boolean {
  return group.expires_at !== null &&
    Date.parse(now) >= Date.parse(group.expires_at);
}

function closeGroup(
  tx: Tx,
  group: Pick<QuestionGroup, "id">,
  closed: {
    status: ClosedStatus;
    seq: string;
    bindingHash?: string | null;
    reason?: string;
    reasonBlob?: string;
  },
): void {
  tx.sql.run(
    `update question_groups set status = ?, binding_hash = ?,
       closed_reason = ?, closed_reason_blob = ?, closed_seq = ?
     where id = ?`,
    [
      closed.status,
      closed.bindingHash ?? null,
      closed.reason ?? null,
      closed.reasonBlob ?? null,
      Number(closed.seq),
      group.id,
    ],
  );
}

type LoadedPending = { group: QuestionGroup; turn: TurnRef };

// 묶음을 읽고 호출자가 볼 수 있는지 본다. 보이지 않으면 없는 묶음과 같다.
function loadVisible(
  tx: Tx,
  id: string,
  visible: (turn: TurnRef) => boolean,
): Result<LoadedPending> {
  const group = loadGroup(tx, id);
  if (group === undefined) return groupNotFound();
  const turn = loadTurnRef(tx, group.turn);
  if (turn === undefined || !visible(turn)) return groupNotFound();
  return ok({ group, turn });
}

type StoredAnswer =
  | { kind: "option"; option_key: string; text_blob: null }
  | { kind: "text"; option_key: null; text_blob: string };

type SubmittedAnswer = {
  question: string;
  answer: GroupAnswerInput["answer"];
};

type AnswerInput = {
  group: string;
  created_seq: string;
  answers: SubmittedAnswer[];
};

// 일반 답(binding이 null)과 action 답(binding이 있음)이 같은 규칙을 쓴다. 다른 점은 선택지의
// 고정 action뿐이다: action이 있는 선택지는 사람 결정 확인을 거친 action 답으로만 받고
// (user token은 클릭의 증거가 아니다), action이 없는 선택지와 자유 답은
// 확인 없이 받는다. action 답은 질문 하나짜리 묶음이다.
type Binding = { hash: string; question: string };

function storedAnswerOf(
  ctx: RequestContext,
  answer: SubmittedAnswer["answer"],
): { stored: StoredAnswer; text: TextBlob | null } {
  if (answer.kind === "option") {
    return {
      stored: {
        kind: "option",
        option_key: answer.option_key,
        text_blob: null,
      },
      text: null,
    };
  }
  const text = textBlob(ctx, answer.text);
  return {
    stored: { kind: "text", option_key: null, text_blob: text.hash },
    text,
  };
}

// 같은 답의 재전송이면 저장된 결과를 돌려준다. 묶음 전체가 같아야 한다.
function isReplay(
  group: QuestionGroup,
  stored: Map<string, StoredAnswer>,
  binding: Binding | null,
): boolean {
  return group.status === "answered" && group.closed_seq !== null &&
    group.binding_hash === (binding?.hash ?? null) &&
    stored.size === group.questions.length &&
    group.questions.every((question) => {
      const next = stored.get(question.id);
      return next !== undefined && question.answer !== null &&
        canonicalize(JSON.parse(question.answer)) === canonicalize(next);
    });
}

function checkActionAnswer(
  group: QuestionGroup,
  answers: SubmittedAnswer[],
  binding: Binding,
): Result<GroupAnswerInput[]> {
  const only = group.questions[0];
  const entry = answers[0];
  if (
    group.questions.length !== 1 || only === undefined || entry === undefined ||
    answers.length !== 1 || entry.question !== only.id ||
    binding.question !== only.id
  ) {
    return reject(
      "invalid_input",
      "an action answer is the answer of a group of one question",
    );
  }
  if (entry.answer.kind !== "option") {
    return reject("invalid_input", "an action answer picks an option");
  }
  const key = entry.answer.option_key;
  const chosen = optionsOf(only).find((option) => option.key === key);
  if (chosen === undefined) return reject("invalid_input", "unknown option");
  if (chosen.action === null) {
    return reject("invalid_input", "this option has no action");
  }
  // 고정 action 선택은 만든 때의 내용과 같은 binding이어야 한다.
  if (
    binding.hash !== (chosen.action as { binding_hash: string }).binding_hash
  ) {
    return reject("conflict", "the action content changed");
  }
  return ok([entry]);
}

function answerHandle(
  tx: Tx,
  ctx: RequestContext,
  input: AnswerInput,
  compare: { created_seq: string },
  binding: Binding | null,
): Result<ClosedOutput> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const loaded = loadVisible(tx, input.group, () => true);
  if (!loaded.ok) return loaded;
  const { group, turn } = loaded.value;
  if (
    group.created_seq !== compare.created_seq ||
    group.created_seq !== input.created_seq
  ) {
    return reject("conflict", "question group changed");
  }
  // 글은 값이다. 같은 글은 항상 같은 hash라 재전송 판정에 준비 참조가 필요 없다.
  const texts: TextBlob[] = [];
  const stored = new Map<string, StoredAnswer>();
  for (const entry of input.answers) {
    const one = storedAnswerOf(ctx, entry.answer);
    stored.set(entry.question, one.stored);
    if (one.text !== null) texts.push(one.text);
  }
  if (group.status !== "pending") {
    // 같은 답의 재전송은 저장된 결과만 돌려주고 새 결정으로 쓰지 않는다.
    if (isReplay(group, stored, binding)) {
      return closedOutput(group, "answered", group.closed_seq!, true);
    }
    return reject("conflict", "the question group is already closed");
  }
  if (turn.state === "finished") {
    return reject("conflict", "the turn is finished");
  }
  const open = checkGroupOpen(group, tx.now());
  if (!open.ok) return open;
  const answers = binding === null
    ? collectGroupAnswers(groupStateOf(group), input.answers)
    : checkActionAnswer(group, input.answers, binding);
  if (!answers.ok) return answers;
  const seq = tx.emit(questionAnswered, group.id, {
    created_seq: group.created_seq,
    answers: group.questions.map((question) => ({
      question: question.id,
      answer: stored.get(question.id)!,
    })),
    binding_hash: binding?.hash ?? null,
  });
  closeGroup(tx, group, {
    status: "answered",
    seq,
    bindingHash: binding?.hash ?? null,
  });
  for (const question of group.questions) {
    tx.sql.run("update questions set answer = ? where id = ?", [
      JSON.stringify(stored.get(question.id)),
      question.id,
    ]);
  }
  const registered = registerTextBlobs(
    tx,
    group.id,
    seq,
    texts.map((blob) => ({ field: QUESTION_BLOB_FIELDS.answer, blob })),
  );
  if (!registered.ok) return registered;
  return closedOutput(group, "answered", seq, false);
}

function createHandle(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof createQuestionGroup>,
): Result<{ id: string; status: "pending"; created_seq: string }> {
  const actor = parseActor(ctx.actor);
  if (actor === undefined || actor.kind !== "agent") {
    return reject("forbidden", "only an agent asks a question");
  }
  const turn = loadTurnRef(tx, input.turn);
  if (turn === undefined || !agentOwns(ctx, turn)) {
    return reject("not_found", "turn not found");
  }
  const shape = validateNewGroup(input.questions);
  if (!shape.ok) return shape;
  const content = storedContent(ctx, input);
  const existing = loadGroup(tx, input.id);
  if (existing !== undefined) {
    if (!sameContent(existing, input, content)) {
      return reject("conflict", "question group id already used");
    }
    if (existing.status !== "pending") {
      return reject("conflict", "the question group is already closed");
    }
    return ok({
      id: existing.id,
      status: "pending" as const,
      created_seq: existing.created_seq,
    });
  }
  for (const question of input.questions) {
    if (
      tx.sql.get("select 1 as found from questions where id = ?", [
        question.id,
      ]) !== undefined
    ) {
      return reject("conflict", "question id already used");
    }
  }
  // 끝난 turn은 새 묶음을 받지 않는다. 시작 전·이미 답을 기다리는 turn도 같다.
  if (turn.state === "finished") {
    return reject("forbidden", "the turn is finished");
  }
  if (turn.state !== "running") {
    return reject("conflict", "the turn is not running");
  }
  // 세션은 선택이다. 있으면 turn의 세션이어야 한다.
  if (input.session !== null && input.session !== turn.session) {
    return reject("invalid_input", "session does not belong to the turn");
  }
  // turn 하나에 답을 기다리는 묶음은 하나다.
  if (
    tx.sql.get(
      "select 1 as found from question_groups where turn = ? and status = 'pending'",
      [turn.id],
    ) !== undefined
  ) {
    return reject("conflict", "the turn already waits for an answer");
  }
  // 묶음 안과 이미 받은 답에서 같은 본문을 다시 묻지 않는다.
  const asked = new Set<string>();
  for (const question of content.questions) {
    if (asked.has(question.prompt_blob)) {
      return reject("invalid_input", "the group asks the same question twice");
    }
    asked.add(question.prompt_blob);
    if (
      tx.sql.get(
        `select 1 as found from questions q
         join question_groups g on g.id = q."group"
         where g.turn = ? and g.status = 'answered' and q.prompt_blob = ?`,
        [turn.id, question.prompt_blob],
      ) !== undefined
    ) {
      return reject("conflict", "this question was already answered");
    }
  }
  const now = tx.now();
  if (
    input.expires_at !== null &&
    Date.parse(input.expires_at) <= Date.parse(now)
  ) {
    return reject("invalid_input", "the deadline must be in the future");
  }
  const summary = [];
  for (const question of input.questions) {
    const options = [];
    for (const option of question.options) {
      if (option.action !== null) {
        // 권한 부여·외부 효과·등록되지 않은 동작은 선택지로 열 수 없고, 등록된 동작도
        // 소유 command 입력·CAS·지문이 맞아야 고정한다.
        const checked = checkOptionAction(question.id, option.action);
        if (!checked.ok) return checked;
      }
      const fixed = fixedVersionsExist(tx, option);
      if (!fixed.ok) return fixed;
      const changes = settingChangesOf(option);
      if (changes === undefined) {
        return reject("invalid_input", "settings action has no changes");
      }
      options.push({ key: option.key, changes: changes ?? null });
    }
    summary.push({ id: question.id, options });
  }
  const seq = tx.emit(questionCreated, input.id, {
    turn: input.turn,
    session: input.session,
    questions: summary,
  });
  tx.sql.run(
    `insert into question_groups (id, turn, session, created_by, expires_at,
       status, created_seq)
     values (?, ?, ?, ?, ?, 'pending', ?)`,
    [
      input.id,
      input.turn,
      input.session,
      ctx.actor,
      input.expires_at,
      Number(seq),
    ],
  );
  content.questions.forEach((question, index) => {
    tx.sql.run(
      `insert into questions (id, "group", position, prompt_blob, reason_blob,
         options, recommendation)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [
        question.id,
        input.id,
        index + 1,
        question.prompt_blob,
        question.reason_blob,
        JSON.stringify(question.options),
        question.recommendation === null
          ? null
          : JSON.stringify(question.recommendation),
      ],
    );
  });
  const registered = registerTextBlobs(tx, input.id, seq, content.blobs);
  if (!registered.ok) return registered;
  return ok({ id: input.id, status: "pending" as const, created_seq: seq });
}

export function createQuestionCommands(): {
  create: CommandDefinition<typeof createQuestionGroup>;
  answer: CommandDefinition<typeof answerQuestionGroup>;
  answerAction: CommandDefinition<typeof answerQuestionAction>;
  defer: CommandDefinition<typeof deferQuestionGroup>;
  cancel: CommandDefinition<typeof cancelQuestionGroup>;
  expire: CommandDefinition<typeof expireQuestionGroup>;
} {
  return {
    create: {
      route: createQuestionGroup,
      handle: (tx, ctx, input: Input<typeof createQuestionGroup>) =>
        createHandle(tx, ctx, input),
    },
    answer: {
      route: answerQuestionGroup,
      handle: (tx, ctx, input: Input<typeof answerQuestionGroup>, compare) =>
        answerHandle(tx, ctx, input, compare, null),
    },
    answerAction: {
      route: answerQuestionAction,
      handle: (tx, ctx, input: Input<typeof answerQuestionAction>, compare) =>
        answerHandle(
          tx,
          ctx,
          {
            group: input.group,
            created_seq: input.created_seq,
            answers: [{
              question: input.evidence.question,
              answer: input.answer,
            }],
          },
          compare,
          { hash: input.binding_hash, question: input.evidence.question },
        ),
    },
    defer: {
      route: deferQuestionGroup,
      handle(tx, ctx, input: Input<typeof deferQuestionGroup>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const loaded = loadVisible(tx, input.group, () => true);
        if (!loaded.ok) return loaded;
        const { group } = loaded.value;
        if (
          group.created_seq !== compare.created_seq ||
          group.created_seq !== input.created_seq
        ) {
          return reject("conflict", "question group changed");
        }
        // 미루기는 답이 아니다. 묶음 전체를 답 없음으로 닫는다.
        const deferral = deferGroup(
          groupStateOf(group),
          input.created_seq,
          tx.now(),
        );
        if (!deferral.ok) return deferral;
        const seq = tx.emit(questionCancelled, group.id, {
          created_seq: group.created_seq,
          closed_reason_blob: null,
          deferred: true,
        });
        closeGroup(tx, group, {
          status: deferral.value.status,
          seq,
          reason: deferral.value.closed_reason,
        });
        return closedOutput(group, "cancelled", seq, false);
      },
    },
    cancel: {
      route: cancelQuestionGroup,
      handle(tx, ctx, input: Input<typeof cancelQuestionGroup>, compare) {
        const actor = parseActor(ctx.actor);
        if (
          actor === undefined ||
          (actor.kind !== "user" && actor.kind !== "agent" &&
            actor.kind !== "machine")
        ) {
          return reject(
            "forbidden",
            "this actor cannot cancel a question group",
          );
        }
        const loaded = loadVisible(
          tx,
          input.group,
          (turn) => actor.kind !== "agent" || agentOwns(ctx, turn),
        );
        if (!loaded.ok) return loaded;
        const { group, turn } = loaded.value;
        if (
          group.created_seq !== compare.created_seq ||
          group.created_seq !== input.created_seq
        ) {
          return reject("conflict", "question group changed");
        }
        if (group.status !== "pending") {
          return reject("conflict", "the question group is already closed");
        }
        // 묶음을 낸 agent만 자기 묶음을 거두고, machine은 원래 일이 끝났거나 전제가
        // 바뀐(superseded) 묶음만 닫는다.
        if (actor.kind === "agent" && group.created_by !== ctx.actor) {
          return reject("forbidden", "only the asking agent cancels it");
        }
        if (
          actor.kind === "machine" && turn.state !== "finished" &&
          input.closed_reason !== "superseded"
        ) {
          return reject(
            "forbidden",
            "a running question group closes only with a changed premise",
          );
        }
        const reason = textBlob(ctx, input.closed_reason_text);
        const seq = tx.emit(questionCancelled, group.id, {
          created_seq: group.created_seq,
          closed_reason_blob: reason.hash,
          deferred: false,
        });
        closeGroup(tx, group, {
          status: "cancelled",
          seq,
          reason: input.closed_reason,
          reasonBlob: reason.hash,
        });
        const registered = registerTextBlobs(tx, group.id, seq, [{
          field: QUESTION_BLOB_FIELDS.closed,
          blob: reason,
        }]);
        if (!registered.ok) return registered;
        return closedOutput(group, "cancelled", seq, false);
      },
    },
    expire: {
      route: expireQuestionGroup,
      handle(tx, ctx, input: Input<typeof expireQuestionGroup>, compare) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject(
            "forbidden",
            "only the machine expires a question group",
          );
        }
        const loaded = loadVisible(tx, input.group, () => true);
        if (!loaded.ok) return loaded;
        const { group } = loaded.value;
        if (
          group.created_seq !== compare.created_seq ||
          group.created_seq !== input.created_seq
        ) {
          return reject("conflict", "question group changed");
        }
        if (group.status !== "pending") {
          return reject("conflict", "the question group is already closed");
        }
        // 기한이 없거나 아직 오지 않은 묶음은 닫지 않는다.
        if (group.expires_at === null || !pastDeadline(group, tx.now())) {
          return reject("conflict", "the deadline has not passed");
        }
        const seq = tx.emit(questionExpired, group.id, {
          created_seq: group.created_seq,
        });
        closeGroup(tx, group, {
          status: "expired",
          seq,
          reason: "expired",
        });
        return closedOutput(group, "expired", seq, false);
      },
    },
  };
}
