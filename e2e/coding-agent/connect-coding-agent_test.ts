// flow connect-coding-agent(docs/flows/connect-coding-agent.md). 실제 headless shell·core를 임시
// LOPHN_HOME으로 띄우고 fake Codex(fixtures/coding-agent/bin/codex)를 PATH fixture로 감지한다.
// HOME·CODEX_HOME은 temp dir이고 PATH에는 사람이 설치한 실제 coding agent 제품이 없다.
// shell main은 개발 `LOPHN_CLI`(같은 repo CLI를 deno로 도는 wrapper)로 `lophn`을 부른다.
// - 1단계: 일곱 제품 목록, PATH 감지, 사람이 요청할 때만 다시 감지(version·auth probe), 안쪽 경로는
//   접힌 Details 안에만 있다.
// - 2단계: 연결 이름·범위 form. 앱이 없으면 앱 하나 범위는 고를 수 없다(새 앱 등록 허락이 아니다).
// - 다른 갈래 keychain 잠김: core는 OS keychain(`secret-tool`, 절대 경로만 실행 허락)이 없으면 연결을
//   만들지 않고 unavailable로 끝난다. 연결·설치 결과·harness 설정 파일이 남지 않는다. 이 기계에
//   `secret-tool`이 있으면 keychain이 실제로 열릴 수 있어 이 갈래 시험은 건너뛴다.
// 통로가 없어 볼 수 없는 것: 연결 성공 갈래(3단계 credential 발급·OS keychain 보관, 4단계 설치·receipt,
// 5단계 loading 확인)는 실제 OS keychain 저장이 필요하다. 시험은 실제 keychain을 열지 않고 제품 core에
// 시험 전용 keychain 길을 두지 않으므로 이 E2E 범위 밖이다(그 순서는 packages/core/server/identity/coding-connect-flow_test.ts가
// fake keychain으로 본다). 6단계 [Start]는 start-coding-agent flow 몫이다.
import { assert, assertEquals } from "@std/assert";
import { join } from "node:path";

import { e2eEnabled } from "../harness.ts";
import { type FlowShell, openFlowShell, removeHome } from "../flow-support.ts";
import { codingFixture } from "./support.ts";

const HARNESSES = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "hermes",
  "pi",
  "openclaw",
];

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

const keychainToolPresent = (await exists("/usr/bin/secret-tool")) ||
  (await exists("/usr/local/bin/secret-tool"));

async function openCodingSettings(flow: FlowShell): Promise<void> {
  // 화면은 core 준비 전에 먼저 뜬다. 준비 전 [Connect]는 main이 "lophn is not ready"로 거절하므로
  // core 통로가 답할 때까지 먼저 기다린다(flow.call은 준비될 때까지 다시 부른다).
  const ready = await flow.call({
    kind: "read",
    resource: "coding_agent_connections",
    method: "list",
    body: {},
  });
  assert(ready.ok, "core가 준비되지 않았다");
  await flow.mouseClickText("[role=tab]", "Coding agents");
  await flow.until(
    `document.querySelector('[data-harness="codex"]') !== null`,
    "감지 결과 목록",
  );
}

Deno.test({
  name:
    "coding-agent/connection#R1 flow connect-coding-agent: PATH fixture의 fake Codex를 감지하고 사람이 고른 연결은 keychain이 없으면 unavailable로 아무것도 남기지 않는다",
  ignore: !e2eEnabled() || keychainToolPresent,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const fixture = await codingFixture();
    const flow = await openFlowShell({ start: "settings", env: fixture.env });
    try {
      await openCodingSettings(flow);

      await t.step(
        "1. 일곱 제품 중 PATH의 Codex만 감지되고 안쪽 경로는 접혀 있다",
        async () => {
          assertEquals(
            await flow.evaluate(
              `JSON.stringify([...document.querySelectorAll("[data-harness]")].map((row) => [row.dataset.harness, row.dataset.discovery]))`,
            ),
            JSON.stringify(
              HARNESSES.map((
                id,
              ) => [id, id === "codex" ? "detected" : "absent"]),
            ),
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector('[data-harness="codex"] [data-harness-details]').open`,
            ),
            false,
          );
          assert(
            (await flow.text('[data-harness="codex"] [data-harness-details]'))
              ?.includes("fixtures/coding-agent/bin/codex"),
          );
          // 저장한 감지 결과는 사람이 요청하기 전에는 다시 probe하지 않는다.
          assertEquals(
            await flow.text('[data-harness="codex"] [data-harness-facts]'),
            "Version unknown · Sign-in not checked",
          );
        },
      );

      await t.step(
        "1. [Detect again]만 version·auth probe를 다시 돈다",
        async () => {
          await flow.click('[data-action="detect-again"]');
          await flow.until(
            `document.querySelector('[data-harness="codex"] [data-harness-facts]')?.textContent === "Version 0.160.0 · Signed in"`,
            "다시 감지한 version·auth",
          );
          assertEquals(
            await flow.text("[data-detect-note]"),
            "Checked again just now.",
          );
        },
      );

      await t.step(
        "2. 연결 form은 이름과 범위만 묻고 앱 하나 범위는 앱이 있어야 고른다",
        async () => {
          await flow.click(
            '[data-harness="codex"] [data-action="connect-with"]',
          );
          await flow.until(
            `document.querySelector('form[data-connect-form="codex"]') !== null`,
            "연결 form",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector('[data-scope="all"]').getAttribute("aria-pressed")`,
            ),
            "true",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector('[data-scope="app"]').disabled`,
            ),
            true,
          );
          await flow.type("[data-connect-name]", "My Codex");
        },
      );

      await t.step(
        "다른 갈래 keychain 잠김: 연결은 unavailable이고 연결·설정 파일이 남지 않는다",
        async () => {
          await flow.click('[data-action="connect"]');
          await flow.until(
            `document.querySelector("[data-connect-failed]")?.dataset.connectFailed`,
            "연결 실패 표시",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-connect-failed]").dataset.connectFailed`,
            ),
            "unavailable",
          );
          // 실패는 core가 연결을 만들지 못한 자리다(감지·설치 단계가 아니다).
          const direct = JSON.parse(
            String(
              await flow.evaluate(
                `window.lophnCoding.connect({intent: "connect_with_harness", harness_id: "codex", label: "My Codex", scope: {kind: "all", app: null}}).then((reply) => JSON.stringify(reply))`,
              ),
            ),
          );
          assertEquals(direct.ok, false);
          assertEquals(direct.error.code, "unavailable");
          assertEquals(direct.error.message, "the connection was not created");
          const listed = await flow.call({
            kind: "read",
            resource: "coding_agent_connections",
            method: "list",
            body: {},
          });
          assert(listed.ok);
          assertEquals(
            (listed.value as { connections: unknown[] }).connections,
            [],
          );
          assertEquals(await flow.count("[data-connected]"), 0);
          assertEquals(await flow.count("[data-connections-empty]"), 1);
          assertEquals(
            await exists(join(fixture.env.CODEX_HOME, "config.toml")),
            false,
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await fixture.remove();
    }
  },
});
