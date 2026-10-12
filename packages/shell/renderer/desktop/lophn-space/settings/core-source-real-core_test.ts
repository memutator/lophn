// 실제 core 위의 Settings › Tools and skills 로그인. fake core는 memory route의 이름과 입력 모양을 잘못
// 흉내 내도 통과하므로, 새 temp LOPHN_HOME core에 OAuth server를 등록하고 같은 통로로 BeginMcpAuth가
// 인증 주소를 돌려주는지 본다. 로그인을 끝내는 일은 사람이 browser에서 돌아와야 하므로 여기서 하지 않는다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../../testdata/real-core.ts";
import { coreSettingsSource } from "./core-source.ts";
import { applySetting, MCP_SERVERS } from "./extension-settings.ts";
import { OAUTH_SERVER } from "./testdata/fake-core.ts";

async function rowOf(
  source: ReturnType<typeof coreSettingsSource>,
  name: string,
) {
  const view = await source.settings();
  assert(view.ok, JSON.stringify(view));
  return view.value.servers.find((entry) => entry.name === name)!;
}

Deno.test("lophn-agent/extensions#R16 shell/desktop#R50 [agent-I51]: 실제 core에서 로그인이 필요한 전역 OAuth server의 로그인을 시작하면 인증 주소를 OS browser로 연다", async () => {
  const core = await startRealCore();
  try {
    const opened: string[] = [];
    const source = coreSettingsSource(core.source, {
      openWindow: undefined,
      picker: undefined,
      openLink: (url) => {
        opened.push(url);
        return Promise.resolve({ ok: true });
      },
    });
    const first = await source.settings();
    assert(first.ok, JSON.stringify(first));
    const added = await applySetting(
      core.source,
      first.value,
      MCP_SERVERS,
      [OAUTH_SERVER("notes", null)],
      () => "r1",
    );
    assert(added.ok, JSON.stringify(added));
    const view = await source.settings();
    assert(view.ok, JSON.stringify(view));
    const row = view.value.servers.find((entry) => entry.name === "notes")!;
    assertEquals(row.signIn, {
      place: null,
      clientId: "lophn-client",
      scopes: ["read", "write"],
      state: "none",
      reason: null,
    });
    const begun = await source.beginSignIn(row);
    assert(begun.ok, JSON.stringify(begun));
    assert(begun.value.callbackPort > 0);
    assertEquals(opened.length, 1);
    const url = new URL(opened[0]!);
    assertEquals(
      url.origin + url.pathname,
      "https://auth.example.com/authorize",
    );
    assertEquals(url.searchParams.get("client_id"), "lophn-client");
    assertEquals(
      url.searchParams.get("redirect_uri")?.includes(
        `:${begun.value.callbackPort}`,
      ),
      true,
    );
    // 시작한 로그인은 core가 in_progress로 말하고, 그만두면 none으로 돌아와 다시 시작할 수 있다.
    const waiting = await rowOf(source, "notes");
    assertEquals(waiting.signIn?.state, "in_progress");
    const cancelled = await source.cancelSignIn(waiting);
    assert(cancelled.ok, JSON.stringify(cancelled));
    assertEquals((await rowOf(source, "notes")).signIn?.state, "none");
    const again = await source.beginSignIn(waiting);
    assert(again.ok, JSON.stringify(again));
    assertEquals(opened.length, 2);
    assertEquals((await rowOf(source, "notes")).signIn?.state, "in_progress");
  } catch (error) {
    throw new Error(
      `${(error as Error).message}\n--- core ---\n${core.log()}`,
    );
  } finally {
    await core.stop();
  }
});
