// `lophn mcp config` 테스트다(coding-agent/cli#R9, T30). 설정 파일은 temp
// fixture이고 사람의 실제 설정 root는 열지 않는다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { mcpConfigOf } from "./mcp.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

const BASE = {
  executable: "/opt/lophn/bin/deno",
  resources: "/opt/lophn/resources",
  cache: "/opt/lophn/cache",
  discoveryFiles: ["/opt/lophn/run/daemon.json"],
  submissionRoot: "/work/app",
  coreAddress: "127.0.0.1:7431",
  appAddresses: [],
};

Deno.test("coding-agent/cli#R9: mcp config는 일곱 제품의 조각만 내고 설정 파일 bytes를 바꾸지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-t30-cli-" });
  const file = `${home}/.claude.json`;
  const bytes = '{"mcpServers":{"lophn":{"command":"mine"}}}\n';
  await Deno.writeTextFile(file, bytes);
  const kinds: Record<string, string> = {};
  for (
    const id of [
      "claude",
      "codex",
      "opencode",
      "hermes",
      "pi",
      "gemini",
      "openclaw",
    ] as const
  ) {
    const out = mcpConfigOf(
      { target: id, scope: "user", connection: CAC },
      BASE,
    );
    assert(out.ok, id);
    if (!out.ok) continue;
    kinds[id] = out.value.fragment.format;
    // executable·분리 argv·안전 env만이고 secret·운영 경로는 없다.
    assertEquals(out.value.executable, "/opt/lophn/bin/deno");
    assert(Array.isArray(out.value.args));
    assertEquals(Object.keys(out.value.env).sort(), [
      "LOPHN_CONNECTION",
      "LOPHN_MCP_TOOLSETS",
    ]);
    const text = JSON.stringify(out.value);
    assert(!/token|secret|password/i.test(text), id);
    assert(!text.includes("/.lophn"), id);
    assert(out.value.fragment.text.includes(CAC), id);
    assert(
      out.value.fragment.location === null ||
        !out.value.fragment.location.startsWith("/"),
      id,
    );
  }
  assertEquals(kinds, {
    claude: "json",
    codex: "toml",
    opencode: "json",
    hermes: "yaml",
    pi: "json",
    gemini: "json",
    openclaw: "json",
  });
  assertEquals(await readOrNull(file), bytes);
  // 제품 모양: Codex TOML 표, OpenCode local 배열.
  const codex = mcpConfigOf(
    { target: "codex", scope: "user", connection: CAC },
    BASE,
  );
  assert(codex.ok);
  if (codex.ok) {
    assertStringIncludes(codex.value.fragment.text, "[mcp_servers.lophn]");
  }
  const opencode = mcpConfigOf(
    {
      target: "opencode",
      scope: "app",
      connection: CAC,
      toolsets: "core",
    },
    BASE,
  );
  assert(opencode.ok);
  if (opencode.ok) {
    const parsed = JSON.parse(opencode.value.fragment.text);
    assertEquals(parsed.mcp.lophn.type, "local");
    assertEquals(parsed.mcp.lophn.command[0], "/opt/lophn/bin/deno");
    assertEquals(parsed.mcp.lophn.environment.LOPHN_MCP_TOOLSETS, "core");
  }
});

Deno.test("coding-agent/cli#R9: mcp config는 Codex 앱 범위를 거절하고 connection 없는 요청을 거절한다", () => {
  const app = mcpConfigOf(
    { target: "codex", scope: "app", connection: CAC },
    BASE,
  );
  assertEquals(app.ok, false);
  const none = mcpConfigOf(
    { target: "claude", scope: "user" },
    BASE,
  );
  assertEquals(none.ok, false);
});
