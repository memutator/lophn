import { assert, assertEquals } from "@std/assert";
import type { McpServerConfig } from "../../protocol/lophn-agent/mod.ts";
import {
  createNodePlaceFiles,
  createNodeSkillFiles,
} from "./adapters/node-fs.ts";
import {
  commandSkillsOf,
  createExtensionRegistry,
  mcpToolsOf,
  PLACE_MCP_FILE,
  placeFolderOf,
  serializePlaceMcpFile,
} from "./mod.ts";

// 동기 등록부: agents read와 `/` 메뉴가 읽는 한 자리의 skill·MCP 목록. 파일은 temp dir만 쓴다.

const PRJ = { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fa1" } as const;
const OTHER = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa9",
} as const;
const APP = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" } as const;

function server(
  name: string,
  tools: string[] = [],
  over: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    name,
    revision: 1,
    enabled: true,
    transport: "stdio",
    call_timeout_ms: 60_000,
    classifications: Object.fromEntries(
      tools.map((tool) => [
        tool,
        {
          effect: "read" as const,
          schema_hash: "ab".repeat(32),
          reversible: false,
        },
      ]),
    ),
    stdio: { executable: `/usr/bin/${name}`, args: [], cwd: null, env: {} },
    ...over,
  } as McpServerConfig;
}

function writeSkill(folder: string, name: string, description: string) {
  Deno.mkdirSync(`${folder}/${name}`, { recursive: true });
  Deno.writeTextFileSync(
    `${folder}/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: ${description}\n---\n본문\n`,
  );
}

async function withRoot(run: (root: string) => void | Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "lophn-extension-registry-" });
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function registry(
  root: string,
  servers: McpServerConfig[] = [],
  skillsOff: string[] = [],
) {
  return createExtensionRegistry({
    root,
    files: createNodePlaceFiles(),
    skillFiles: createNodeSkillFiles(),
    global: {
      servers,
      skills: {
        registered: [`${root}/registered`],
        personal: `${root}/skills`,
        bundled: `${root}/bundled`,
      },
      skillsOff,
    },
  });
}

function writePlaceServers(
  root: string,
  place: { kind: "project" | "app"; id: string },
  servers: McpServerConfig[],
) {
  const folder = placeFolderOf(root, place);
  Deno.mkdirSync(folder, { recursive: true });
  Deno.writeTextFileSync(
    `${folder}/${PLACE_MCP_FILE}`,
    serializePlaceMcpFile({ revision: 1, mcp_servers: servers }),
  );
}

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: the folder of a place is under the data root by kind and id, apart from every other place", () => {
  assertEquals(
    placeFolderOf("/data", PRJ),
    `/data/projects/${PRJ.id}`,
  );
  assertEquals(placeFolderOf("/data", APP), `/data/apps/${APP.id}`);
  assert(PLACE_MCP_FILE.length > 0 && !PLACE_MCP_FILE.includes("/"));
  // agents/settings.md와 이름도 자리도 겹치지 않는다.
  assert(String(PLACE_MCP_FILE) !== "settings.md");
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: an agent of a place sees that place's skills with the global ones, and another place does not", async () => {
  await withRoot((root) => {
    writeSkill(
      `${placeFolderOf(root, PRJ)}/skills`,
      "phroner-style",
      "Only here",
    );
    writeSkill(`${root}/registered`, "audit", "Registered");
    writeSkill(`${root}/skills`, "notes", "Personal");
    writeSkill(`${root}/bundled`, "basics", "Bundled");
    const reg = registry(root);
    assertEquals(
      reg.skills(PRJ).entries.map((entry) => entry.name),
      ["phroner-style", "audit", "notes", "basics"],
    );
    assertEquals(
      reg.skills(OTHER).entries.map((entry) => entry.name),
      ["audit", "notes", "basics"],
    );
    assertEquals(
      reg.skills(APP).entries.map((entry) => entry.name),
      ["audit", "notes", "basics"],
    );
  });
});

Deno.test("lophn-agent/extensions#R8 [agent-I19b]: one registry gives one place the same list however often it is asked, and a new registry sees new skills", async () => {
  await withRoot((root) => {
    writeSkill(`${root}/registered`, "audit", "Registered");
    const reg = registry(root);
    const first = reg.skills(PRJ);
    writeSkill(`${placeFolderOf(root, PRJ)}/skills`, "late-one", "Added later");
    assertEquals(reg.skills(PRJ), first);
    assertEquals(
      registry(root).skills(PRJ).entries.map((entry) => entry.name),
      ["late-one", "audit"],
    );
  });
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: the servers an agent can use are the global ones and its place's own, in that order", async () => {
  await withRoot((root) => {
    writePlaceServers(root, PRJ, [server("scoped", ["lookup"])]);
    const reg = registry(root, [server("shared", ["search"])]);
    assertEquals(reg.mcpServers(PRJ).map((entry) => entry.name), [
      "shared",
      "scoped",
    ]);
    assertEquals(reg.mcpServers(OTHER).map((entry) => entry.name), ["shared"]);
    assertEquals(reg.mcpServers(APP).map((entry) => entry.name), ["shared"]);
  });
});

Deno.test("lophn-agent/extensions#R12 [agent-I19b]: a wrong place server file gives no place servers and leaves the global ones", async () => {
  await withRoot((root) => {
    const folder = placeFolderOf(root, PRJ);
    Deno.mkdirSync(folder, { recursive: true });
    Deno.writeTextFileSync(`${folder}/${PLACE_MCP_FILE}`, "{ not json");
    const reg = registry(root, [server("shared")]);
    assertEquals(reg.mcpServers(PRJ).map((entry) => entry.name), ["shared"]);
    // 전역 서버와 이름이 겹치는 자리 서버는 쓰지 않는다. 파일을 손으로 고쳐도 R33이 지켜진다.
    writePlaceServers(root, OTHER, [server("shared"), server("mine")]);
    assertEquals(
      registry(root, [server("shared")]).mcpServers(OTHER).map((entry) =>
        entry.name
      ),
      [
        "shared",
        "mine",
      ],
    );
    const clash = registry(root, [server("shared", [], { revision: 7 })])
      .mcpServers(OTHER)
      .filter((entry) => entry.name === "shared");
    assertEquals(clash.length, 1);
    assertEquals(clash[0].revision, 7);
  });
});

Deno.test("lophn-agent/extensions#R31 [agent-I19b]: the tools offered for choosing are those of the enabled servers, by server and tool name", () => {
  assertEquals(
    mcpToolsOf([
      server("shared", ["search", "open"]),
      server("off", ["x"], { enabled: false }),
      server("scoped", ["lookup"]),
    ]),
    [
      { server_name: "shared", original_tool: "search" },
      { server_name: "shared", original_tool: "open" },
      { server_name: "scoped", original_tool: "lookup" },
    ],
  );
});

Deno.test("lophn-agent/extensions#R4 lophn-agent/commands#R7 [agent-I19b]: the menu skills carry their layer, and the ones the agent turned off are marked", () => {
  const entries = [
    {
      name: "phroner-style",
      description: "Here",
      source_kind: "place" as const,
    },
    {
      name: "audit",
      description: "Registered",
      source_kind: "registered" as const,
    },
    {
      name: "notes",
      description: "Personal",
      source_kind: "personal" as const,
    },
    { name: "basics", description: "Bundled", source_kind: "bundled" as const },
  ];
  assertEquals(commandSkillsOf(entries, ["notes", "gone-now"]), [
    {
      name: "phroner-style",
      description: "Here",
      origin: "place",
      selected: true,
    },
    {
      name: "audit",
      description: "Registered",
      origin: "workspace",
      selected: true,
    },
    {
      name: "notes",
      description: "Personal",
      origin: "workspace",
      selected: false,
    },
    {
      name: "basics",
      description: "Bundled",
      origin: "workspace",
      selected: true,
    },
  ]);
  assertEquals(
    commandSkillsOf(entries, []).every((skill) => skill.selected),
    true,
  );
});

Deno.test("lophn-agent/extensions#R4 shell/desktop#Q22 [agent-I49]: 전역에서 끈 skill은 모든 자리의 agent에게 보이지 않고 켜 둔 것과 자리 층의 같은 이름은 그대로 보인다", async () => {
  await withRoot((root) => {
    writeSkill(
      `${placeFolderOf(root, PRJ)}/skills`,
      "audit",
      "Place copy of a globally-off name",
    );
    writeSkill(`${root}/registered`, "audit", "Registered");
    writeSkill(`${root}/registered`, "style", "Registered style");
    writeSkill(`${root}/skills`, "notes", "Personal");
    writeSkill(`${root}/bundled`, "basics", "Bundled");
    const reg = registry(root, [], ["style", "basics", "audit", "missing"]);
    // 자리에 같은 이름이 있으면 자리의 것이 이긴다. 전역 끄기는 전역 층의 것만 가린다.
    assertEquals(
      reg.skills(PRJ).entries.map((entry) => [entry.name, entry.source_kind]),
      [["audit", "place"], ["notes", "personal"]],
    );
    assertEquals(
      reg.skills(OTHER).entries.map((entry) => entry.name),
      ["notes"],
    );
    assertEquals(
      reg.skills(APP).entries.map((entry) => entry.name),
      ["notes"],
    );
  });
});

Deno.test("lophn-agent/extensions#R4 shell/desktop#Q22 [agent-I49]: 끈 목록이 비어 있으면 아무것도 가리지 않는다", async () => {
  await withRoot((root) => {
    writeSkill(`${root}/registered`, "audit", "Registered");
    assertEquals(
      registry(root).skills(OTHER).entries.map((entry) => entry.name),
      ["audit"],
    );
  });
});
