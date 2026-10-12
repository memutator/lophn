import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import {
  adoptionsOf,
  checkOptionAction,
  moveOptionAction,
  OPTION_ACTION_OPERATIONS,
  OPTION_ACTION_OWNERS,
  protectedSetting,
  type QuestionGroup,
  renameOptionAction,
  settingsOptionAction,
} from "./mod.ts";

// 고정 action의 검사·지문·채택 판정(순수). 실제 core 위의 적용(한 번만, 낡은 전제, 범위 밖 대상)은
// apps/core/question-option-actions_test.ts와 apps/core/waiting-and-recovery_test.ts가 본다.

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER_DOC = "doc_01arz3ndektsv4rrffq69g5fb0";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const VER_ONE = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_TWO = "ver_01arz3ndektsv4rrffq69g5fb0";

function code(result: Result<unknown>): string {
  return result.ok ? "ok" : result.error.code;
}

function width(value: string) {
  return [{
    layer: "common" as const,
    key: "shell.reading_width",
    action: "set" as const,
    value,
  }];
}

Deno.test("lophn-agent/questions#R13: 문서 이동·이름 변경·설정 변경의 고정 action은 대상·입력·비교 기준과 지문이 맞을 때만 선택지가 된다", () => {
  const move = moveOptionAction({
    document: DOC,
    place: { kind: "project", id: PROJECT },
    name: "plan",
    base_revision: "7",
  });
  assertEquals(code(checkOptionAction(QUESTION, move)), "ok");
  assertEquals(move.targets, [DOC]);
  assertEquals(move.comparison, { base_revision: "7" });
  const rename = renameOptionAction({
    document: DOC,
    name: "weekly",
    base_revision: "7",
  });
  assertEquals(code(checkOptionAction(QUESTION, rename)), "ok");
  const setting = settingsOptionAction({
    question: QUESTION,
    changes: width("wide"),
    revision: 3,
    defaults_revision: "d1",
  });
  assertEquals(code(checkOptionAction(QUESTION, setting)), "ok");

  // 대상이 입력의 문서와 다르면 고정한 대상이 아니다.
  assertEquals(
    code(checkOptionAction(QUESTION, { ...move, targets: [OTHER_DOC] })),
    "invalid_input",
  );
  // 입력이나 비교 기준을 지문과 다르게 바꾸면 거절한다.
  assertEquals(
    code(checkOptionAction(QUESTION, {
      ...move,
      input: {
        kind: "inline",
        value: { document: DOC, place: null, name: null },
      },
    })),
    "invalid_input",
  );
  assertEquals(
    code(checkOptionAction(QUESTION, {
      ...move,
      comparison: { base_revision: "8" },
    })),
    "invalid_input",
  );
  // 다른 질문의 설정 선택지는 이 질문의 대상이 아니다.
  assertEquals(
    code(
      checkOptionAction("qst_01arz3ndektsv4rrffq69g5fb0", setting),
    ),
    "invalid_input",
  );
  // 입력을 blob으로 둔 action은 같은 transaction에서 적용할 수 없어 받지 않는다.
  assertEquals(
    code(checkOptionAction(QUESTION, {
      ...move,
      input: { kind: "blob", sha256: "a".repeat(64) },
    })),
    "invalid_input",
  );
});

Deno.test("lophn-agent/questions#R12: 등록하지 않은 동작과 권한·secret·외부 효과 설정은 선택지로 열지 않는다", () => {
  const move = moveOptionAction({
    document: DOC,
    place: null,
    name: null,
    base_revision: "1",
  });
  // 권한 부여·외부 효과·등록 밖 동작.
  for (
    const [concern, command] of [
      ["platform/approvals", "grant_approval_request"],
      ["apps", "activate_release"],
      ["documents/addressing", "document.archive"],
    ]
  ) {
    assertEquals(
      code(checkOptionAction(QUESTION, { ...move, concern, command })),
      "forbidden",
    );
  }
  for (
    const key of [
      "provider.api_key",
      "apps.grant.mode",
      "lophn-agent.extensions.mcp_servers",
      "coding-agent.harness.enabled",
    ]
  ) {
    const action = settingsOptionAction({
      question: QUESTION,
      changes: [{ layer: "common", key, action: "set", value: true }],
      revision: 0,
      defaults_revision: "d1",
    });
    const checked = checkOptionAction(QUESTION, action);
    assertEquals(code(checked), "forbidden", key);
    assert(!checked.ok && checked.error.details?.["screen"] !== undefined);
  }
  assertEquals(protectedSetting("shell.reading_width"), null);
  assertEquals(protectedSetting("provider.api_key")?.kind, "secret");
  assertEquals(
    protectedSetting("lophn-agent.extensions.skill_folders")?.kind,
    "external",
  );
});

Deno.test("lophn-agent/questions#R13: 적용 자격이 가져야 하는 operation은 적용 command와 등록한 소유 command뿐이다", () => {
  assertEquals(
    [...OPTION_ACTION_OPERATIONS].sort(),
    [
      "ApplyQuestionOption",
      "ApplySettings",
      "app.create",
      "document.move",
      "document.rename",
    ],
  );
  for (const owner of OPTION_ACTION_OWNERS) {
    // 적용 route는 사람 결정 근거를 검증한 뒤에만 부르므로 소유 command가 user를 받아야 한다.
    assert(owner.route.actors.includes("user"), owner.command);
  }
});

<<<<<<< HEAD
Deno.test("lophn-agent/questions#R13: 용어 정의의 고정 action은 대상·입력·비교 기준과 지문이 맞을 때만 선택지가 된다", () => {
  const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
  const TERM = "trm_01arz3ndektsv4rrffq69g5fav";
  // 이미 있는 후보의 정의. 용어·이름·뜻과 기준 revision이 고정된다.
  const define = defineTermOptionAction({
    term: TERM,
    name: "범위",
    definition: "이번 판단의 대상",
    base_revision: "7",
  });
  assertEquals(code(checkOptionAction(QUESTION, define)), "ok");
  assertEquals(define.targets, [TERM]);
  assertEquals(define.comparison, { base_revision: "7" });
  assertEquals(define.input, {
    kind: "inline",
    value: { term: TERM, name: "범위", definition: "이번 판단의 대상" },
  });
  // 새 등록의 정의. context·id·이름·뜻이 고정되고 비교 기준은 없다.
  const fresh = defineTermOptionAction({
    context: CONTEXT,
    id: TERM,
    name: "직접",
    definition: "바로 정의",
  });
  assertEquals(code(checkOptionAction(QUESTION, fresh)), "ok");
  assertEquals(fresh.targets, [TERM]);
  assertEquals(fresh.comparison, {});

  // 대상이 입력의 용어와 다르면 고정한 대상이 아니다.
  assertEquals(
    code(checkOptionAction(QUESTION, { ...define, targets: [OTHER_DOC] })),
    "invalid_input",
  );
  // 새 등록의 대상이 context가 아니라 id와 다르면 고정한 대상이 아니다.
  assertEquals(
    code(checkOptionAction(QUESTION, { ...fresh, targets: [CONTEXT] })),
    "invalid_input",
  );
  // 입력을 지문과 다르게 바꾸면 거절한다.
  assertEquals(
    code(checkOptionAction(QUESTION, {
      ...define,
      input: {
        kind: "inline",
        value: { term: DOC, name: "범위", definition: "다른 뜻" },
      },
    })),
    "invalid_input",
  );
  // 비교 기준을 지문과 다르게 바꾸면 거절한다.
  assertEquals(
    code(checkOptionAction(QUESTION, {
      ...define,
      comparison: { base_revision: "8" },
    })),
    "invalid_input",
  );
  // 이미 있는 용어 모양과 새 등록 모양을 섞은 입력은 소유 command가 받지 않는다.
  assertEquals(
    code(checkOptionAction(QUESTION, {
      ...define,
      input: {
        kind: "inline",
        value: {
          term: DOC,
          context: CONTEXT,
          name: "범위",
          definition: "이번 판단의 대상",
        },
      },
    })),
    "invalid_input",
  );
  // 두 모양 모두 아닌 입력도 받지 않는다.
  assertEquals(
    code(checkOptionAction(QUESTION, {
      ...define,
      input: { kind: "inline", value: { name: "범위", definition: "뜻" } },
    })),
    "invalid_input",
  );
  // 이미 있는 용어의 정의는 비교 기준이 없으면 거절한다.
  assertEquals(
    code(checkOptionAction(QUESTION, { ...define, comparison: {} })),
    "invalid_input",
  );
});

function group(
  over: Partial<QuestionGroup> = {},
  answer: unknown = { kind: "option", option_key: "adopt", text_blob: null },
): QuestionGroup {
=======
function row(over: Partial<QuestionRow>): QuestionRow {
>>>>>>> origin/main
  return {
    id: "qgr_01arz3ndektsv4rrffq69g5fav",
    run: "run_01arz3ndektsv4rrffq69g5fav",
    session: null,
    created_by: "agent:asg_01arz3ndektsv4rrffq69g5fav",
    expires_at: null,
    status: "answered",
    binding_hash: null,
    closed_reason: null,
    closed_reason_blob: null,
    created_seq: "1",
    closed_seq: "2",
    questions: [{
      id: QUESTION,
      group: "qgr_01arz3ndektsv4rrffq69g5fav",
      position: 1,
      prompt_blob: "a".repeat(64),
      reason_blob: "b".repeat(64),
      options: JSON.stringify([
        {
          key: "adopt",
          adoption: { document: DOC, version: VER_ONE, section: null },
        },
        { key: "later", adoption: null },
      ]),
      recommendation: null,
      answer: answer === null ? null : JSON.stringify(answer),
    }],
    ...over,
  };
}

Deno.test("lophn-agent/questions#R16 [agent-I13]: 채택은 사람이 고른 선택지가 고정한 문서 version의 질문 답이고 새 version으로 옮겨지지 않는다", () => {
  const adopted = adoptionsOf(group());
  assertEquals(adopted, [{
    question: QUESTION,
    document: DOC,
    version: VER_ONE,
    section: null,
  }]);
  // 같은 문서의 더 새 판(VER_TWO)이 생겨도 이 답은 처음 고정한 판만 가리킨다. 판 정보는 질문 안에
  // 고정되어 있고 최신 판을 읽어 바꾸지 않는다.
  assert(adopted[0]?.version !== VER_TWO);
  // 채택하지 않는 선택지·자유 답·답 없음은 채택이 아니다.
  assertEquals(
    adoptionsOf(
      group({}, { kind: "option", option_key: "later", text_blob: null }),
    ),
    [],
  );
  assertEquals(
    adoptionsOf(
      group({}, { kind: "text", option_key: null, text_blob: "c".repeat(64) }),
    ),
    [],
  );
  assertEquals(
    adoptionsOf(group({ status: "pending", closed_seq: null }, null)),
    [],
  );
});

Deno.test("lophn-agent/questions#R16 [agent-I13]: 답한 묶음의 질문마다 고른 선택지의 채택이 질문 ID와 함께 나온다", () => {
  const first = group();
  const second = group().questions[0]!;
  const both: QuestionGroup = {
    ...first,
    questions: [first.questions[0]!, {
      ...second,
      id: "qst_01arz3ndektsv4rrffq69g5fb0",
      position: 2,
      options: JSON.stringify([
        {
          key: "adopt",
          adoption: { document: OTHER_DOC, version: VER_TWO, section: "s1" },
        },
        { key: "later", adoption: null },
      ]),
    }],
  };
  assertEquals(adoptionsOf(both), [
    { question: QUESTION, document: DOC, version: VER_ONE, section: null },
    {
      question: "qst_01arz3ndektsv4rrffq69g5fb0",
      document: OTHER_DOC,
      version: VER_TWO,
      section: "s1",
    },
  ]);
  // 묶음이 답 없이 끝났으면 질문마다 답이 없으므로 채택도 없다.
  assertEquals(adoptionsOf({ ...both, status: "cancelled" }), []);
});
