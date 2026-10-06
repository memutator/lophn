import { z } from "zod";
import { err, fingerprint, ok, type Result } from "../../../../base/mod.ts";
import {
  agentRoleSchema,
  fixedVersionReferenceSchema,
  handoffContentSchema,
  handoffReferenceSchema,
  operatorApprovalBundleSchema,
  questionTextSchema,
  readCursorSchema,
  roleKindSchema,
} from "../../../../contracts/lophn-agent/mod.ts";
import {
  type ApprovalAction,
  approvalBindingHash,
  atSchema,
  idSchema,
} from "../../../../contracts/platform/mod.ts";
import { handoffBodyHash } from "../../../handoff/mod.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  passThrough,
  READ,
  success,
} from "./common.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";

// 사람 결정·agent 일 tool 묶음(concern harness/tools, domain model presets의 공통·역할
// 묶음). 이름은 `<영역>.<동작>`이고 tool 하나는 소유 contract 하나다. preset·assignment
// tool은 구성·판·담당 현황을 읽기만 한다. 실제 생성·변경·적용은 사람 결정의 owner command
// 몫이라 이 묶음에 변경 tool은 없다(R10). 초안 제출(`approval.submit_assignment`)은
// Operator 승인 bundle 묶음을 정하는 lophn-agent#T52가 여기 둔다.

export const AGENT_TOOL_REVISION = "2026-10-07";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    AGENT_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

// 질문 선택지에는 고정 action을 모델이 싣지 않는다. action은 사람이 열람한 owner 동작을
// 고정하는 별도 경로(lophn-agent#T29)가 정한다.
const questionOption = z.strictObject({
  key: z.string().regex(/\S/),
  label: z.string().regex(/\S/),
  description: questionTextSchema,
  evidence: z.array(fixedVersionReferenceSchema),
  adoption: fixedVersionReferenceSchema.nullable(),
  action: z.null(),
});

export const questionSubmitInput = z.strictObject({
  prompt: questionTextSchema,
  reason: questionTextSchema,
  options: z.array(questionOption),
  recommendation: z.strictObject({
    option_key: z.string().regex(/\S/).nullable(),
    explanation: questionTextSchema,
  }).nullable(),
  expires_at: atSchema.nullable(),
});

const questionReadInput = z.strictObject({ question: idSchema("qst") });
const approvalReadInput = z.strictObject({ approval: idSchema("apr") });
const presetListInput = z.strictObject({
  kind: agentRoleSchema.optional(),
  cursor: readCursorSchema.optional(),
});
const presetReadInput = z.strictObject({ preset: idSchema("pst") });
const assignmentListInput = z.strictObject({
  role: agentRoleSchema.optional(),
  cursor: readCursorSchema.optional(),
});
const assignmentReadInput = z.strictObject({ assignment: idSchema("asg") });
const runResultInput = z.strictObject({ run: idSchema("run") });

// 모델이 보내는 handoff 입력이다. 보낸 run·원래 사람 요청·보낸 역할·내용 hash·수신 run ID는
// 모델이 정하지 않는다. 호출 run의 사실과 core 준비 값에서 handler가 채운다. 발신 권한·
// approval·세션·tool 기록을 실을 필드가 없다(handoff R4, R6).
export const handoffSubmitInput = z.strictObject({
  receiver_assignment: idSchema("asg"),
  to_role: roleKindSchema,
  ...handoffContentSchema.shape,
  references: z.array(handoffReferenceSchema),
  // 같은 handoff를 다시 보낼 때 같은 값을 쓴다. 같은 값은 수신 run 하나만 만든다(R9).
  dedup_key: z.string().min(1).max(128).regex(/^[^\p{Cc}]*\S[^\p{Cc}]*$/u),
});

// 몫이라 이 묶음에 변경 tool은 없다(R10). 초안·approval 제출(`approval.submit_assignment`)은
// bundle 모양을 정하는 lophn-agent#T52가 같은 묶음에 더한다.
const handoffStatusInput = z.strictObject({
  dedup_key: z.string().min(1).max(128),
});
const handoffResultInput = z.strictObject({ receiver_run: idSchema("run") });

// Operator 초안 제출의 입력은 승인에 묶일 bundle 전체다(presets#R15, assignments#R5).
// 사람이 검토·승인한 모양 그대로 적용되는 값이고 모델이 자유 텍스트로 쓰지 않는다.
export const approvalSubmitAssignmentInput = operatorApprovalBundleSchema;

export const questionSubmitTool = define(
  "question.submit",
  "Ask the person one question that needs their intent, taste, or interpretation.",
  questionSubmitInput,
  "CreateQuestion",
  {
    effect: "write",
    scopeCheck: "the calling run",
    reversible: true,
    idempotent: false,
  },
);
export const questionReadDecisionTool = define(
  "question.read_decision",
  "Read a question of this assignment and the answer, if any.",
  questionReadInput,
  "ReadQuestion",
  { ...READ, scopeCheck: "questions of this assignment" },
);
export const approvalReadDecisionTool = define(
  "approval.read_decision",
  "Read an approval request and the decision on it.",
  approvalReadInput,
  "GetApproval",
  { ...READ, scopeCheck: "approvals the run asked for" },
);
export const presetListTool = define(
  "preset.list",
  "List presets. This changes nothing.",
  presetListInput,
  "ListPresets",
  { ...READ, scopeCheck: "readable presets" },
);
export const presetReadTool = define(
  "preset.read",
  "Read one preset. This changes nothing.",
  presetReadInput,
  "ReadPreset",
  { ...READ, scopeCheck: "readable presets" },
);
export const assignmentListTool = define(
  "assignment.list",
  "List assignments and who currently takes work. This changes nothing.",
  assignmentListInput,
  "ListAssignments",
  { ...READ, scopeCheck: "readable assignments" },
);
export const assignmentReadTool = define(
  "assignment.read",
  "Read one assignment. This changes nothing.",
  assignmentReadInput,
  "ReadAssignment",
  { ...READ, scopeCheck: "readable assignments" },
);
export const runReadResultTool = define(
  "run.read_result",
  "Read the state and final result of a run of this assignment.",
  runResultInput,
  "ReadRunResult",
  { ...READ, scopeCheck: "runs of this assignment" },
);
export const handoffSubmitTool = define(
  "handoff.submit",
  "Hand work to another role's assignment with what, why, exclusions, expected outputs, and fixed versions.",
  handoffSubmitInput,
  "SubmitHandoff",
  {
    effect: "write",
    scopeCheck: "the calling run that continues a person's request",
    reversible: true,
    idempotent: true,
  },
);
export const handoffReadStatusTool = define(
  "handoff.read_status",
  "Read the state of a handoff this run sent.",
  handoffStatusInput,
  "ReadHandoffStatus",
  { ...READ, scopeCheck: "handoffs this assignment sent or received" },
);
export const handoffReadResultTool = define(
  "handoff.read_result",
  "Read the result of a handoff: a fixed document version or the reason there is none.",
  handoffResultInput,
  "ReadHandoffResult",
  { ...READ, scopeCheck: "handoffs this assignment sent or received" },
);

// Operator 초안 제출(presets#R15, assignments#R4, tool-judgment#R8). 초안 bundle은
// 사람 리뷰용이다: scope·outputs·read 선언·schedule·전후 이유가 묶인다. 승인에
// 고정하는 동작은 승인 후 apply다(assignments#R5): 이 tool은 제출만 하고
// platform/approvals의 소유 contract로 사람 결정을 연다(P9). bundle 모양은
// contracts의 operatorApprovalBundleSchema다(lophn-agent#T52).
export const approvalSubmitAssignmentTool = define(
  "approval.submit_assignment",
  "Submit an Operator assignment draft bundle for a person to review and approve.",
  approvalSubmitAssignmentInput,
  "create_approval_request",
  {
    effect: "write",
    scopeCheck: "the drafting role's proposal",
    reversible: true,
    idempotent: true,
  },
);

export const AGENT_TOOLS: readonly ToolDefinition[] = [
  questionSubmitTool,
  questionReadDecisionTool,
  approvalReadDecisionTool,
  presetListTool,
  presetReadTool,
  assignmentListTool,
  assignmentReadTool,
  runReadResultTool,
  handoffSubmitTool,
  handoffReadStatusTool,
  handoffReadResultTool,
  approvalSubmitAssignmentTool,
];

// handler가 소유 contract를 부르는 통로다. 실제 연결(core client)은 agent runtime 조립이
// 넣는다. `call`은 contract 이름 하나와 그 입력 하나이고 여러 영역의 숨은 절차는 없다.
export type AgentToolPorts = ContractCall & {
  newId(prefix: "qst" | "run" | "msg" | "apr"): string;
  // 호출 run이 이어진 사실. 질문의 session과 handoff의 보낸 역할·원래 사람 요청,
  // 초안 제출의 요청 assignment를 정한다.
  runFacts(run: string): Promise<
    Result<{
      session: string | null;
      role: z.infer<typeof roleKindSchema>;
      original_message: string | null;
      assignment: string;
    }>
  >;
};

// 정의별 handler다. 입력은 실행기가 정의 schema로 이미 검사했다. 소유 contract가 거절하면
// 그 오류를 그대로 돌려주고 실행기가 안전한 문장으로 포장한다(범위 밖은 없는 대상과 같다).
export function createAgentToolHandlers(
  ports: AgentToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  handlers.set(
    questionSubmitTool.name,
    async (input, credential: RunCredential) => {
      const value = input as z.infer<typeof questionSubmitInput>;
      const facts = await ports.runFacts(credential.run);
      if (!facts.ok) return facts;
      const id = ports.newId("qst");
      const created = await ports.call("CreateQuestion", {
        id,
        run: credential.run,
        session: facts.value.session,
        ...value,
      }, credential.run);
      if (!created.ok) return created;
      return ok(success("question asked", created.value));
    },
  );
  const passes: [ToolDefinition, string][] = [
    [questionReadDecisionTool, "question read"],
    [approvalReadDecisionTool, "approval read"],
    [presetListTool, "presets listed"],
    [presetReadTool, "preset read"],
    [assignmentListTool, "assignments listed"],
    [assignmentReadTool, "assignment read"],
    [runReadResultTool, "run result read"],
    [handoffReadResultTool, "handoff result read"],
  ];
  for (const [definition, summary] of passes) {
    handlers.set(
      definition.name,
      (input, credential) =>
        passThrough(ports, definition.contract, summary, input, credential.run),
    );
  }
  // 현황은 보낸 run과 중복 방지 key로 묻는다. 보낸 run은 호출 run이다.
  handlers.set(
    handoffReadStatusTool.name,
    (input, credential) =>
      passThrough(
        ports,
        handoffReadStatusTool.contract,
        "handoff status read",
        {
          sender_run: credential.run,
          ...(input as z.infer<typeof handoffStatusInput>),
        },
        credential.run,
      ),
  );
  handlers.set(
    handoffSubmitTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof handoffSubmitInput>;
      const facts = await ports.runFacts(credential.run);
      if (!facts.ok) return facts;
      // 원래 사람 요청이 없는 run(주기 회차)은 보내지 못한다. command가 다시 검사한다.
      if (facts.value.original_message === null) {
        return err({
          code: "forbidden",
          message: "this run does not continue a person's request",
        });
      }
      const content = {
        what: value.what,
        why: value.why,
        excludes: value.excludes,
        expected_outputs: value.expected_outputs,
      };
      const sent = await ports.call("SubmitHandoff", {
        sender_run: credential.run,
        receiver_run: ports.newId("run"),
        receiver_assignment: value.receiver_assignment,
        from_role: facts.value.role,
        to_role: value.to_role,
        original_message: facts.value.original_message,
        content,
        // core가 redaction 뒤 같은 bytes의 hash로 맞춘다.
        body: handoffBodyHash(content),
        references: value.references,
        dedup_key: value.dedup_key,
      }, credential.run);
      if (!sent.ok) return sent;
      return ok(success("handoff sent", sent.value));
    },
  );
  // 초안 번들은 그대로 approval의 action 입력이 된다. id·요청자·run·기한은 모델이
  // 정하지 않는다: handler가 호출 run의 사실과 core 준비 값에서 채운다(P9, R4).
  // 대상은 승인이 묶을 assignment 하나다(생성은 preset 판 reviewer가 고른다).
  handlers.set(
    approvalSubmitAssignmentTool.name,
    async (input, credential: RunCredential) => {
      const value = input as z.infer<typeof approvalSubmitAssignmentInput>;
      const facts = await ports.runFacts(credential.run);
      if (!facts.ok) return facts;
      // approval에 고정하는 동작은 승인 뒤 사람이 결정하고 machine이 내는
      // ApplyOperatorAssignment다(assignments#R5). action의 입력은 apply 그대로다:
      // 승인이 확정한 decision·bundle이 그대로 적용된다(apply.ts의 dispatch).
      const bundle = {
        ...value,
        assignment: value.assignment ?? facts.value.assignment,
      };
      const base = {
        concern: "lophn-agent/assignments",
        command: "ApplyOperatorAssignment",
        caller: `agent:${facts.value.assignment}` as ApprovalAction["caller"],
        targets: [value.assignment ?? value.preset],
        input: { kind: "inline" as const, value: bundle },
        input_hash: await fingerprint(bundle),
        comparison: {},
      };
      const action: ApprovalAction = {
        ...base,
        binding_hash: await approvalBindingHash({ ...base, binding_hash: "0" }),
      };
      // 이 tool은 제출만 한다: 적용은 승인 뒤 사람 decision의 apply다.
      const submitted = await ports.call("create_approval_request", {
        id: ports.newId("apr"),
        requester: `agent:${facts.value.assignment}`,
        run: credential.run,
        reason: value.reason,
        effect: {
          changes: "an Operator assignment draft applied as reviewed",
          external: null,
          reversible: true,
          reversibility: "the person can pause or withdraw the assignment",
        },
        action,
        expires_at: null,
      }, credential.run);
      if (!submitted.ok) return submitted;
      return ok(success("assignment draft submitted", submitted.value));
    },
  );
  return handlers;
}
