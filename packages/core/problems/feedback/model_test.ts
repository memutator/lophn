// feedback 순수 규칙의 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md).
import { assert, assertEquals } from "@std/assert";
import {
  checkFeedbackText,
  checkStateBytes,
  checkTransfer,
  FEEDBACK_LIMITS,
  feedbackGroup,
  inspectPng,
  requireShellUser,
  resolveTargets,
  safeScreenState,
  TARGET_REASONS,
  transferBytes,
} from "./mod.ts";
import { APP_A, APP_B, rpt } from "../grouping/testing/mod.ts";
import { pngBytes } from "./testing/mod.ts";

const NO_TARGETS = resolveTargets({
  invocation: null,
  automation: null,
  version: null,
  command_start: "unknown",
});

Deno.test("problems/feedback#R1: 인증된 shell의 user만 사람 글을 낸다; app·agent·다른 통로는 forbidden", () => {
  assert(requireShellUser({ actor: "user", surface: "shell" }).ok);
  for (
    const caller of [
      { actor: "app:app_x", surface: "shell" },
      { actor: "agent", surface: "shell" },
      { actor: "coding_agent", surface: "shell" },
      { actor: "machine", surface: "shell" },
      { actor: "user", surface: "cli" },
    ]
  ) {
    const result = requireShellUser(caller);
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
  }
});

Deno.test("problems/feedback#R1: redaction 뒤 글은 공백 외 1~500 Unicode scalar다", () => {
  for (const text of ["a", "界".repeat(500), "😀".repeat(500)]) {
    assert(checkFeedbackText(text).ok, text.slice(0, 4));
  }
  for (const text of ["", "  \n\t", "a".repeat(501), "😀".repeat(501)]) {
    const result = checkFeedbackText(text);
    assert(!result.ok);
    assertEquals(result.error.code, "invalid_input");
  }
});

Deno.test("problems/feedback#R8: PNG 머리·크기·길이 한도를 검사한다", () => {
  const ok = inspectPng(pngBytes(1600, 900));
  assert(ok.ok);
  assertEquals(ok.value, { width: 1600, height: 900 });
  assert(inspectPng(pngBytes(900, 1600)).ok);
  assert(inspectPng(pngBytes(1, 1, FEEDBACK_LIMITS.png_bytes)).ok);
  // PNG가 아닌 자료는 확장자나 주장과 상관없이 거절한다.
  const jpeg = new Uint8Array(200);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
  const text = new TextEncoder().encode("not an image at all".repeat(10));
  const brokenCrc = pngBytes();
  brokenCrc[30] ^= 0xff;
  const wrongType = pngBytes();
  wrongType[12] = 0x58;
  for (
    const bytes of [
      jpeg,
      text,
      new Uint8Array(0),
      pngBytes().subarray(0, 20),
      brokenCrc,
      wrongType,
      pngBytes(1601, 10),
      pngBytes(10, 1601),
      pngBytes(0, 10),
      pngBytes(1, 1, FEEDBACK_LIMITS.png_bytes + 1),
    ]
  ) {
    const result = inspectPng(bytes);
    assert(!result.ok);
    assertEquals(result.error.code, "invalid_input");
  }
});

Deno.test("problems/feedback#R9: 상태 65,536 bytes와 전체 3,145,728 bytes 경계", () => {
  assert(checkStateBytes("x".repeat(65_536)).ok);
  assert(!checkStateBytes("x".repeat(65_537)).ok);
  // 한글은 byte로 센다: 글자 수가 한도 안이어도 byte가 넘으면 거절한다.
  assert(!checkStateBytes("가".repeat(21_846)).ok);
  assert(checkTransfer(3_145_728).ok);
  const over = checkTransfer(3_145_729);
  assert(!over.ok);
  assertEquals(over.error.code, "invalid_input");
  assertEquals(
    transferBytes({
      text: "가",
      facts: { a: 1 },
      screenshot: new Uint8Array(10),
    }),
    3 + 7 + 10,
  );
  assertEquals(transferBytes({ text: "a", facts: null, screenshot: null }), 1);
});

Deno.test("problems/feedback#R7: 화면 상태는 이름·탭·path·안전 hash·입력 모양만 남기고 query 값·업무 값·원입력은 이유만 남긴다", () => {
  assert(NO_TARGETS.ok);
  const state = safeScreenState("Orders", {
    tab: "Summary",
    url:
      "lophn-app://app-x/orders/2026?customer=ada@example.test&token=abc#section-2",
    inputs: [
      { name: "memo", value: "private memo text" },
      { name: "amount", value: 4111111111111111 },
      { name: "tags", value: ["a", "b"] },
      { name: "filter", value: { a: 1, b: 2 } },
      { name: "none", value: null },
    ],
    business_data: { rows: [{ card: "4111 1111 1111 1111" }] },
    command_input: { amount: 1200 },
    read_result: [{ total: 99 }],
  }, NO_TARGETS.value);
  assertEquals(state.screen, "Orders");
  assertEquals(state.tab, "Summary");
  assertEquals(state.location, { path: "/orders/2026", hash: "#section-2" });
  assertEquals(state.inputs, [
    { name: "memo", shape: { type: "string", length: 17 } },
    { name: "amount", shape: { type: "number" } },
    { name: "tags", shape: { type: "array", length: 2 } },
    { name: "filter", shape: { type: "object", keys: 2 } },
    { name: "none", shape: { type: "null" } },
  ]);
  assertEquals(
    state.omitted.map((item) => item.item),
    ["url_query", "business_data", "command_input", "read_result"],
  );
  const serialized = JSON.stringify(state);
  for (
    const leaked of [
      "ada@example.test",
      "token=abc",
      "private memo text",
      "4111",
      "1200",
      "99",
    ]
  ) {
    assert(!serialized.includes(leaked), leaked);
  }
});

Deno.test("problems/feedback#R7: 안전하지 않은 hash와 읽을 수 없는 URL은 위치만 빼고 이유를 남긴다", () => {
  assert(NO_TARGETS.ok);
  const unsafe = safeScreenState("S", {
    tab: null,
    url: "/a/b#access_token=secret value",
    inputs: [],
  }, NO_TARGETS.value);
  assertEquals(unsafe.location, { path: "/a/b", hash: null });
  assertEquals(unsafe.omitted.map((item) => item.item), ["url_hash"]);
  const none = safeScreenState(
    "S",
    { tab: null, url: null, inputs: [] },
    NO_TARGETS.value,
  );
  assertEquals(none.location, null);
  assertEquals(none.omitted, []);
  const broken = safeScreenState("S", {
    tab: null,
    url: "http://[::1",
    inputs: [],
  }, NO_TARGETS.value);
  assertEquals(broken.location, null);
  assertEquals(broken.omitted.map((item) => item.item), ["url"]);
});

Deno.test("problems/feedback#R3 problems/feedback#R4: 모르는 대상은 모른다고 남기고 시작하지 못한 command에는 invocation이 없다", () => {
  const invocation = "inv_01arz3ndektsv4rrffq69g5fav";
  const known = resolveTargets({
    invocation,
    automation: "nightly-sync",
    version: "ver_01arz3ndektsv4rrffq69g5fav",
    command_start: "started",
  });
  assert(known.ok);
  assertEquals(known.value.invocation, invocation);
  assertEquals(known.value.invocation_missing, null);
  assertEquals(known.value.state.invocation, {
    state: "known",
    id: invocation,
  });
  assertEquals(known.value.state.automation, {
    state: "known",
    id: "nightly-sync",
  });

  assert(NO_TARGETS.ok);
  assertEquals(NO_TARGETS.value.invocation, null);
  assertEquals(NO_TARGETS.value.invocation_missing, TARGET_REASONS.unknown);
  assertEquals(NO_TARGETS.value.state.version, { state: "unknown" });

  // 입력 검사로 시작하지 못했으면 invocation을 붙이지 않고 "실행 전"이다.
  const blocked = resolveTargets({
    invocation,
    automation: null,
    version: null,
    command_start: "blocked_before_start",
  });
  assert(blocked.ok);
  assertEquals(blocked.value.invocation, null);
  assertEquals(blocked.value.invocation_missing, TARGET_REASONS.blocked);
  assertEquals(blocked.value.state.command_start, "blocked_before_start");
  assert(TARGET_REASONS.blocked.startsWith("실행 전"));

  for (
    const bad of [
      { invocation: "inv_bad", automation: null, version: null },
      { invocation: null, automation: " ", version: null },
      {
        invocation: null,
        automation: null,
        version: "doc_01arz3ndektsv4rrffq69g5fav",
      },
    ]
  ) {
    const result = resolveTargets({ ...bad, command_start: "unknown" });
    assert(!result.ok);
    assertEquals(result.error.code, "invalid_input");
  }
});

Deno.test("problems/grouping#R6: 같은 앱의 명시적 선택만 그 문제 key, 그 밖에는 자기 Report ID로 새 key", () => {
  const key = {
    kind: "declared" as const,
    code: "save_failed",
    discriminator: null,
  };
  const selected = { id: "prb_1", app: APP_A, group_key: key };
  assertEquals(feedbackGroup(rpt(1), APP_A, "live", selected), {
    group_key: key,
    existing_problem: "prb_1",
  });
  const fresh = {
    group_key: {
      kind: "feedback" as const,
      code: "_feedback" as const,
      discriminator: rpt(1),
    },
    existing_problem: null,
  };
  assertEquals(feedbackGroup(rpt(1), APP_A, "live", null), fresh);
  // 다른 앱의 문제는 없는 문제와 같다.
  assertEquals(
    feedbackGroup(rpt(1), APP_A, "live", { ...selected, app: APP_B }),
    fresh,
  );
  // 비운영 보고는 운영 문제를 만들거나 바꾸지 않는다.
  assertEquals(feedbackGroup(rpt(1), APP_A, "preview", selected), fresh);
  assertEquals(feedbackGroup(rpt(1), APP_A, "test", selected), fresh);
  // 같은 화면·비슷한 글이어도 Report마다 다른 key다.
  assert(
    feedbackGroup(rpt(2), APP_A, "live", null).group_key.discriminator !==
      feedbackGroup(rpt(1), APP_A, "live", null).group_key.discriminator,
  );
});
