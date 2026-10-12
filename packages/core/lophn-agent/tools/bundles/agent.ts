import { z } from "zod";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  agentRoleSchema,
  fixedVersionReferenceSchema,
  handoffContentSchema,
  handoffReferenceSchema,
  QUESTION_GROUP_MAX_QUESTIONS,
  QUESTION_GROUP_MIN_QUESTIONS,
  questionTextSchema,
  readCursorSchema,
  roleKindSchema,
} from "../../../../protocol/lophn-agent/mod.ts";
import { appCreateInputSchema } from "../../../../protocol/apps/mod.ts";
import { atSchema, idSchema } from "../../../../protocol/base/mod.ts";
import { handoffBodyHash } from "../handoff/mod.ts";
import { appCreateOptionAction } from "../questions/mod.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  passThrough,
  READ,
  success,
} from "./common.ts";
import {
  documentMoveAction,
  fixedDocumentMove,
  fixedSettingChange,
  settingChangeAction,
} from "./question-actions.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";

// 사람 결정·agent 일 tool 묶음(concern harness/tools, domain model presets의 공통·역할
// 묶음). 이름은 `<영역>.<동작>`이고 tool 하나는 소유 contract 하나다. preset·assignment
// tool은 구성·판·담당 현황을 읽기만 한다. 실제 생성·변경·적용은 사람 결정의 owner command
// 몫이라 이 묶음에 변경 tool은 없다. 초안 제출(`approval.submit_assignment`)은
// Operator 승인 bundle 묶음을 정할 때 여기 둔다.

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

// 질문 선택지에 고정 action 객체는 모델이 싣지 않는다. 새 앱 등록은 `app_registration`으로만
// 제안할 수 있고, handler가 고정 action을 만든다. app.create는 handler가 앱 ID를 미리 배정하고
// 선택지의 근거 판(evidence 하나)을 등록 근거 판으로 고정한다. 설정 변경(`setting_change`)과 문서 자리
// 이동(`document_move`)도 대상과 새 값만 제안하고 현재 값·revision 같은 비교 기준은 handler가
// 읽어 고정한다(question-actions.ts).
const fixedAppRegistration = appCreateInputSchema.pick({
  slug: true,
  name: true,
  description: true,
});
const questionOption = z.strictObject({
  key: z.string().regex(/\S/),
  label: z.string().regex(/\S/),
  description: questionTextSchema,
  evidence: z.array(fixedVersionReferenceSchema),
  adoption: fixedVersionReferenceSchema.nullable(),
  action: z.null(),
  app_registration: fixedAppRegistration.optional(),
  setting_change: fixedSettingChange.optional(),
  document_move: fixedDocumentMove.optional(),
});

// 질문 하나는 독립 결정 하나다. 묶음의 ID와 질문 ID는 모델이 정하지 않고 handler가 배정한다.
const questionSubmitQuestion = z.strictObject({
  prompt: questionTextSchema,
  reason: questionTextSchema,
  options: z.array(questionOption),
  recommendation: z.strictObject({
    option_key: z.string().regex(/\S/).nullable(),
    explanation: questionTextSchema,
  }).nullable(),
});

// 한 번에 질문 1~4개의 묶음을 낸다. 사람은 묶음 전체에 Submit 한 번으로 답한다.
// 기한은 묶음 하나가 가진다.
export const questionSubmitInput = z.strictObject({
  questions: z.array(questionSubmitQuestion)
    .min(QUESTION_GROUP_MIN_QUESTIONS)
    .max(QUESTION_GROUP_MAX_QUESTIONS),
  expires_at: atSchema.nullable(),
});

const questionReadInput = z.strictObject({ group: idSchema("qgr") });
const approvalReadInput = z.strictObject({ approval: idSchema("apr") });
const assignmentListInput = z.strictObject({
  role: agentRoleSchema.optional(),
  cursor: readCursorSchema.optional(),
});
const assignmentReadInput = z.strictObject({ assignment: idSchema("asg") });
const runResultInput = z.strictObject({ run: idSchema("run") });

// 모델이 보내는 handoff 입력이다. 보낸 run·원래 사람 요청·보낸 역할·내용 hash·수신 run ID는
// 모델이 정하지 않는다. 호출 run의 사실과 core 준비 값에서 handler가 채운다. 발신 권한·
// approval·세션·tool 기록을 실을 필드가 없다.
export const handoffSubmitInput = z.strictObject({
  receiver_assignment: idSchema("asg"),
  to_role: roleKindSchema,
  ...handoffContentSchema.shape,
  references: z.array(handoffReferenceSchema),
  // 같은 handoff를 다시 보낼 때 같은 값을 쓴다. 같은 값은 수신 run 하나만 만든다.
  dedup_key: z.string().min(1).max(128).regex(/^[^\p{Cc}]*\S[^\p{Cc}]*$/u),
});

// 몫이라 이 묶음에 변경 tool은 없다. 초안·approval 제출(`approval.submit_assignment`)은
// bundle 모양을 정할 때 같은 묶음에 더한다.
const handoffStatusInput = z.strictObject({
  dedup_key: z.string().min(1).max(128),
});
const handoffResultInput = z.strictObject({ receiver_run: idSchema("run") });

export const questionSubmitTool = define(
  "question.submit",
  "Ask the person one to four independent questions at once, each needing their intent, taste, or interpretation. A question whose option fixes an action is the only question of its group.",
  questionSubmitInput,
  "CreateQuestionGroup",
  {
    effect: "write",
    scopeCheck: "the calling run",
    reversible: true,
    idempotent: false,
  },
);
export const questionReadDecisionTool = define(
  "question.read_decision",
  "Read a question group of this assignment and the answers, if any.",
  questionReadInput,
  "ReadQuestionGroup",
  { ...READ, scopeCheck: "question groups of this assignment" },
);
export const approvalReadDecisionTool = define(
  "approval.read_decision",
  "Read an approval request and the decision on it.",
  approvalReadInput,
  "GetApproval",
  { ...READ, scopeCheck: "approvals the run asked for" },
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

export const AGENT_TOOLS: readonly ToolDefinition[] = [
  questionSubmitTool,
  questionReadDecisionTool,
  approvalReadDecisionTool,
  assignmentListTool,
  assignmentReadTool,
  runReadResultTool,
  handoffSubmitTool,
  handoffReadStatusTool,
  handoffReadResultTool,
];

// handler가 소유 contract를 부르는 통로다. 실제 연결(core client)은 agent runtime 조립이
// 넣는다. `call`은 contract 이름 하나와 그 입력 하나이고 여러 영역의 숨은 절차는 없다.
export type AgentToolPorts = ContractCall & {
  newId(prefix: "qgr" | "qst" | "run" | "msg" | "apr" | "asg" | "app"): string;
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
      // 고정 action이 있는 선택지를 가진 질문은 질문 하나짜리 묶음으로만 낸다.
      // 읽기·고정 전에 먼저 거절한다. command도 같은 검사를 한다.
      const proposesAction = value.questions.some((question) =>
        question.options.some((option) =>
          option.app_registration !== undefined ||
          option.setting_change !== undefined ||
          option.document_move !== undefined
        )
      );
      if (proposesAction && value.questions.length > 1) {
        return err({
          code: "invalid_input",
          message: "a question with a fixed action must be a group of one",
        });
      }
      const group = ports.newId("qgr");
      const questions = [];
      for (const question of value.questions) {
        const id = ports.newId("qst");
        const options = [];
        for (const option of question.options) {
          const {
            app_registration: registration,
            setting_change: setting,
            document_move: move,
            ...rest
          } = option;
          const fixes = [registration, setting, move].filter((
            fixed,
          ) => fixed !== undefined).length;
          if (fixes > 1) {
            return err({
              code: "invalid_input",
              message: "an option fixes one action",
            });
          }
          if (setting !== undefined || move !== undefined) {
            const run = { ports, run: credential.run };
            const action = setting !== undefined
              ? await settingChangeAction(run, id, setting)
              : await documentMoveAction(run, move!);
            if (!action.ok) return action;
            options.push({ ...rest, action: action.value });
            continue;
          }
          if (registration !== undefined) {
            // 등록 근거 판은 선택지의 근거 하나다. 그 판이 실제 판인지는 질문 command가 확인한다.
            const [plan, ...others] = rest.evidence;
            if (
              plan === undefined || others.length > 0 || plan.section !== null
            ) {
              return err({
                code: "invalid_input",
                message:
                  "a registration option names the plan it registers from as its one evidence",
              });
            }
            options.push({
              ...rest,
              action: appCreateOptionAction({
                id: ports.newId("app"),
                ...registration,
                planning_version: plan.version,
              }),
            });
            continue;
          }
          options.push(rest);
        }
        questions.push({
          id,
          prompt: question.prompt,
          reason: question.reason,
          options,
          recommendation: question.recommendation,
        });
      }
      const created = await ports.call(
        "CreateQuestionGroup",
        {
          id: group,
          run: credential.run,
          session: facts.value.session,
          questions,
          expires_at: value.expires_at,
        },
        credential.run,
        credential.call === undefined
          ? undefined
          : { idempotency_key: credential.call },
      );
      if (!created.ok) return created;
      return ok(success("question group asked", created.value));
    },
  );
  const passes: [ToolDefinition, string][] = [
    [questionReadDecisionTool, "question read"],
    [approvalReadDecisionTool, "approval read"],
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
  return handlers;
}
