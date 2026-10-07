// 실제 core 위의 settings 연결 목록. fake core는 `providers/definitions` 응답 모양을 잘못 흉내 내도
// 통과하므로 새 temp LOPHN_HOME core(seed 없음)가 같은 통로로 내장 정의를 답하는지 본다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../../testdata/real-core.ts";
import { coreSettingsSource } from "./core-source.ts";

Deno.test("lophn-agent/harness/provider#R1, shell/wording#R10: 실제 core의 처음 설치에서 settings 연결 목록이 내장 정의를 연결 가능한 행으로 읽는다", async () => {
  const core = await startRealCore();
  try {
    const source = coreSettingsSource(core.source, {
      openWindow: undefined,
      openLink: undefined,
      picker: undefined,
    });
    const rows = await source.providers();
    assert(rows.ok, JSON.stringify(rows));
    assert(rows.value.length > 0, "fresh install lists the built-in providers");
    assert(rows.value.every((row) => !row.registered));
    assert(rows.value.every((row) => row.accounts.length === 0));
    const byDefinition = new Map(
      rows.value.map((row) => [row.definition, row]),
    );
    assertEquals(byDefinition.get("anthropic")?.ways, ["api_key"]);
    assertEquals(byDefinition.get("openai")?.ways, ["oauth", "api_key"]);
    // 로그인 값은 lophn-agent#T16이 확인하기 전이라 로그인 단추는 닫혀 있다.
    assertEquals(byDefinition.get("openai")?.signIn, { verified: false });
    assertEquals(byDefinition.get("ollama")?.ways, ["none"]);
    assertEquals(byDefinition.get("ollama")?.local, true);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
