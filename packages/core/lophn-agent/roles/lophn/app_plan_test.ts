// roles/lophn#R6, R9, R10, R12: 앱 기획 순서(기존 앱 변경 → 문서로 남기기 →
// 기존 SDK → 새 앱), SDK 후보 순서와 확인한 version·입력·출력·조건, 기획 문서 검사
// (위험 첫 줄·무엇 200자·왜 500자·버린 세 방안·재사용·새로 만들 것·근거 주소,
// acceptance check 없음), 읽기 전 "재료 없음" 결론 차단(fake provider script),
// 새 앱은 등록·채택 질문 뒤 준비된 AE에 근거 전달·담당 없으면 준비 안 됨.
// model provider와 실제 core는 부르지 않는다. run-loop의 fake provider script가
// 읽기 순서를 본다(roles_test.ts와 같은 자리).
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  APP_PLAN_OPTION_WORDS,
  APP_PLAN_OPTIONS,
  APP_PLAN_TEXT_LIMITS,
  appPlanDocumentBody,
  type AppPlanDraft,
  type AppPlanReads,
  checkAppPlan,
  type NewAppHandoff,
  newAppHandoffReady,
  NO_ASSIGNMENT_WORD,
  SDK_CANDIDATE_ORDER,
} from "./mod.ts";

const READ: AppPlanReads = {
  apps: ["app.list"],
  sdk_guides: ["sdk.list", "sdk.contract:2026-10-06"],
};

function draft(
  over: Partial<AppPlanDraft> = {},
): AppPlanDraft {
  return {
    risks: ["Recording lines would leak values if pasted outside lophn."],
    what: "An app that records usage lines and shows the count.",
    why:
      "The person asks for the same count every week, so an app holds the read command and the record command.",
    chosen: "reuse_existing_sdk",
    rejected: [
      {
        option: "change_existing_app",
        reason: "No existing app records usage lines.",
      },
      {
        option: "leave_as_documents",
        reason: "The count is needed weekly, not once per reading.",
      },
    ],
    reuse: "the existing reading context",
    build: "없음",
    sdk_candidates: [{
      kind: "app_material",
      address: "sdk:lophn:cap-store",
      version: "2026-10-06",
      inputs: "one usage line",
      outputs: "the recorded count",
      access: "app.commands grant on the recording app",
      unchecked: [],
    }],
    materials: [{
      address: "app.blueprint:recorder",
      version: "rel_01arz3ndektsv4rrffq69g5fav",
      reason: "The recorder app already reads usage.",
    }],
    acceptance_checks: [],
    ...over,
  };
}

Deno.test("lophn-agent/roles/lophn#R6: 앱 기획은 기존 앱 변경 → 문서로 남기기 → 기존 SDK → 새 앱 순서로 대조한다", () => {
  assertEquals(APP_PLAN_OPTIONS, [
    "change_existing_app",
    "leave_as_documents",
    "reuse_existing_sdk",
    "new_app",
  ]);
  // 앞선 방안이 맞으면 뒤를 추천하지 않는다(R6). 세 방안을 버린 새 앱은 통과다.
  const newApp = draft({
    chosen: "new_app",
    rejected: [
      {
        option: "change_existing_app",
        reason: "No existing app records usage lines.",
      },
      {
        option: "leave_as_documents",
        reason: "The count is read weekly, so a document stays stale.",
      },
      {
        option: "reuse_existing_sdk",
        reason: "No SDK holds a usage recorder.",
      },
    ],
    build: "a new app with one read and one record command",
  });
  assertEquals(checkAppPlan(newApp, READ), { ok: true });
  // 앞선 방안을 버리지 않고 새 앱만 고르면 거절이다(R6).
  const skip = checkAppPlan(
    draft({ chosen: "new_app", rejected: [] }),
    READ,
  );
  assertFalse(skip.ok);
  // 앞선 방안이 맞는 경우 그 방안을 고른 기획은 통과다.
  const change = checkAppPlan(
    {
      ...draft(),
      chosen: "change_existing_app",
      rejected: [],
    },
    READ,
  );
  assertEquals(change, { ok: true });
});

Deno.test("lophn-agent/roles/lophn#R6: 기존 앱 목록·SDK 안내를 읽기 전에는 맞는 재료가 없다고 결론 내리지 않는다", () => {
  // 아무것도 읽지 않은 run의 새 앱 결론은 거절이다(R6).
  const nothing = checkAppPlan(
    draft({
      chosen: "new_app",
      rejected: [
        {
          option: "change_existing_app",
          reason: "x",
        },
        {
          option: "leave_as_documents",
          reason: "x",
        },
        {
          option: "reuse_existing_sdk",
          reason: "x",
        },
      ],
    }),
    { apps: [], sdk_guides: [] },
  );
  assertFalse(nothing.ok);
  // 앱 목록만 읽었어도 SDK 안내 없이는 새 앱 결론이 거절이다(R6).
  assertEquals(
    checkAppPlan(
      draft({
        chosen: "new_app",
        rejected: [
          {
            option: "change_existing_app",
            reason: "x",
          },
          {
            option: "leave_as_documents",
            reason: "x",
          },
          {
            option: "reuse_existing_sdk",
            reason: "x",
          },
        ],
      }),
      { apps: ["app.list"], sdk_guides: [] },
    ).ok,
    false,
  );
  // 둘 다 읽었으면 새 앱 결론이 열린다(R6).
  const after = checkAppPlan(
    draft({
      chosen: "new_app",
      rejected: [
        {
          option: "change_existing_app",
          reason: "no existing app covers it",
        },
        {
          option: "leave_as_documents",
          reason: "the count repeats weekly",
        },
        {
          option: "reuse_existing_sdk",
          reason: "no SDK holds this",
        },
      ],
      build: "a new app",
    }),
    READ,
  );
  assertEquals(after, { ok: true });
});

Deno.test("lophn-agent/roles/lophn#R9: SDK 후보는 앱이 쓰는 재료 → 개인 SDK → lophn SDK → 새 코드 순이고 확인한 version·입력·출력·조건을 구별한다", () => {
  assertEquals(SDK_CANDIDATE_ORDER, [
    "app_material",
    "personal_sdk",
    "lophn_sdk",
    "new_code",
  ]);
  // 순서를 지킨 기획은 통과다.
  const ordered = checkAppPlan(draft(), READ);
  assertEquals(ordered, { ok: true });
  // 순서를 바꾸면 거절이다(R9).
  const wrong = checkAppPlan(
    draft({
      sdk_candidates: [{
        kind: "lophn_sdk",
        address: "sdk:lophn",
        version: "2026-10-06",
        inputs: "one line",
        outputs: "one count",
        access: "none",
        unchecked: [],
      }, {
        kind: "app_material",
        address: "sdk:app",
        version: "1",
        inputs: "one line",
        outputs: "one count",
        access: "grant",
        unchecked: [],
      }],
    }),
    READ,
  );
  assertFalse(wrong.ok);
  // 계약 일부가 없는 조건은 확인 필요로 남고 확정으로 적지 않는다(R9).
  const plan = draft({
    sdk_candidates: [{
      kind: "app_material",
      address: "sdk:app",
      version: "1",
      inputs: "one line",
      outputs: "",
      access: "",
      unchecked: ["outputs", "access"],
    }],
  });
  assertEquals(checkAppPlan(plan, READ), { ok: true });
  // 확인 필요를 확정 입력으로 적으면 거절이다(R9).
  const confirmed = checkAppPlan(
    draft({
      sdk_candidates: [{
        kind: "app_material",
        address: "sdk:app",
        version: null,
        inputs: "",
        outputs: "",
        access: "",
        unchecked: ["inputs"],
      }],
    }),
    READ,
  );
  assertFalse(confirmed.ok);
});

Deno.test("lophn-agent/roles/lophn#R10: 앱 기획은 위험을 첫 줄에 놓고 무엇 200자·왜 500자를 지킨다", () => {
  // 상한이다(R10).
  assertEquals(APP_PLAN_TEXT_LIMITS.what, 200);
  assertEquals(APP_PLAN_TEXT_LIMITS.why, 500);
  assertEquals(checkAppPlan(draft(), READ), { ok: true });
  // 무엇이 200자를 넘으면 거절이다(R10).
  const wide = checkAppPlan(draft({ what: "가".repeat(201) }), READ);
  assertFalse(wide.ok);
  const edge = checkAppPlan(draft({ what: "가".repeat(200) }), READ);
  assertEquals(edge, { ok: true });
  // 왜가 500자를 넘으면 거절이다(R10).
  const long = checkAppPlan(draft({ why: "가".repeat(501) }), READ);
  assertFalse(long.ok);
  // 위험이 없으면 거절이다(R10: 위험을 첫 줄에 놓는다).
  const noRisk = checkAppPlan(draft({ risks: [] }), READ);
  assertFalse(noRisk.ok);
});

Deno.test("lophn-agent/roles/lophn#R10: 버린 세 방안·재사용·새로 만들 것·근거 주소가 있고 acceptance check은 쓰지 않는다", () => {
  assertEquals(checkAppPlan(draft(), READ), { ok: true });
  // 재사용·새로 만들 자리가 비면 거절이다(R10). 없으면 없음으로 적는다.
  assertFalse(checkAppPlan(draft({ reuse: " " }), READ).ok);
  assertEquals(checkAppPlan(draft({ reuse: "없음" }), READ), { ok: true });
  assertFalse(checkAppPlan(draft({ build: "" }), READ).ok);
  // 근거 주소가 없으면 거절이다(R10).
  assertFalse(checkAppPlan(draft({ materials: [] }), READ).ok);
  // 근거 이유가 비면 거절이다(R10).
  assertFalse(
    checkAppPlan(
      draft({
        materials: [{
          address: "app.blueprint:recorder",
          version: null,
          reason: " ",
        }],
      }),
      READ,
    ).ok,
  );
  // acceptance check을 쓰면 거절이다(R10: 상세 설계 인터뷰와 구별한다).
  const withCheck = checkAppPlan(
    draft({ acceptance_checks: ["the count matches the lines"] }),
    READ,
  );
  assertFalse(withCheck.ok);
  // acceptance check을 비우면 통과다(R10).
  assertEquals(checkAppPlan(draft({ acceptance_checks: [] }), READ), {
    ok: true,
  });
});

Deno.test("lophn-agent/roles/lophn#R10: 앱 기획 문서는 위험 첫 줄·버린 방안·재사용·새로 만들 것·근거를 남기고 acceptance check 자리가 없다", () => {
  const body = appPlanDocumentBody(draft());
  // 위험이 첫 절이다(R10).
  assert(body.indexOf("## Risks") < body.indexOf("## What"));
  assert(body.includes("leak values"));
  assert(body.includes(APP_PLAN_OPTION_WORDS.change_existing_app));
  assert(body.includes(APP_PLAN_OPTION_WORDS.leave_as_documents));
  assert(body.includes("rejected because"));
  assert(body.includes("Reuse: the existing reading context"));
  assert(body.includes("New build: 없음"));
  assert(body.includes("app_material"));
  assert(body.includes("app.blueprint:recorder"));
  // acceptance check 절은 없다(R10).
  assertFalse(body.includes("acceptance"));
});

Deno.test("lophn-agent/roles/lophn#R12: 새 앱 기획은 등록·채택 질문 뒤 준비된 App Engineer assignment에 근거를 전달하고 담당이 없으면 준비가 안 됐다고 적는다", () => {
  // 등록·채택 질문과 담당이 모두 있으면 handoff가 준비된 것이다(R12).
  const ready: NewAppHandoff = {
    registration_question: "qst_01arz3ndektsv4rrffq69g5fav",
    adoption_question: "qst_01arz3ndektsv4rrffq69g5faw",
    assignment: "asg_01arz3ndektsv4rrffq69g5fav",
  };
  assertEquals(newAppHandoffReady(ready), true);
  // 등록 질문을 거치지 않았으면 준비가 안 된 것이다(R12).
  assertEquals(
    newAppHandoffReady({ ...ready, registration_question: null }),
    false,
  );
  // 채택 질문을 거치지 않았으면 준비가 안 된 것이다(R12).
  assertEquals(
    newAppHandoffReady({ ...ready, adoption_question: null }),
    false,
  );
  // 담당이 없으면 준비가 안 됐다고 적는다(R12).
  assertEquals(newAppHandoffReady({ ...ready, assignment: null }), false);
  assertEquals(NO_ASSIGNMENT_WORD.includes("assigned"), true);
});
