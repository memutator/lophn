// 실제 core 위의 Settings › Providers. fake core는 `providers/definitions` 응답 모양을 잘못 흉내 내도
// 통과하므로 새 temp LOPHN_HOME core(seed 없음)가 같은 통로로 내장 정의를 답하는지 본다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../../../testdata/real-core.ts";
import { coreProviderSettingsSource } from "./core-source.ts";

Deno.test("lophn-agent/harness/provider#R1, shell/desktop#R49 [agent-I46]: 실제 core의 처음 설치에서 Providers는 연결된 provider 없이 내장 정의를 Add a provider 목록으로 읽는다", async () => {
  const core = await startRealCore();
  try {
    const source = coreProviderSettingsSource(core.source, {
      openWindow: undefined,
      openLink: undefined,
    });
    const connected = await source.connected();
    assert(connected.ok, JSON.stringify(connected));
    assertEquals(connected.value, []);
    const available = await source.available();
    assert(available.ok, JSON.stringify(available));
    const byKey = new Map(available.value.map((row) => [row.key, row]));
    assertEquals(byKey.get("anthropic")?.ways, ["api_key"]);
    assertEquals(byKey.get("openai")?.ways, ["oauth", "api_key"]);
    assertEquals(byKey.get("openai")?.signIn?.product, "ChatGPT");
    assertEquals(byKey.get("ollama")?.ways, ["none"]);
    assertEquals(available.value.at(-1)?.custom, true);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
