import { z } from "zod";
import { toolKeySchema } from "../apps/channel-values.ts";
import { idSchema } from "../base/ids.ts";
import { toolEffectSchema } from "../lophn-agent/tool-values.ts";
import { permissionDenialSchema } from "./denial.ts";

// 승인 카드 선택지 종류. judgmentSchema와 turn-request.ts가 함께 쓴다.
export const TURN_REQUEST_CHOICES = [
  "once",
  "session",
  "always",
  "reject",
] as const;
export const turnRequestChoiceKindSchema = z.enum(TURN_REQUEST_CHOICES);
export type TurnRequestChoiceKind = z.infer<typeof turnRequestChoiceKindSchema>;

// Gate가 판정하는 호출 하나. kind로 가른다.
// Gate는 core(`packages/core/approvals`)가 구현하는 IO 없는 순수 함수다.
const projectCommandSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().nullable(),
  env_keys: z.array(z.string().min(1)),
});

const askedCallOptions = [
  z.strictObject({
    kind: z.literal("app_tool"),
    app: idSchema("app"),
    tool: toolKeySchema,
    effect: toolEffectSchema,
  }),
  z.strictObject({
    kind: z.literal("mcp_tool"),
    server: z.string().min(1),
    tool: z.string().min(1),
    effect: toolEffectSchema,
    read_only: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("shell"),
    command: z.string().min(1),
    // 명령 없는 대화형 터미널 열기처럼 스캐너와 무관하게 opaque로 판정해야 하는 호출 표시.
    opaque: z.literal(true).optional(),
  }),
  // 등록 폴더 밖이나 민감 경로(.env* 등) 파일 읽기.
  z.strictObject({
    kind: z.literal("file_read"),
    path: z.string().min(1),
    folder: z.string().min(1),
    outside_workspace: z.boolean(),
    sensitive: z.boolean(),
  }),
  // 파일 쓰기·편집·삭제. 폴더 밖이거나 민감 경로(.git/hooks/*, .lophn/tools/* 등)일 수 있다.
  z.strictObject({
    kind: z.literal("file_write"),
    path: z.string().min(1),
    folder: z.string().min(1),
    outside_workspace: z.boolean(),
    sensitive: z.boolean(),
    action: z.enum(["write", "edit", "delete"]),
  }),
  // `.lophn/tools/*`·`<data root>/tools/*` 로컬 스크립트 실행. 처음이거나 sha256이 바뀌면 묻는다.
  z.strictObject({
    kind: z.literal("local_tool"),
    name: z.string().min(1),
    path: z.string().min(1),
    sha256: z.string().min(1),
    changed: z.boolean(),
  }),
  // agent가 사람의 허락이 드는 설정(선언 `approval: "person"`)을 바꾼다. lines는 core가 선언의 describe(before, after)로
  // 만든 영어 줄이고 카드가 줄이지 않고 그대로 보인다. always가 없다(always_patterns는 빈 목록).
  z.strictObject({
    kind: z.literal("setting"),
    key: z.string().min(1),
    lines: z.array(z.string().min(1)).min(1),
  }),
  // agent가 ask_before_run이 켜진 project command를 실행하려 한다. env는 key 이름만 싣는다. always가 없다.
  z.strictObject({
    kind: z.literal("project_command"),
    project: idSchema("prj"),
    command_id: z.string().min(1),
    name: z.string().min(1),
    command: z.string().min(1),
    cwd: z.string().nullable(),
    env_keys: z.array(z.string().min(1)),
  }),
  // agent가 project command 정의를 추가·수정·삭제하려 한다. 바뀌기 전과 뒤의 이름·원문·cwd·env key를 싣는다. always가 없다.
  z.strictObject({
    kind: z.literal("project_command_definition"),
    project: idSchema("prj"),
    action: z.enum(["add", "update", "remove"]),
    before: projectCommandSummarySchema.nullable(),
    after: projectCommandSummarySchema.nullable(),
  }),
  // agent가 일회성 workflow를 시작하거나 기존 workflow를 instance 전용으로 override해 시작·패치하려 한다.
  // lines는 core가 검증된 선언·diff에서 결정적으로 만든 요약 줄이고 always가 없다.
  z.strictObject({
    kind: z.literal("workflow_run"),
    project: idSchema("prj"),
    mode: z.enum(["one_off", "override", "override_code"]),
    workflow: z.string().min(1),
    execution: z.enum(["agent", "flow"]),
    lines: z.array(z.string().min(1)).min(1),
  }),
] as const;

// 사람에게 물을 수 있는 호출이다. 승인 카드(turn request)와 ACP 승인 subject가 이것만 쓴다.
export const askedCallSchema = z.discriminatedUnion("kind", askedCallOptions);

export const gateCallSchema = z.discriminatedUnion("kind", askedCallOptions);
export type GateCall = z.infer<typeof gateCallSchema>;
export type AskedCall = z.infer<typeof askedCallSchema>;

// harness가 파일 바꾸기를 승인에 올린다. core Gate가 판정하는 호출이 아니라 ACP 승인 카드의 subject만 넓힌다.
// added·removed는 줄 수이고 모르면 null이다.
export const fileChangeSubjectSchema = z.strictObject({
  kind: z.literal("file_change"),
  changes: z.array(
    z.strictObject({
      path: z.string().min(1),
      change: z.enum(["create", "update", "delete"]),
      added: z.number().int().nonnegative().nullable(),
      removed: z.number().int().nonnegative().nullable(),
    }),
  ),
});
// harness의 plan 승인 카드다. `modes`는 harness가 주는 "승인하고 이렇게 이어 간다" 단추(Claude "Accept edits"·"Ask for
// edits", omp execute·keep context 등)이고 화면은 해석하지 않는다. 이 카드의 `pending.approval.choices`는 `["reject"]`이고
// (거절 = 계속 plan, 이유 글이 feedback이다) 승인은 `decide {kind: "mode"}`로 한다.
export const planSubjectSchema = z.strictObject({
  kind: z.literal("plan"),
  plan: z.string(),
  modes: z
    .array(z.strictObject({ id: z.string().min(1), label: z.string() }))
    .min(1),
});
export const acpApprovalSubjectSchema = z.discriminatedUnion("kind", [
  ...askedCallSchema.options,
  fileChangeSubjectSchema,
  planSubjectSchema,
]);
export type AcpApprovalSubject = z.infer<typeof acpApprovalSubjectSchema>;

export const judgmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run") }),
  z.strictObject({
    kind: z.literal("ask"),
    reason: z.string().nullable(),
    outside_rewind: z.boolean(),
    allowed_choices: z.array(turnRequestChoiceKindSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("deny"),
    denial: permissionDenialSchema,
  }),
]);
export type Judgment = z.infer<typeof judgmentSchema>;
