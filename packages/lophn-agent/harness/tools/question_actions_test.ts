import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../../base/mod.ts";
import {
  AGENT_TOOLS,
  type AgentToolPorts,
  BUILTIN_TOOLS,
  createAgentToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
} from "./mod.ts";
import { checkOptionAction } from "../../questions/mod.ts";

// question.submit의 설정 변경·문서 이동 제안(roles/lophn#R21, questions#R13): 모델은 대상과
// 새 값만 제안하고 현재 값·revision 같은 비교 기준과 고정 action은 handler가 읽어 고정한다.

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const ASG = "asg_01arz3ndektsv4rrffq69g5fbw";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const PRJ = "prj_01arz3ndektsv4rrffq69g5fav";
const KEY = "shell.reading_width";

type Call = { contract: string; input: unknown };

function setup(options: {
  current?: unknown;
  resolved?: boolean;
  status?: string;
  missingKey?: boolean;
} = {}) {
  const calls: Call[] = [];
  const handlers = createAgentToolHandlers(
    {
      call: (contract, input): Promise<Result<unknown>> => {
        calls.push({ contract, input });
        if (contract === "SettingsDefinitions") {
          return Promise.resolve(ok({
            definitions: options.missingKey ? [] : [{ key: KEY }],
            defaults_revision: "defaults-a",
          }));
        }
        if (contract === "GetSettings") {
          return Promise.resolve(ok({
            settings: [{
              key: KEY,
              resolved: options.resolved ?? true,
              value: options.current ?? "default",
            }],
            revision: 4,
          }));
        }
        if (contract === "document.get") {
          return Promise.resolve(ok({
            document: {
              id: DOC,
              revision: "9",
              status: options.status ?? "active",
            },
          }));
        }
        return Promise.resolve(ok({ id: "qst_x", status: "pending" }));
      },
      newId: (prefix) => `${prefix}_01arz3ndektsv4rrffq69g5fav`,
      runFacts: () =>
        Promise.resolve(ok({
          session: null,
          role: "lophn" as const,
          original_message: null,
          assignment: ASG,
        })),
    } satisfies AgentToolPorts,
  );
  const names = AGENT_TOOLS.map((tool) => tool.name);
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: names, roleTools: names },
  );
  const credential: RunCredential = {
    run: RUN,
    targets: new Set(),
    operations: new Set(["CreateQuestionGroup"]),
  };
  const submit = (extra: Record<string, unknown>) =>
    executeTool({ listed, handlers, credential }, "question.submit", {
      questions: [{
        prompt: "Which one?",
        reason: "because",
        options: [{
          key: "a",
          label: "A",
          description: "A",
          evidence: [],
          adoption: null,
          action: null,
          ...extra,
        }, {
          key: "keep",
          label: "Keep",
          description: "Nothing changes.",
          evidence: [],
          adoption: null,
          action: null,
        }],
        recommendation: null,
      }],
      expires_at: null,
    });
  return { calls, submit };
}

// 질문 하나짜리 묶음의 그 질문. 고정 action이 있는 질문은 묶음 하나뿐이다(questions#R13).
function created(calls: Call[]): { options: Record<string, unknown>[] } {
  const call = calls.find((entry) => entry.contract === "CreateQuestionGroup");
  assert(call !== undefined, "CreateQuestionGroup이 불리지 않았다");
  const group = call.input as {
    questions: { options: Record<string, unknown>[] }[];
  };
  assertEquals(group.questions.length, 1);
  return group.questions[0]!;
}

Deno.test("lophn-agent/roles/lophn#R21 lophn-agent/questions#R13 [agent-I13]: setting_change는 읽은 현재 값의 revision과 registry 판으로 ApplySettings action을 고정한다", async () => {
  const { calls, submit } = setup();
  const outcome = await submit({
    setting_change: { key: KEY, value: "narrow" },
  });
  assertEquals(outcome.outcome.kind, "success", JSON.stringify(outcome));
  const options = created(calls).options;
  assertEquals("setting_change" in options[0]!, false);
  assertEquals(options[1]!["action"], null);
  const action = options[0]!["action"] as {
    command: string;
    targets: string[];
    input: { value: { changes: unknown[] } };
    comparison: unknown;
  };
  assertEquals(action.command, "apply_settings");
  assertEquals(action.targets, ["qst_01arz3ndektsv4rrffq69g5fav"]);
  assertEquals(action.input.value.changes, [{
    layer: "common",
    key: KEY,
    action: "set",
    value: "narrow",
  }]);
  assertEquals(action.comparison, {
    revision: 4,
    defaults_revision: "defaults-a",
  });
  // 고정한 action은 질문을 만들 때의 검사를 통과한다.
  const checked = checkOptionAction(
    "qst_01arz3ndektsv4rrffq69g5fav",
    options[0]!["action"] as never,
  );
  assert(checked.ok, JSON.stringify(checked));
});

Deno.test("lophn-agent/roles/lophn#R21 lophn-agent/roles/lophn#R22 [agent-I13]: setting_change는 같은 값·없는 설정·값 없는 설정·보호 설정을 질문으로 만들지 않는다", async () => {
  for (
    const [setup_, input] of [
      [setup({ current: "narrow" }), { key: KEY, value: "narrow" }],
      [setup({ missingKey: true }), { key: KEY, value: "narrow" }],
      [setup({ resolved: false }), { key: KEY, value: "narrow" }],
      [setup(), { key: "platform.api_secret", value: "x" }],
    ] as const
  ) {
    const outcome = await setup_.submit({ setting_change: input });
    assert(
      outcome.outcome.code === "invalid_input" ||
        outcome.outcome.code === "not_found",
      JSON.stringify(outcome),
    );
    assertEquals(
      setup_.calls.some((call) => call.contract === "CreateQuestionGroup"),
      false,
    );
  }
});

Deno.test("lophn-agent/questions#R13 documents/addressing#R3 [agent-I13]: document_move는 읽은 문서 revision을 비교 기준으로 document.move action을 고정한다", async () => {
  const place = { kind: "project", id: PRJ };
  const { calls, submit } = setup();
  const outcome = await submit({
    document_move: { document: DOC, place, name: "release-checklist" },
  });
  assertEquals(outcome.outcome.kind, "success", JSON.stringify(outcome));
  const options = created(calls).options;
  assertEquals("document_move" in options[0]!, false);
  const action = options[0]!["action"] as {
    command: string;
    targets: string[];
    input: { value: unknown };
    comparison: unknown;
  };
  assertEquals(action.command, "document.move");
  assertEquals(action.targets, [DOC]);
  assertEquals(action.input.value, {
    document: DOC,
    place,
    name: "release-checklist",
  });
  assertEquals(action.comparison, { base_revision: "9" });

  // 보관한 문서는 옮기는 선택지를 만들지 않는다. 자리만 있고 이름이 없는 입력은 거절이다.
  const archived = setup({ status: "archived" });
  const refused = await archived.submit({
    document_move: { document: DOC, place, name: "release-checklist" },
  });
  assertEquals(refused.outcome.code, "invalid_input");
  const nameless = await setup().submit({
    document_move: { document: DOC, place, name: null },
  });
  assertEquals(nameless.outcome.code, "invalid_input");
});

Deno.test("lophn-agent/questions#R15: 한 선택지에 고정 action 제안이 둘이면 읽지도 질문을 만들지도 않는다", async () => {
  const both = setup();
  const outcome = await both.submit({
    setting_change: { key: KEY, value: "narrow" },
    document_move: { document: DOC, place: null, name: null },
  });
  assertEquals(outcome.outcome.code, "invalid_input");
  assertEquals(both.calls.length, 0);
});
