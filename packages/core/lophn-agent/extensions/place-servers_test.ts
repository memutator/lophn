import { assertEquals } from "@std/assert";
import type { McpServerConfig } from "../../../protocol/lophn-agent/mod.ts";
import {
  allowNetList,
  allowRunList,
  collectPlaceMcpEntries,
  collectPlaceMcpServers,
  mergeMcpServers,
  PLACE_MCP_FILE,
  type PlaceServerSource,
  serializePlaceMcpFile,
} from "./mod.ts";

// 모든 자리의 MCP 서버 모음. agent-runtime child의 권한(`--allow-run`·`--allow-net`)이 자리 서버까지 덮는 재료다.
// 파일은 temp dir만 쓴다.

const PRJ = "prj_01arz3ndektsv4rrffq69g5fa1";
const PRJ_TWO = "prj_01arz3ndektsv4rrffq69g5fa9";
const APP = "app_01arz3ndektsv4rrffq69g5fa2";

function stdio(name: string, executable = `/usr/bin/${name}`, enabled = true) {
  return {
    name,
    revision: 1,
    enabled,
    transport: "stdio",
    call_timeout_ms: 60_000,
    classifications: {},
    stdio: { executable, args: [], cwd: null, env: {} },
  } as McpServerConfig;
}

function http(name: string, url: string) {
  return {
    name,
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: { url, headers: {}, auth: { kind: "none" } },
  } as McpServerConfig;
}

const source: PlaceServerSource = {
  async list(dir) {
    try {
      const names: string[] = [];
      for await (const entry of Deno.readDir(dir)) names.push(entry.name);
      return names;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
  async read(path) {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
};

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "lophn-place-servers-" });
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function writePlace(
  root: string,
  folder: string,
  servers: McpServerConfig[] | string,
) {
  Deno.mkdirSync(`${root}/${folder}`, { recursive: true });
  Deno.writeTextFileSync(
    `${root}/${folder}/${PLACE_MCP_FILE}`,
    typeof servers === "string" ? servers : serializePlaceMcpFile({
      revision: 1,
      mcp_servers: servers,
    }),
  );
}

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: the servers of every project and app are collected, and a root without places has none", async () => {
  await withRoot(async (root) => {
    assertEquals(await collectPlaceMcpServers(root, source), []);
    writePlace(root, `projects/${PRJ}`, [stdio("scoped")]);
    writePlace(root, `apps/${APP}`, [
      http("viewer", "https://v.example.test/"),
    ]);
    writePlace(root, `projects/${PRJ_TWO}`, [stdio("other")]);
    const found = await collectPlaceMcpServers(root, source);
    assertEquals(found.map((server) => server.name).sort(), [
      "other",
      "scoped",
      "viewer",
    ]);
  });
});

Deno.test("lophn-agent/extensions#R12 [agent-I19b]: a wrong place file leaves out only that place's servers", async () => {
  await withRoot(async (root) => {
    writePlace(root, `projects/${PRJ}`, [stdio("scoped")]);
    writePlace(root, `projects/${PRJ_TWO}`, "{ not json");
    writePlace(root, `apps/${APP}`, JSON.stringify({ revision: 1 }));
    // 자리 id 모양이 아닌 폴더는 자리가 아니다.
    writePlace(root, "projects/stray", [stdio("stray")]);
    const found = await collectPlaceMcpServers(root, source);
    assertEquals(found.map((server) => server.name), ["scoped"]);
  });
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: a place server with a global server's name is dropped and the global one stays", () => {
  const merged = mergeMcpServers(
    [stdio("shared", "/usr/bin/global-shared")],
    [stdio("shared", "/usr/bin/place-shared"), stdio("mine")],
  );
  assertEquals(
    merged.map((server) =>
      server.transport === "stdio"
        ? [server.name, server.stdio.executable]
        : server.name
    ),
    [["shared", "/usr/bin/global-shared"], ["mine", "/usr/bin/mine"]],
  );
});

Deno.test("lophn-agent/extensions#R14 lophn-agent/extensions#R15 [agent-I19b]: the allow lists cover exactly what an enabled place server declares", async () => {
  await withRoot(async (root) => {
    writePlace(root, `projects/${PRJ}`, [
      stdio("scoped", "/opt/scoped/bin/server"),
      stdio("off", "/opt/off/bin/server", false),
      http("remote", "https://mcp.example.test:8443/rpc"),
    ]);
    writePlace(root, `projects/${PRJ_TWO}`, [
      stdio("shared", "/opt/place/shared"),
    ]);
    const servers = mergeMcpServers(
      [stdio("shared", "/opt/global/shared")],
      await collectPlaceMcpServers(root, source),
    );
    assertEquals(allowRunList(servers), [
      "/opt/global/shared",
      "/opt/scoped/bin/server",
    ]);
    assertEquals(allowNetList(servers), ["mcp.example.test:8443"]);
  });
});

Deno.test("lophn-agent/extensions#R16 [agent-I50]: each collected server keeps the place it came from, so the same name in two places stays two servers", async () => {
  await withRoot(async (root) => {
    writePlace(root, `projects/${PRJ}`, [stdio("scoped", "/opt/one")]);
    writePlace(root, `projects/${PRJ_TWO}`, [stdio("scoped", "/opt/two")]);
    writePlace(root, `apps/${APP}`, [stdio("scoped", "/opt/app")]);
    const found = await collectPlaceMcpEntries(root, source);
    assertEquals(
      found.map((entry) => [
        entry.place,
        entry.server.transport === "stdio" ? entry.server.stdio.executable : "",
      ]),
      [
        [{ kind: "project", id: PRJ }, "/opt/one"],
        [{ kind: "project", id: PRJ_TWO }, "/opt/two"],
        [{ kind: "app", id: APP }, "/opt/app"],
      ],
    );
    assertEquals(
      (await collectPlaceMcpServers(root, source)).length,
      found.length,
    );
  });
});
