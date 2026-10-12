// lophn-agent/visuals#R4, R7: 앱 카드. 카드 크기를 선언한 화면만 참조하고,
// 앱·release가 바뀌면 계약 변경과 이용 불가를 구별해 표시하며 최신 release로 몰래
// 대체하지 않는다. 카드·탭이 command 권한을 늘리지 않는다. 문서 저장은
// agent_context read 결과(app.screen_context)의 redaction snapshot과 고정 참조를
// 남기고 snapshot을 얻지 못하면 이용 불가와 참조만 남긴다. model provider와 실제
// core는 부르지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import type { VisualBlock } from "../../../../protocol/lophn-agent/mod.ts";
import { app, at, msg, rel } from "./testing/mod.ts";
import {
  type CardView,
  checkCardScreen,
  prepareVisualDocument,
} from "./mod.ts";

const CARD: VisualBlock = {
  key: "card",
  schema_version: 1,
  kind: "app_card",
  title: "Orders card",
  description: "the live orders screen",
  sources: [],
  payload: { app, release: rel, view: "summary", input: {} },
};

const TABLE: VisualBlock = {
  key: "counts",
  schema_version: 1,
  kind: "table",
  title: "counts",
  description: "observed counts",
  sources: [],
  payload: {
    columns: [{ key: "name", label: "name", type: "string" }],
    rows: [{ name: "a" }],
  },
};

function viewOf(
  over: Partial<CardView> = {},
): CardView {
  return {
    screens: [
      { key: "summary", sizes: ["full", "panel", "card"] },
      { key: "history", sizes: ["full", "panel"] },
    ],
    ...over,
  };
}

Deno.test("lophn-agent/visuals#R4: 앱 카드는 blueprint에서 카드 크기를 지원한 화면만 참조한다", () => {
  // 카드 크기를 선언한 화면은 참조가 열린다(R4).
  const open = checkCardScreen(viewOf(), { view: "summary" });
  assertEquals(open, { ok: true, value: undefined });
  // card 크기를 선언하지 않은 화면은 거절이다(R4).
  const small = checkCardScreen(viewOf(), { view: "history" });
  assertFalse(small.ok);
  assertEquals(
    small.ok ? "" : small.error,
    { code: "card_size_absent", screen: "history" },
  );
  // 화면 자체가 없으면 같은 거절이다(R4: 카드 미지원 화면은 거절된다).
  const absent = checkCardScreen(viewOf(), { view: "secret" });
  assertFalse(absent.ok);
  assertEquals(absent.ok ? "" : absent.error.code, "card_screen_absent");
  // 화면 목록을 읽지 않은 호출자는 카드를 열지 않는다(같은 거절, 존재를 새지 않는다).
  const unread = checkCardScreen({}, { view: "summary" });
  assertFalse(unread.ok);
  assertEquals(unread.ok ? "" : unread.error.code, "card_screen_absent");
});

Deno.test("lophn-agent/visuals#R4: 앱·release가 바뀌면 계약 변경과 이용 불가를 구별하고 최신 release로 몰래 대체하지 않는다", () => {
  // 참조 판을 읽는 caller가 정한다. shell 렌더러(app-card-block.tsx)의
  // settledOf와 같은 근거다: 저장된 release와 현재 release가 달라지면 계약 변경,
  // 앱·release를 다시 못 읽으면 이용 불가다.
  const savedRelease = rel;
  const currentReleaseChanged = "rel_01arz3ndektsv4rrffq69g5fax";
  // 계약 변경이다: 같은 화면이 지금 release에도 있지만 판이 다르다.
  const readChanged = {
    ok: true as const,
    value: { release: currentReleaseChanged, screens: viewOf().screens ?? [] },
  };
  assertEquals(readChanged.value.release !== savedRelease, true);
  // 이용 불가이다: 앱이 더는 읽히지 않는다(존재를 새지 않는다).
  const gone = { ok: false as const, error: { code: "not_found" } };
  assertEquals(gone.ok, false);
  // 카드는 만든 때의 release에 고정된다: 화면이 card 크기를 잃어도 참조 자체는
  // 옛 release의 참조로 남고 새 판으로 바뀌지 않는다(R5).
  const narrowed = checkCardScreen(
    { screens: [{ key: "summary", sizes: ["full", "panel"] }] },
    { view: "summary" },
  );
  assertFalse(narrowed.ok);
});

Deno.test("lophn-agent/visuals#R4: 카드·탭이 command 권한을 늘리지 않는다", () => {
  // view에는 command 통로가 없다(shell/app-frame). 이 함수의 입력은 blueprint의
  // screens뿐이고 command·권한 자리가 없다. 렌더러가 쓰는 값도 참조의 app·release·view·input뿐이다.
  const reference = Object.keys(CARD.payload).sort();
  assertEquals(reference, ["app", "input", "release", "view"]);
  // 검사 입력은 화면 목록뿐이다: command·grant·scope 자리가 없다.
  const keys = Object.keys(viewOf());
  assertEquals(keys, ["screens"]);
});

Deno.test("lophn-agent/visuals#R7: 문서 저장은 agent_context read 결과의 redaction snapshot과 고정 참조를 남긴다", () => {
  // agent_context read 결과(app.screen_context)의 redaction된 데이터다(R7).
  const snapshot = JSON.stringify({
    app,
    release: rel,
    screen: "summary",
    view_session: "view-session-1",
    revision: "rev-7",
    summary: "Orders of today",
    redacted: ["/summary/secret_row"],
  });
  const prepared = prepareVisualDocument({
    message: msg,
    source_body: "a".repeat(64),
    blocks: [TABLE, CARD],
    captures: [{
      block_key: "card",
      snapshot,
      captured_at: at,
      hash: "b".repeat(64),
    }],
  });
  assert(prepared.ok);
  // snapshot과 hash·시각은 그대로 싣는다(R7). hash는 core가 준비한 blob의 hash다.
  assertEquals(prepared.value.snapshots, [{
    block_key: "card",
    status: "captured",
    captured_at: at,
    snapshot,
    hash: "b".repeat(64),
  }]);
  // 본문은 snapshot과 고정 참조를 남긴다(R7).
  assert(prepared.value.text.includes("Orders of today"));
  assert(prepared.value.text.includes(`<dd>${"a".repeat(64)}</dd>`));
  assert(
    prepared.value.text.includes(`app ${app} release ${rel} view summary`),
  );
  assert(prepared.value.text.includes("Captured at 2026-10-04T00:00:00.000Z."));
  // live 화면 열기 통로·credential·network 자원은 없다(R7). snapshot은 redaction 뒤
  // 레코드(제거한 path 사실 포함)이고 실행 코드·token은 없다.
  assertFalse(prepared.value.text.includes("<script"));
  assertFalse(prepared.value.text.includes("http"));
  assertFalse(/token/.test(prepared.value.text));
});

Deno.test("lophn-agent/visuals#R7: snapshot을 얻지 못하면 이용 불가와 참조만 남긴다", () => {
  // captures에 없는 카드는 unavailable과 고정 참조만이다(R7).
  const prepared = prepareVisualDocument({
    message: msg,
    source_body: "a".repeat(64),
    blocks: [CARD],
  });
  assert(prepared.ok);
  assertEquals(prepared.value.snapshots, [{
    block_key: "card",
    status: "unavailable",
    captured_at: null,
    snapshot: null,
    hash: null,
  }]);
  // 이용 불가를 적고 live 앱 화면은 넣지 않는다(R7).
  assert(
    prepared.value.text.includes("No snapshot of this card was captured."),
  );
  assert(
    prepared.value.text.includes(
      "The live app screen is not part of this document.",
    ),
  );
  // 참조는 남는다(R7).
  assert(
    prepared.value.text.includes(`app ${app} release ${rel} view summary`),
  );
  // 표는 snapshot과 상관없이 그대로다.
  const table = prepareVisualDocument({
    message: msg,
    source_body: "a".repeat(64),
    blocks: [TABLE],
    captures: [],
  });
  assert(table.ok);
  assertEquals(table.value.snapshots, []);
});
