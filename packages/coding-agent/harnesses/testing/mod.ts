// harnesses leaf의 테스트 전용 fixture다(code-map). 제품 코드와 mod.ts는
// import하지 않는다. 모든 HOME·CODEX_HOME·XDG·project·lophn home은 temp dir이고
// 사람의 실제 설정 root와 실제 harness binary는 열지도 띄우지도 않는다.
// MCP server는 mcp-fixture.ts 대역이다.
import type {
  HarnessId,
  IntegrationTarget,
} from "../../../contracts/coding-agent/mod.ts";
import { setOwned as setToml } from "../adapters/toml.ts";
import { setOwned as setYaml, type YamlMap } from "../adapters/yaml.ts";
import { buildResources } from "../builder.ts";
import { install, observe } from "../integration/apply.ts";
import { filePort, storeOf } from "../integration/journal.ts";
import { planOf } from "../integration/plan.ts";
import { catalogOf } from "../catalog/definitions.ts";
import type { LoadingInput } from "../loading.ts";
import { mcpEntryOf, type McpLaunch } from "../launch.ts";
import type { HarnessDefinition } from "../model.ts";
import { rootOf } from "../resolvers.ts";

export const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
export const NOW = "2026-10-06T00:00:00.000Z";
export const EXPECTED_TOOLS = ["lophn_index", "lophn_read"] as const;
export const SKILLS = [
  "lophn-navigate",
  "lophn-save",
  "lophn-build-app",
  "lophn-repair",
] as const;

export const FIXTURE_SERVER = new URL("./mcp-fixture.ts", import.meta.url)
  .pathname;

export type Fixture = {
  base: string;
  home: string;
  project: string;
  lophn: string;
  env: Map<string, string>;
  dispose(): Promise<void>;
};

export async function fixture(): Promise<Fixture> {
  const base = await Deno.makeTempDir({ prefix: "lophn-t32-" });
  const home = `${base}/home`;
  const project = `${base}/project`;
  const lophn = `${base}/lophn-home`;
  for (const dir of [home, project, lophn]) {
    await Deno.mkdir(dir, { recursive: true });
  }
  return {
    base,
    home,
    project,
    lophn,
    env: new Map(),
    dispose: () => Deno.remove(base, { recursive: true }),
  };
}

export async function write(path: string, text: string): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, text);
}

export function definitionOf(id: HarnessId): HarnessDefinition {
  const found = catalogOf(id);
  if (found === undefined) throw new Error(`unknown harness ${id}`);
  return found;
}

// 설치된 Deno executable로 fixture server를 띄우는 항목이다. 좁은 권한만
// 쓰는 `deno run` args다.
export function fixtureLaunch(
  mode = "ok",
  extra: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): McpLaunch {
  return {
    executable: Deno.execPath(),
    args: ["run", "--no-prompt", FIXTURE_SERVER, "--mode", mode, ...extra],
    env: { LOPHN_CONNECTION: CAC, LOPHN_MCP_TOOLSETS: "core", ...env },
  };
}

export function targetOf(
  harness: HarnessId,
  scope: "user" | "app",
  fx: Fixture,
): IntegrationTarget {
  const base = {
    environment: { kind: "host" as const, identity: "fixture" },
    profile_id: null,
    harness_id: harness,
  };
  return scope === "app"
    ? {
      ...base,
      scope_kind: "app",
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
      app_realpath: fx.project,
    }
    : { ...base, scope_kind: "user", app: null, app_realpath: null };
}

export function inputOf(
  fx: Fixture,
  harness: HarnessId,
  scope: "user" | "app",
  extra: Partial<LoadingInput> = {},
): LoadingInput {
  return {
    definition: definitionOf(harness),
    target: targetOf(harness, scope, fx),
    roots: { home: fx.home, env: fx.env, cwd: fx.project },
    denoExecutable: Deno.execPath(),
    expectedTools: EXPECTED_TOOLS,
    expectedSkills: SKILLS,
    connection: { id: CAC, state: "active" },
    ...extra,
  };
}

// scope의 root 절대 경로다. catalog root_resolver를 fixture home으로 푼다.
export function rootFor(
  fx: Fixture,
  resolver: string,
): string {
  const root = rootOf(resolver, {
    home: fx.home,
    env: fx.env,
    cwd: fx.project,
  });
  if (!root.ok) throw new Error("root");
  return root.value;
}

function nest(key: string, value: unknown): unknown {
  return key.split(".").reduceRight<unknown>(
    (inner, segment) => ({ [segment]: inner }),
    value,
  );
}

// 제품의 MCP 설정 파일에 lophn 항목을 쓴다. 쓰는 text는 제품 형식 그대로다.
// 설정 위치를 돌려준다.
export async function writeMcpConfig(
  fx: Fixture,
  harness: HarnessId,
  scope: "user" | "app",
  launch: McpLaunch,
): Promise<string> {
  const definition = definitionOf(harness);
  const config =
    definition.config_targets.find((entry) => entry.scope_kind === scope) ??
      definition.config_targets.find((entry) => entry.scope_kind === "user");
  if (config === undefined) throw new Error("no config target");
  const path = `${rootFor(fx, config.root_resolver)}/${config.path}`;
  const entry = mcpEntryOf(definition.mcp_shape, launch) as Record<
    string,
    unknown
  >;
  let text: string;
  if (config.format === "json") {
    text = `${JSON.stringify(nest(config.owned_key, entry), null, 2)}\n`;
  } else if (config.format === "toml") {
    const set = setToml("", config.owned_key, entry);
    if (set.kind !== "changed") throw new Error("toml");
    text = set.text;
  } else {
    // 없는 파일에 처음 설치하는 경로 그대로다(R8).
    const set = setYaml("", config.owned_key, entry as YamlMap);
    if (set.kind !== "changed") throw new Error("yaml");
    text = set.text;
  }
  await write(path, text);
  return path;
}

export function skillText(name: string, description: string | null): string {
  const lines = ["---", `name: ${name}`];
  if (description !== null) lines.push(`description: ${description}`);
  lines.push("---", "", `# ${name}`, "");
  return lines.join("\n");
}

// skill을 root(해석된 절대 경로) 아래 `<name>/SKILL.md`로 쓴다.
export async function writeSkills(
  root: string,
  names: readonly string[],
  description: string | null = "A lophn skill.",
): Promise<void> {
  for (const name of names) {
    await write(`${root}/${name}/SKILL.md`, skillText(name, description));
  }
}

export const MANAGED_GUIDE =
  "# App\n\n<!-- begin lophn-managed -->\nlophn guide\n<!-- end lophn-managed -->\n";

// 앱 root의 안내를 쓴다. Claude는 CLAUDE.md가 `@AGENTS.md`를 가져오고 Gemini는
// 설정 목록이 AGENTS.md를 가리킨다.
export async function writeGuide(
  fx: Fixture,
  harness: HarnessId,
): Promise<void> {
  await write(`${fx.project}/AGENTS.md`, MANAGED_GUIDE);
  if (harness === "claude") {
    await write(
      `${fx.project}/CLAUDE.md`,
      "<!-- begin lophn-managed -->\n@AGENTS.md\n<!-- end lophn-managed -->\n",
    );
  }
  if (harness === "gemini") {
    const path = `${fx.project}/.gemini/settings.json`;
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(await Deno.readTextFile(path));
    } catch {
      // 설정이 아직 없다.
    }
    current.context = { fileName: ["GEMINI.md", "AGENTS.md"] };
    await write(path, JSON.stringify(current, null, 2));
  }
}

// 디렉터리 전체의 상대 경로와 내용을 한 문자열로 모은다. 읽기 전용 관측이
// 파일·workspace를 바꾸지 않았는지 비교한다.
export async function snapshot(dir: string): Promise<string> {
  const lines: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(current)) entries.push(entry);
    entries.sort((a, b) => a.name < b.name ? -1 : 1);
    for (const entry of entries) {
      const full = `${current}/${entry.name}`;
      if (entry.isDirectory) {
        lines.push(`${full.slice(dir.length)}/`);
        await walk(full);
      } else {
        const text = await Deno.readTextFile(full);
        lines.push(`${full.slice(dir.length)} ${text.length} ${text}`);
      }
    }
  }
  await walk(dir);
  return lines.join("\n");
}

// fixture의 사람 쪽 세 root(home·project·lophn home)를 모은 snapshot이다.
// probe가 쓰는 Deno cache(base 아래)는 제외한다.
export async function snapshotAll(fx: Fixture): Promise<string> {
  return [
    await snapshot(fx.home),
    await snapshot(fx.project),
    await snapshot(fx.lophn),
  ].join("\n--\n");
}

// 설치 engine으로 MCP 항목과 skill 하나를 receipt와 함께 쓴다. 파일은 실제
// 설치 경로로 만들어 receipt와 현재 값이 일치한다.
export async function installWithReceipt(
  fx: Fixture,
  harness: HarnessId,
  scope: "user" | "app",
  launch: McpLaunch,
  skill: string,
): Promise<void> {
  const definition = definitionOf(harness);
  const built = buildResources({
    definition,
    scope,
    launch,
    version: null,
    current: {},
    skill: {
      name: skill,
      files: [{
        path: "SKILL.md",
        content: skillText(skill, "A lophn skill."),
      }],
    },
  });
  const store = storeOf(fx.lophn);
  for (const group of built.groups) {
    const root = rootFor(fx, group.root_resolver);
    const plan = planOf({
      definition,
      target: targetOf(harness, scope, fx),
      connection: CAC,
      resources: group.resources,
    });
    if (!plan.ok) throw new Error("plan");
    const seen = await observe(filePort(), root, plan.value);
    if (typeof seen === "string") throw new Error("observe");
    const applied = await install(
      filePort(),
      store,
      root,
      plan.value,
      seen,
      `op-${group.root_resolver}`,
      NOW,
    );
    for (const item of applied.resources) {
      if (item.outcome !== "changed") throw new Error(item.outcome);
    }
  }
}
