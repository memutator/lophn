import { z } from "zod";
import { atSchema, seqSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { modelChoiceOutputSchema, modelChoiceSchema } from "./models.ts";

// Session은 agent 하나와 workspace 하나(없으면 home)에 고정된다.
// agent나 workspace를 바꾸는 command가 없다. 사람이 session을 치우는 길은 archive와 delete다.

// 제목의 글자는 사람이 보는 글자(grapheme cluster)다. 이모지나 결합 문자를 중간에서
// 자르지 않는다. 자동 제목은 앞 60자, 사람이 rename한 제목은 120자 이하다.
export const SESSION_AUTO_TITLE_MAX = 60;
const SESSION_RENAME_TITLE_MAX = 120;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function sessionTitleLength(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

// 비어 있거나 공백뿐인 제목은 제목이 아니다. 길이는 앞뒤 공백을 뺀 글로 센다. 번호 이름("Conversation N")은 만들지 않는다.
export const sessionTitleSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "expected a nonblank title",
  })
  .refine(
    (value) => sessionTitleLength(value.trim()) <= SESSION_RENAME_TITLE_MAX,
    { message: "title is longer than 120 characters" },
  );

const forkOriginFields = {
  session: idSchema("ses"),
  through_seq: seqSchema,
};
export const forkOriginOutputSchema = z.object(forkOriginFields);

// 사람이 부른 Compact의 마지막 구간. 요약 본문은 derived이고 원문을 대체하지 않는다.
const compactionFields = {
  through_seq: seqSchema,
  summary_call: idSchema("mcl"),
};
export const compactionOutputSchema = z.object(compactionFields);

const stateSeqCompareSchema = z.strictObject({ state_seq: seqSchema });

const renameSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
  title: sessionTitleSchema,
});
const renameSessionCompareSchema = stateSeqCompareSchema;

const archiveSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
});
const archiveSessionCompareSchema = stateSeqCompareSchema;

const deleteSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
});
const deleteSessionCompareSchema = stateSeqCompareSchema;

// Fork: 같은 agent·같은 자리의 새 session. 사람이 고른 지점(through_seq)까지의 확정 메시지만
// 복사한다.
const forkSessionInputSchema = z
  .strictObject({
    id: idSchema("ses"),
    source: idSchema("ses"),
    through_seq: seqSchema,
  })
  .refine((value) => value.id !== value.source, {
    message: "a session cannot fork from itself",
  });

// Compact는 두 걸음이다. 사람이 요청하면(RequestSessionCompact) runtime이 앞 구간을 요약하는 model
// call을 하고, 끝까지 성공한 그 call을 구간과 함께 session에 이어(CompactSession) 요청을 끝낸다.
// 실패하면 이유와 함께 요청만 닫는다(FailSessionCompact). 어느 쪽이든 원문과 session의 나머지는
// 바뀌지 않는다.
const COMPACT_FAILURE_REASONS = [
  "nothing_to_summarize",
  "model_unavailable",
  "model_failed",
  "too_large",
  "summary_too_long",
  "session_changed",
] as const;
export const compactFailureReasonSchema = z.enum(COMPACT_FAILURE_REASONS);
export type CompactFailureReason = (typeof COMPACT_FAILURE_REASONS)[number];

const requestSessionCompactInputSchema = z.strictObject({
  session: idSchema("ses"),
});
const requestSessionCompactCompareSchema = z.strictObject({
  state: z.literal("open"),
  state_seq: seqSchema,
});

const compactSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
  summary_call: idSchema("mcl"),
  // 요약이 덮는 마지막 메시지의 순번. runtime이 요약 재료를 모은 때의 마지막 메시지다.
  through_seq: seqSchema,
});
const compactSessionCompareSchema = z.strictObject({
  state: z.literal("open"),
  request_seq: seqSchema,
});

const failSessionCompactInputSchema = z.strictObject({
  session: idSchema("ses"),
  reason: compactFailureReasonSchema,
});
const failSessionCompactCompareSchema = z.strictObject({
  request_seq: seqSchema,
});

// null은 agent 기본값으로 돌아간다.
const changeSessionModelInputSchema = z.strictObject({
  session: idSchema("ses"),
  model: modelChoiceSchema.nullable(),
});
const changeSessionModelCompareSchema = z.strictObject({
  state: z.literal("open"),
  state_seq: seqSchema,
});

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unauthorized",
] as const;

export const renameSession = defineCommand({
  resource: "sessions",
  method: "rename",
  name: "RenameSession",
  input: renameSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    title: sessionTitleSchema,
    state_seq: seqSchema,
  }),
  compare: renameSessionCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "unauthorized"],
});

export const archiveSession = defineCommand({
  resource: "sessions",
  method: "archive",
  name: "ArchiveSession",
  input: archiveSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    archived: z.literal(true),
    state_seq: seqSchema,
  }),
  compare: archiveSessionCompareSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "unauthorized", "invalid_input"],
});

// 되돌릴 수 없다. 도는 turn은 interrupted(session_ended)로 닫고 진행한다. 그 turn이 만든 문서·앱 변경은 지우지
// 않는다. 결과는 지운 사실의 최소 기록뿐이다.
export const deleteSession = defineCommand({
  resource: "sessions",
  method: "delete",
  name: "DeleteSession",
  input: deleteSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    deleted_at: atSchema,
  }),
  compare: deleteSessionCompareSchema,
  actors: ["user"],
  errors: [
    "not_found",
    "conflict",
    "forbidden",
    "unauthorized",
    "invalid_input",
  ],
});

export const forkSession = defineCommand({
  resource: "sessions",
  method: "fork",
  name: "ForkSession",
  input: forkSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    state: z.literal("open"),
    forked_from: forkOriginOutputSchema,
    copied_messages: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    state_seq: seqSchema,
  }),
  actors: ["user"],
  errors: [...errors],
});

export const requestSessionCompact = defineCommand({
  resource: "sessions",
  method: "request-compact",
  name: "RequestSessionCompact",
  input: requestSessionCompactInputSchema,
  output: z.object({
    id: idSchema("ses"),
    // 요청 event의 순번이 요청의 이름이다.
    request_seq: seqSchema,
  }),
  compare: requestSessionCompactCompareSchema,
  // 사람의 Compact와, 이전 대화가 커진 session을 다음 turn 전에 runtime(machine)이 여는 Compact다.
  actors: ["user", "machine"],
  errors: [...errors],
});

export const compactSession = defineCommand({
  resource: "sessions",
  method: "compact",
  name: "CompactSession",
  input: compactSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    compaction: compactionOutputSchema,
    state_seq: seqSchema,
  }),
  compare: compactSessionCompareSchema,
  actors: ["machine"],
  errors: [...errors, "unavailable"],
});

export const failSessionCompact = defineCommand({
  resource: "sessions",
  method: "fail-compact",
  name: "FailSessionCompact",
  input: failSessionCompactInputSchema,
  output: z.object({
    id: idSchema("ses"),
    request_seq: seqSchema,
    reason: compactFailureReasonSchema,
  }),
  compare: failSessionCompactCompareSchema,
  actors: ["machine"],
  errors: [...errors],
});

export const changeSessionModel = defineCommand({
  resource: "sessions",
  method: "change-model",
  name: "ChangeSessionModel",
  input: changeSessionModelInputSchema,
  output: z.object({
    id: idSchema("ses"),
    model_selection: modelChoiceOutputSchema.nullable(),
    state_seq: seqSchema,
  }),
  compare: changeSessionModelCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "unauthorized"],
});

export const changeSessionSkip = defineCommand({
  resource: "sessions",
  method: "change-skip",
  name: "ChangeSessionSkip",
  input: z.strictObject({ session: idSchema("ses"), skip: z.boolean() }),
  output: z.object({
    id: idSchema("ses"),
    skip: z.boolean(),
    state_seq: seqSchema,
  }),
  compare: z.strictObject({ state_seq: seqSchema }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "unauthorized"],
});

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// Compact가 session에 이은 요약의 본문이다. 요약은 원문을 대체하지 않는 derived라 호출의 출력이
// 정본이고, 사람 화면은 이 본문을 일반 agent 답과 구별해 보인다. `revert`를 주면 그
// rewind("Summarize from here")가 접은 구간의 요약을 읽는다: compaction은 접힌 구간의 끝(result_seq)과
// 그 요약 call이다.
export const sessionSummary = defineRead({
  resource: "sessions",
  method: "summary",
  name: "ReadSessionSummary",
  input: z.strictObject({
    session: idSchema("ses"),
    revert: idSchema("rwd").optional(),
  }),
  output: withReadCommon(
    z.object({
      session: idSchema("ses"),
      compaction: compactionOutputSchema,
      text: z.string(),
    }),
  ),
  actors: ["user", "agent", "machine"],
  errors: [...readErrors],
});

// 지운 내용은 싣지 않는다.

// subject는 새 session이다.

export const SESSION_COMMANDS = [
  renameSession,
  archiveSession,
  deleteSession,
  forkSession,
  requestSessionCompact,
  compactSession,
  failSessionCompact,
  changeSessionModel,
  changeSessionSkip,
  sessionSummary,
] as const;
