import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../../packages/design/components/testing.ts";

import { find, flush, typeInto } from "../../testdata/dom.ts";
import { CodingConnectionsPanel } from "./connections-panel.tsx";
import {
  APP_BUDGET,
  CAC_APP,
  CAC_DESK,
  CAC_OLD,
  CONNECTED,
  DETECTED,
  fakeConnections,
  type FakeConnectionsOptions,
} from "./testdata/fake-source.ts";

// 안쪽 이름·ID·raw 값은 기본 화면 글에 없다. 펼친 자리(details)는 빼고 본다.
const INTERNAL = [
  "cac_",
  "app_",
  "tkt_",
  "mcp_initialize",
  "tool_discovery",
  "detected",
  "absent",
  "not_verified",
  "snapshot",
  "ledger",
  "/usr/local/bin",
];

function visibleText(root: Element): string {
  const shown = root.cloneNode(true) as Element;
  for (const folded of shown.querySelectorAll("details")) folded.remove();
  return shown.textContent ?? "";
}

function noInternal(root: Element): void {
  const text = visibleText(root);
  for (const word of INTERNAL) {
    assert(!text.includes(word), `기본 화면 글에 ${word}가 있다`);
  }
}

async function open(options: FakeConnectionsOptions = {}, focus?: string) {
  const fake = fakeConnections(options);
  const view = render(
    <CodingConnectionsPanel source={fake.source} focus={focus} />,
  );
  await flush();
  return { fake, view };
}

function harnessRow(root: Element, id: string): HTMLElement {
  return find(root, `[data-harness='${id}']`);
}

Deno.test("flow connect-coding-agent 1, coding-agent/harnesses#R2, R3: 감지 결과는 제품마다 찾음·못 찾음·확인 못 함을 구별하고 감지된 제품만 고를 수 있다", async () => {
  const { fake, view } = await open();
  using _ = view;
  const rows = [...view.container.querySelectorAll("[data-harness]")];
  assertEquals(rows.map((row) => row.getAttribute("data-harness")), [
    "claude",
    "codex",
    "opencode",
    "gemini",
    "hermes",
    "pi",
    "openclaw",
  ]);
  assertStringIncludes(rows[0]!.textContent ?? "", "Claude Code");
  assertStringIncludes(rows[0]!.textContent ?? "", "Found");
  assertStringIncludes(rows[0]!.textContent ?? "", "Version 1.2.3");
  assertStringIncludes(rows[0]!.textContent ?? "", "Signed in");
  // 존재만으로 로그인이 확인됐다고 하지 않는다.
  assertStringIncludes(rows[1]!.textContent ?? "", "No sign-in found");
  assertStringIncludes(rows[2]!.textContent ?? "", "Not found");
  assertStringIncludes(rows[3]!.textContent ?? "", "Couldn't check");
  assertStringIncludes(rows[6]!.textContent ?? "", "Not checked");
  // 고르는 단추는 감지된 제품에만 있다.
  const connectable = rows.filter((row) =>
    row.querySelector("[data-action='connect-with']") !== null
  ).map((row) => row.getAttribute("data-harness"));
  assertEquals(connectable, ["claude", "codex"]);
  // 열 때 저장한 결과만 읽고 재감지하지 않는다.
  assertEquals(fake.calls.detect, 1);
  assertEquals(fake.calls.refresh, 0);
  noInternal(view.container);
});

Deno.test("coding-agent/harnesses#R2: 감지 기록(경로·후보·확인 항목)은 펼친 자리에만 있다", async () => {
  const { view } = await open();
  using _ = view;
  const claude = harnessRow(view.container, "claude");
  const details = find(claude, "[data-harness-details]");
  assertStringIncludes(details.textContent ?? "", "/usr/local/bin/claude");
  assertStringIncludes(details.textContent ?? "", "version: ok");
  assert(!visibleText(claude).includes("/usr/local/bin"));
  // 못 찾은 제품은 펼칠 기록이 없다.
  assertEquals(
    harnessRow(view.container, "opencode").querySelector(
      "[data-harness-details]",
    ),
    null,
  );
});

Deno.test("coding-agent/harnesses#R2: 다시 감지는 사람이 [Detect again]을 누를 때 한 번만 하고 실패하면 이전 결과를 지우지 않는다", async () => {
  {
    const { fake, view } = await open();
    using _ = view;
    click(find(view.container, "[data-action='detect-again']"));
    await flush();
    assertEquals(fake.calls.refresh, 1);
    assertEquals(fake.calls.detect, 1);
    assertStringIncludes(
      find(view.container, "[data-detect-note]").textContent ?? "",
      "Checked again",
    );
  }
  {
    const { fake, view } = await open({
      refresh: { ok: false, code: "unavailable" },
    });
    using _ = view;
    click(find(view.container, "[data-action='detect-again']"));
    await flush();
    assertEquals(fake.calls.refresh, 1);
    assert(view.container.querySelector("[data-detect-failed]") !== null);
    assertEquals(view.container.querySelectorAll("[data-harness]").length, 7);
  }
  {
    const { view } = await open({ detect: { ok: false, code: "unavailable" } });
    using _ = view;
    const error = find(view.container, "[data-state='error']");
    assertStringIncludes(error.textContent ?? "", "your coding agents");
  }
});

Deno.test("shell/desktop#R19, flow connect-coding-agent 2: 고른 제품·이름·범위만 고정 intent로 보내고 확인 창도 token 입력도 없다", async () => {
  const { fake, view } = await open();
  using _ = view;
  click(
    find(harnessRow(view.container, "claude"), "[data-action='connect-with']"),
  );
  await flush();
  const form = find(view.container, "[data-connect-form='claude']");
  // 이름은 제품 이름으로 채워 둔다. 사람이 고쳐도 되고 token을 만들거나 붙여 넣는 칸은 없다.
  const name = find(form, "[data-connect-name]") as HTMLInputElement;
  assertEquals(name.value, "Claude Code on this computer");
  assertEquals(view.container.querySelector("input[type='password']"), null);
  assertStringIncludes(form.textContent ?? "", "no token to create or paste");
  typeInto(name, "Desk Claude");
  click(find(form, "[data-action='connect']"));
  await flush();
  assertEquals(fake.calls.connect, [
    { harness: "claude", label: "Desk Claude", scope: { kind: "all" } },
  ]);
  // 결과: 연결 생성·설치·확인 단계는 서로 다른 줄이다.
  const result = find(view.container, "[data-connected]");
  assertEquals(result.getAttribute("data-connected"), "complete");
  assertStringIncludes(result.textContent ?? "", "Claude Code is connected.");
  assertStringIncludes(result.textContent ?? "", "Set up");
  const checks = [...result.querySelectorAll("[data-check]")];
  assertEquals(checks.map((check) => check.getAttribute("data-check")), [
    "mcp_initialize",
    "tool_discovery",
    "skill_discovery",
    "app_guide_loading",
  ]);
  assertStringIncludes(
    checks[0]!.textContent ?? "",
    "Connects to lophn: Works",
  );
  assertStringIncludes(checks[2]!.textContent ?? "", "Not confirmed");
  assertStringIncludes(checks[3]!.textContent ?? "", "Doesn't work");
  // 확인하지 못한 단계는 성공 색이 아니다.
  assertEquals(
    checks[2]!.querySelector("[data-tone]")?.getAttribute("data-tone"),
    "warning",
  );
  assertEquals(
    checks[0]!.querySelector("[data-tone]")?.getAttribute("data-tone"),
    "good",
  );
  // 설치 위치는 펼친 자리에만 있다.
  assertStringIncludes(
    find(result, "[data-install-details]").textContent ?? "",
    "claude/mcp: changed",
  );
  assert(!visibleText(result).includes("claude/mcp"));
});

Deno.test("coding-agent/connection#R2: 앱 하나 범위는 앱을 고른 뒤에만 연결할 수 있고 그 앱만 보낸다", async () => {
  const { fake, view } = await open();
  using _ = view;
  click(
    find(harnessRow(view.container, "codex"), "[data-action='connect-with']"),
  );
  await flush();
  const form = find(view.container, "[data-connect-form='codex']");
  click(find(form, "[data-scope='app']"));
  await flush();
  const connect = find(form, "[data-action='connect']") as HTMLButtonElement;
  assert(connect.disabled, "앱을 고르기 전에는 연결할 수 없다");
  const apps = [...form.querySelectorAll("[data-scope-app]")];
  assertEquals(apps.map((app) => app.textContent), [
    "Grocery budget",
    "Recipes",
  ]);
  click(apps[0]!);
  await flush();
  assert(
    !(find(form, "[data-action='connect']") as HTMLButtonElement).disabled,
  );
  click(find(form, "[data-action='connect']"));
  await flush();
  assertEquals(fake.calls.connect, [{
    harness: "codex",
    label: "Codex on this computer",
    scope: { kind: "app", app: APP_BUDGET },
  }]);
});

Deno.test("coding-agent/connection#R12: 연결은 됐지만 설치가 일부만 됐거나 실패하면 따로 알리고 확인 단계를 성공으로 채우지 않는다", async () => {
  const { view } = await open({
    connect: {
      ok: true,
      value: {
        ...CONNECTED,
        install: { status: "partial", resources: [] },
        checks: null,
      },
    },
  });
  using _ = view;
  click(
    find(harnessRow(view.container, "claude"), "[data-action='connect-with']"),
  );
  await flush();
  click(find(view.container, "[data-action='connect']"));
  await flush();
  const result = find(view.container, "[data-connected]");
  assertEquals(result.getAttribute("data-connected"), "partial");
  assertStringIncludes(result.textContent ?? "", "Partly set up");
  assert(result.querySelector("[data-checks='unavailable']") !== null);
  assertEquals(result.querySelector("[data-install-details]"), null);
});

Deno.test("shell/wording#R10: 연결을 만들지 못하면 이유 한 문장과 함께 입력을 그대로 두고 연결 목록은 늘지 않는다", async () => {
  for (
    const [code, text] of [
      ["not_detected", "wasn't found on this computer"],
      ["conflict", "already exists"],
      ["forbidden", "didn't accept that choice"],
      ["unavailable", "Couldn't connect right now"],
    ] as const
  ) {
    const { fake, view } = await open({ connect: { ok: false, code } });
    using _ = view;
    click(
      find(
        harnessRow(view.container, "claude"),
        "[data-action='connect-with']",
      ),
    );
    await flush();
    click(find(view.container, "[data-action='connect']"));
    await flush();
    assertStringIncludes(
      find(view.container, "[data-connect-failed]").textContent ?? "",
      text,
    );
    // 폼은 그대로 있고 성공 결과는 없다.
    assert(view.container.querySelector("[data-connect-form]") !== null);
    assertEquals(view.container.querySelector("[data-connected]"), null);
    assertEquals(fake.calls.connect.length, 1);
  }
});

Deno.test("flow manage-coding-access 1: 연결 목록은 이름·범위·상태를 보이고 같은 이름이 헷갈리지 않게 범위를 함께 보인다", async () => {
  const { view } = await open();
  using _ = view;
  const rows = [...view.container.querySelectorAll("[data-connection]")];
  assertEquals(rows.map((row) => row.getAttribute("data-connection")), [
    "active",
    "active",
    "revoked",
  ]);
  assertStringIncludes(rows[0]!.textContent ?? "", "Desk Claude");
  assertStringIncludes(rows[0]!.textContent ?? "", "All apps");
  assertStringIncludes(rows[0]!.textContent ?? "", "Active");
  assertStringIncludes(rows[1]!.textContent ?? "", "Only Grocery budget");
  assertStringIncludes(rows[2]!.textContent ?? "", "Revoked");
  noInternal(view.container);
});

Deno.test("flow manage-coding-access 2, 5: 회수는 확인 창을 여는 일뿐이고 창을 열어도 회수됐다고 하지 않으며 회수된 연결은 외부 프로세스를 멈췄다고 하지 않는다", async () => {
  const { fake, view } = await open();
  using _ = view;
  const rows = [...view.container.querySelectorAll("[data-connection]")];
  click(find(rows[0]!, "[data-action='revoke']"));
  await flush();
  assertEquals(fake.calls.revoke, [CAC_DESK]);
  // 결정은 창에서만 받는다. 아직 active이고 기다린다고만 말한다.
  const after = find(view.container, `[data-connection-list] > li`);
  assertEquals(after.getAttribute("data-connection"), "active");
  assert(view.container.querySelector("[data-revoke-waiting]") !== null);
  // 회수된 줄에는 [Revoke]가 없고 이미 떠 있는 프로세스는 멈추지 않는다고 말한다.
  const revoked = rows[2]!;
  assertEquals(revoked.querySelector("[data-action='revoke']"), null);
  assertStringIncludes(
    find(revoked, "[data-revoked-note]").textContent ?? "",
    "already running in your coding agent keeps running",
  );
});

Deno.test("flow manage-coding-access 2: 결정 창을 열지 못하면 실패를 알리고 회수된 것으로 표시하지 않는다", async () => {
  const { view } = await open({ revoke: { ok: false, code: "unavailable" } });
  using _ = view;
  click(find(view.container, "[data-action='revoke']"));
  await flush();
  assert(view.container.querySelector("[data-revoke-failed]") !== null);
  assertEquals(view.container.querySelector("[data-revoke-waiting]"), null);
  assertEquals(
    view.container.querySelectorAll("[data-connection='active']").length,
    2,
  );
});

Deno.test("coding-agent#T40: 회수 링크로 온 연결은 목록의 맨 위에 보인다", async () => {
  const { view } = await open({}, CAC_APP);
  using _ = view;
  const first = find(view.container, "[data-connection-list] > li");
  assertEquals(first.getAttribute("data-focused"), "");
  assertStringIncludes(first.textContent ?? "", "Budget only");
  // 다른 연결은 그대로 뒤에 있다.
  assertEquals(
    view.container.querySelectorAll("[data-focused]").length,
    1,
  );
  assert(CAC_OLD.startsWith("cac_") && DETECTED.harnesses.length === 7);
});

Deno.test("shell/wording#R10: 연결이 없으면 없다고 하고 읽기에 실패하면 실패한 대상과 다시 읽기를 보인다", async () => {
  {
    const { view } = await open({ connections: { ok: true, value: [] } });
    using _ = view;
    assertStringIncludes(
      find(view.container, "[data-connections-empty]").textContent ?? "",
      "No coding agent is connected yet",
    );
  }
  {
    const { view } = await open({
      connections: { ok: false, code: "unavailable" },
    });
    using _ = view;
    const errors = [...view.container.querySelectorAll("[data-state='error']")];
    assertEquals(errors.length, 1);
    assertStringIncludes(
      errors[0]!.textContent ?? "",
      "your coding agent connections",
    );
    // 감지 자리는 그대로 읽혀 있다.
    assertEquals(view.container.querySelectorAll("[data-harness]").length, 7);
  }
});
