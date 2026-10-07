// LaunchPlan과 첫 prompt 시험이다(coding-agent#T38). 실제 harness와 사람의 설정·데이터 root는 열지 않고
// 감지 결과·실행 파일 재확인은 값으로 끼운다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  codingAgentLaunchPlanSchema,
  type HarnessDetection,
  type HarnessId,
  type SessionPlanInput,
  sessionPlanInputSchema,
  sessionStartInputSchema,
} from "../../contracts/coding-agent/mod.ts";
import { PROMPT_ADAPTERS, type PromptAdapter } from "./model.ts";
import { launchPlanOf, type PlanContext } from "./mod.ts";

const TKT = "tkt_01arz3ndektsv4rrffq69g5fav";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const OTHER_APP = "app_01arz3ndektsv4rrffq69g5fa2";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const PRB = "prb_01arz3ndektsv4rrffq69g5fav";

function detectionOf(
  harness: HarnessId,
  patch: Partial<HarnessDetection> = {},
): HarnessDetection {
  return {
    harness_id: harness,
    catalog_revision: "harness-catalog-1",
    environment: { kind: "host", identity: "native" },
    profile_id: null,
    observed_at: "2026-10-07T00:00:00.000Z",
    discovery: "detected",
    candidates: [{
      path: `/opt/bin/${harness}`,
      source: "PATH",
      executable_result: "ok",
    }],
    selected_executable: `/opt/bin/${harness}`,
    version: {
      result: "unknown",
      value: null,
      reason: "probe를 돌리지 않았다",
    },
    auth: {
      result: "unknown",
      evidence: null,
      reason: "probe를 돌리지 않았다",
    },
    probe_results: [],
    freshness: "fresh",
    ...patch,
  };
}

function inputOf(
  patch: Partial<SessionPlanInput> = {},
  harness: HarnessId = "claude",
): SessionPlanInput {
  return {
    ticket: TKT,
    ticket_revision: "12",
    connection: CAC,
    harness_id: harness,
    profile_id: null,
    project: PRJ,
    folder_ref: "src",
    cwd: "/work/app",
    method: "terminal_tui",
    facts: {
      ticket_app: APP,
      screen_state: "ready",
      connection_state: "active",
      connection_scope: { kind: "app", app: APP },
      problems: [PRB],
      inspect: ["src/a.ts", "src/b dir/c.ts"],
    },
    human_start_handle: "hs_1",
    operation_id: "op_1",
    ...patch,
  };
}

function contextOf(
  harness: HarnessId = "claude",
  patch: Partial<PlanContext> = {},
): PlanContext {
  // OpenCode는 최소 version 정책이라 확인한 version이 있어야 시작한다.
  return {
    detection: detectionOf(
      harness,
      harness === "opencode"
        ? { version: { result: "verified", value: "2.1.0", reason: null } }
        : {},
    ),
    current: { selected: `/opt/bin/${harness}` },
    ...patch,
  };
}

function planOk(input: SessionPlanInput, context: PlanContext) {
  const made = launchPlanOf(input, context);
  assert(made.ok, made.ok ? undefined : JSON.stringify(made.error));
  assertEquals(made.value.kind, "plan");
  if (made.value.kind !== "plan") throw new Error("plan expected");
  return made.value.plan;
}

function refusal(input: SessionPlanInput, context: PlanContext) {
  const made = launchPlanOf(input, context);
  assertFalse(made.ok, "plan이 나오면 안 된다");
  if (made.ok) throw new Error("refusal expected");
  const details = made.error.details as {
    next: string[];
    guide?: { method: string; first_prompt: string };
  };
  assert(details.next.length > 0, "다음 행동이 있어야 한다");
  return { error: made.error, details };
}

Deno.test("coding-agent/sessions#R1: 시작은 ticket·harness·방식 하나이고 방식은 자기 터미널 안내와 terminal_tui 둘뿐이다", () => {
  const plan = planOk(inputOf(), contextOf());
  assertEquals(plan.method, "terminal_tui");
  assertEquals(plan.ticket, TKT);
  assertEquals(plan.harness_id, "claude");

  // 자기 터미널은 process를 열지 않는 안내다. 실행 파일·argv·human_start_handle이 없다.
  const guided = launchPlanOf(
    inputOf({ method: "own_terminal" }),
    contextOf(),
  );
  assert(guided.ok);
  assertEquals(guided.value.kind, "guide");
  if (guided.value.kind === "guide") {
    assertEquals(guided.value.guide.method, "own_terminal");
    assert(guided.value.guide.first_prompt.includes(TKT));
  }

  // headless·자동 시작 같은 다른 방식은 받지 않는다.
  for (const method of ["headless", "auto", "resume"]) {
    const made = launchPlanOf(inputOf({ method }), contextOf());
    assertFalse(made.ok, method);
    if (!made.ok) assertEquals(made.error.code, "invalid_input");
  }
});

Deno.test("coding-agent/sessions#R2: plan은 shell main이 넘긴 값과 catalog·현재 감지로 executable·분리 argv·env 이름·first_prompt·prompt_delivery를 만든다", () => {
  const plan = planOk(inputOf(), contextOf());
  assertEquals(plan.executable, "/opt/bin/claude");
  assertEquals(plan.argv[0], "claude");
  assertEquals(plan.argv.length, 2);
  assertEquals(plan.argv[1], plan.first_prompt);
  assertEquals(plan.prompt_delivery, { mode: "argv" });
  assertEquals(plan.connection, CAC);
  assertEquals(plan.ticket_revision, "12");
  assertEquals(plan.cwd, "/work/app");
  assertEquals(plan.project, PRJ);
  assertEquals(plan.catalog_revision, "harness-catalog-1");
  assertEquals(plan.env_overlay?.["LOPHN_CONNECTION"], CAC);
  assertEquals(
    plan.env_names.sort(),
    Object.keys(plan.env_overlay ?? {}).sort(),
  );
  assertEquals(plan.human_start_handle, "hs_1");
  assertEquals(plan.operation_id, "op_1");
  // 계약 schema를 통과한다.
  assert(codingAgentLaunchPlanSchema.safeParse(plan).success);
});

Deno.test("coding-agent/sessions#R2: human_start_handle이 없으면 입력도 plan도 시작 입력도 통과하지 않아 shell이 spawn하지 않는다", () => {
  const plan = planOk(inputOf(), contextOf());
  const { human_start_handle: _handle, ...withoutHandle } = plan;
  assertFalse(codingAgentLaunchPlanSchema.safeParse(withoutHandle).success);
  assertFalse(
    sessionStartInputSchema.safeParse({ plan: withoutHandle }).success,
  );
  assert(sessionStartInputSchema.safeParse({ plan }).success);
  const { human_start_handle: _in, ...inputWithout } = inputOf();
  assertFalse(sessionPlanInputSchema.safeParse(inputWithout).success);
  assertFalse(
    sessionPlanInputSchema.safeParse({ ...inputOf(), human_start_handle: "" })
      .success,
  );
});

Deno.test("coding-agent/sessions#R2: folder trust·MCP 승인 같은 harness 자체 trust를 plan이 미리 쓰지 않는다", () => {
  for (const adapter of PROMPT_ADAPTERS.filter((item) => item.verified)) {
    const plan = planOk(
      inputOf({}, adapter.harness_id),
      contextOf(adapter.harness_id),
    );
    const flags = plan.argv.slice(0, -1).join(" ");
    for (const trust of ["trust", "yolo", "dangerously", "approve", "allow"]) {
      assertFalse(flags.includes(trust), `${adapter.harness_id} ${trust}`);
    }
    for (const name of Object.keys(plan.env_overlay ?? {})) {
      assert(
        ["TERM", "COLORTERM", "LOPHN_CONNECTION"].includes(name),
        `${adapter.harness_id} ${name}`,
      );
    }
  }
});

Deno.test("coding-agent/sessions#R3: first_prompt는 지정 ticket 읽기·MCP claim→작업→보고 지시와 근거 읽을 곳만 담고 token·본문·log·묶음이 없다", () => {
  const plan = planOk(inputOf(), contextOf());
  const prompt = plan.first_prompt;
  assert(prompt.includes(TKT));
  assert(prompt.includes("lophn_ticket"));
  for (const word of ["show", "claim", "report"]) assert(prompt.includes(word));
  assert(
    prompt.indexOf("show") < prompt.indexOf("claim") &&
      prompt.indexOf("claim") < prompt.indexOf("report"),
  );
  assert(prompt.includes(PRB));
  assert(prompt.includes("src/a.ts"));
  assertFalse(prompt.startsWith("-"));
  for (
    const hidden of ["token", "Bearer", "LOPHN_", "keychain", "credential"]
  ) {
    assertFalse(prompt.includes(hidden), hidden);
  }
  // 근거는 참조뿐이라 facts에 없는 본문은 prompt에 나오지 않는다. 줄 구조를 바꾸는 경로는 뺀다.
  const hostile = planOk(
    inputOf({
      facts: { ...inputOf().facts!, inspect: ["src/ok.ts"], problems: [] },
    }),
    contextOf(),
  );
  assertFalse(hostile.first_prompt.includes("근거로 읽을 문제"));
});

Deno.test("coding-agent/sessions#R3: 연결 source가 속한 project나 폴더가 없으면 임의 cwd로 열지 않고 연결 안내로 끝난다", () => {
  for (
    const patch of [
      { project: undefined },
      { folder_ref: undefined },
      { project: undefined, folder_ref: undefined },
    ]
  ) {
    const { error, details } = refusal(
      { ...inputOf(), ...patch },
      contextOf(),
    );
    assertEquals(error.code, "unavailable");
    assert(details.next.some((line) => line.includes("project")));
    assert(details.guide?.first_prompt.includes(TKT));
  }
  // 여러 폴더 중 사람이 고른 등록 폴더만 plan에 들어간다.
  const plan = planOk(
    inputOf({ folder_ref: "packages/app", cwd: "/work/app/packages/app" }),
    contextOf(),
  );
  assertEquals(plan.folder_ref, "packages/app");
  assertEquals(plan.cwd, "/work/app/packages/app");
});

Deno.test("coding-agent/sessions#R4: ticket·연결 현재 상태를 확인한 값이 없거나 회수·이미 claim·needs_confirmation·범위 밖이면 conflict·unavailable과 다음 행동이고 plan이 없다", () => {
  const base = inputOf();
  const noFacts = refusal({ ...base, facts: undefined }, contextOf());
  assertEquals(noFacts.error.code, "unavailable");
  const facts = base.facts!;
  const cases: [Partial<typeof facts>, string][] = [
    [{ connection_state: "revoked" }, "conflict"],
    [{ screen_state: "in_progress" }, "conflict"],
    [{ screen_state: "needs_confirmation" }, "conflict"],
    [{ screen_state: "reported" }, "conflict"],
    [{ screen_state: "cancelled" }, "conflict"],
    [{ connection_scope: { kind: "app", app: OTHER_APP } }, "conflict"],
  ];
  for (const [patch, code] of cases) {
    const { error } = refusal(
      { ...base, facts: { ...facts, ...patch } },
      contextOf(),
    );
    assertEquals(error.code, code, JSON.stringify(patch));
  }
  // check_failed ticket과 모든 앱 연결은 시작할 수 있다.
  planOk(
    {
      ...base,
      facts: {
        ...facts,
        screen_state: "check_failed",
        connection_scope: { kind: "all", app: null },
      },
    },
    contextOf(),
  );
});

Deno.test("coding-agent/sessions#R4 coding-agent/harnesses#R5: executable 이동·다른 profile·미지원 version·못 찾음이면 다른 harness나 재감지 없이 conflict·unavailable로 끝난다", () => {
  // 감지 뒤 실행 파일이 옮겨지거나 사라졌다.
  const moved = refusal(
    inputOf(),
    contextOf("claude", { current: { selected: "/other/bin/claude" } }),
  );
  assertEquals(moved.error.code, "conflict");
  assert(moved.details.next[0].includes("harness refresh"));
  assertEquals(
    refusal(inputOf(), contextOf("claude", { current: { selected: null } }))
      .error.code,
    "conflict",
  );
  assertEquals(
    refusal(inputOf(), contextOf("claude", { current: null })).error.code,
    "conflict",
  );
  // 다른 profile.
  assertEquals(
    refusal(inputOf({ profile_id: "work" }), contextOf()).error.code,
    "conflict",
  );
  // 지원 최소보다 낮은 version(OpenCode 최소 2.0.10)과 version을 모르는 경우.
  const low = refusal(
    inputOf({}, "opencode"),
    contextOf("opencode", {
      detection: detectionOf("opencode", {
        version: { result: "verified", value: "2.0.9", reason: null },
      }),
    }),
  );
  assertEquals(low.error.code, "unavailable");
  assertEquals(
    refusal(
      inputOf({}, "opencode"),
      contextOf("opencode", { detection: detectionOf("opencode") }),
    ).error.code,
    "unavailable",
  );
  planOk(
    inputOf({}, "opencode"),
    contextOf("opencode", {
      detection: detectionOf("opencode", {
        version: { result: "verified", value: "2.0.10", reason: null },
      }),
    }),
  );
  // 선택한 harness가 감지되지 않으면 다른 제품이 감지돼도 대체하지 않는다.
  const absent = refusal(
    inputOf(),
    {
      detection: detectionOf("claude", {
        discovery: "absent",
        candidates: [],
        selected_executable: null,
      }),
      current: { selected: null },
    },
  );
  assertEquals(absent.error.code, "unavailable");
  assertFalse(JSON.stringify(absent.error).includes("codex"));
  // harness를 정하지 않은 요청은 기본값을 몰래 고르지 않는다.
  assertEquals(
    refusal(inputOf({ harness_id: undefined }), contextOf()).error.code,
    "invalid_input",
  );
});

Deno.test("coding-agent/sessions#R5: 공백·줄바꿈·shell 문자가 든 값은 분리 인자 하나로만 들어간다", () => {
  const input = inputOf({
    facts: {
      ...inputOf().facts!,
      inspect: ["src/a b.ts", "src/$(rm -rf x)/y;z.ts", 'it\'s "q".ts'],
    },
  });
  for (
    const [harness, flag] of [
      ["claude", null],
      ["codex", null],
      ["pi", null],
      ["opencode", "--prompt"],
      ["gemini", "--prompt-interactive"],
    ] as const
  ) {
    const plan = planOk(
      { ...input, harness_id: harness },
      contextOf(harness),
    );
    assert(plan.first_prompt.includes("\n"));
    assert(plan.first_prompt.includes("$(rm -rf x)"));
    assertEquals(plan.argv.length, flag === null ? 2 : 3, harness);
    assertEquals(plan.argv[0], harness);
    if (flag !== null) assertEquals(plan.argv[1], flag);
    // prompt 전체가 argv의 한 원소이고 harness가 스스로 submit하므로 PTY 입력 단계가 없다.
    assertEquals(plan.argv.at(-1), plan.first_prompt);
    assertEquals(plan.prompt_delivery, { mode: "argv" });
  }
});

Deno.test("coding-agent/sessions#R5: stdin_after_ready는 검증한 readiness 신호가 있는 adapter만이고 deadline 10,000ms이며 prompt는 argv에 없다", () => {
  const verified: PromptAdapter = {
    harness_id: "claude",
    verified: true,
    unverified_reason: null,
    prompt: {
      kind: "stdin_after_ready",
      readiness: "composer ready marker",
    },
  };
  const plan = planOk(inputOf(), contextOf("claude", { adapters: [verified] }));
  assertEquals(plan.prompt_delivery, {
    mode: "stdin_after_ready",
    readiness: "composer ready marker",
    deadline_ms: 10_000,
  });
  assertEquals(plan.argv, ["claude"]);

  // 준비 신호가 없는 adapter는 stdin 자동 주입을 허용하지 않는다.
  const unverifiedSignal: PromptAdapter = {
    ...verified,
    prompt: { kind: "stdin_after_ready", readiness: null },
  };
  const noSignal = refusal(
    inputOf(),
    contextOf("claude", { adapters: [unverifiedSignal] }),
  );
  assertEquals(noSignal.error.code, "unavailable");

  // 배포 표에서 OpenClaw·Hermes는 검증하지 못해 시작하지 않고 자기 터미널 안내로 끝난다.
  for (const harness of ["openclaw", "hermes"] as const) {
    const refused = refusal(inputOf({}, harness), contextOf(harness));
    assertEquals(refused.error.code, "unavailable", harness);
    assertEquals(refused.details.guide?.method, "own_terminal");
  }
});

Deno.test("coding-agent/sessions#R5: Windows .cmd shim은 줄바꿈 prompt를 argv로 넘기지 않고 미지원과 자기 터미널 안내로 끝난다", () => {
  for (const shim of ["C:/npm/claude.cmd", "C:/npm/claude.BAT"]) {
    const refused = refusal(
      inputOf(),
      {
        detection: detectionOf("claude", { selected_executable: shim }),
        current: { selected: shim },
      },
    );
    assertEquals(refused.error.code, "unavailable", shim);
    assertEquals(refused.details.guide?.method, "own_terminal");
  }
});

Deno.test("coding-agent/sessions#R5: env는 overlay와 삭제를 나누고 overlay에 token이 없으며 연결 참조만 LOPHN_CONNECTION으로 넘어간다", () => {
  const plan = planOk(inputOf(), contextOf());
  assertEquals(plan.env_overlay, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LOPHN_CONNECTION: CAC,
  });
  assert(plan.env_delete?.includes("LOPHN_TERMINAL_OBSERVE"));
  assertFalse(plan.env_names.includes("LOPHN_TERMINAL_OBSERVE"));
  for (const name of plan.env_delete ?? []) {
    assertFalse(name in (plan.env_overlay ?? {}), name);
  }
  assertFalse(JSON.stringify(plan).toLowerCase().includes("bearer"));
});

Deno.test("coding-agent/sessions#R10: plan에는 resume·재시작·재전송이 없고 같은 입력은 같은 계획이다", () => {
  for (const adapter of PROMPT_ADAPTERS.filter((item) => item.verified)) {
    const plan = planOk(
      inputOf({}, adapter.harness_id),
      contextOf(adapter.harness_id),
    );
    for (const word of ["--resume", "resume", "--session", "--continue"]) {
      assertFalse(plan.argv.slice(0, -1).includes(word), word);
    }
    assertFalse("resume" in plan);
    assertFalse("retry" in plan);
  }
  const first = planOk(inputOf(), contextOf());
  const second = planOk(inputOf(), contextOf());
  assertEquals(first, second);
});
