import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { TOOL_ORDER } from "../../../packages/core/agent-roles/tool-lists.ts";
import {
  guideText,
  guideTopics,
} from "../../../packages/core/agent-roles/roles/guides.ts";
import { rolePrompt } from "../../../packages/core/agent-roles/roles/prompts.ts";
import { parseSkillFrontmatter } from "../../../packages/core/lophn-agent/extensions/skills.ts";
import { toWireToolName } from "../../../packages/protocol/lophn-agent/tool-catalog.ts";
import type {
  CollectedModelCall,
  CollectedToolCall,
  VersionKind,
  VersionRef,
} from "../types.ts";
import {
  checksVersion,
  coreVersion,
  hashGroup,
  toolFileTable,
  walkFiles,
} from "./files.ts";
import { hashBundle, hashText, prettyJson } from "./hash.ts";
import {
  type Deps,
  InvalidInput,
  type Measured,
  REGISTRY_DIR,
  REPO_ROOT,
  resolveVersion,
} from "./registry.ts";

const ROLES = ["lophn", "project_manager", "app_engineer", "operator"];
const SKILL_ROOTS = [
  "packages/core/agent-roles/skills",
  "packages/coding-agent/guides/skills",
];
const TEMPLATE_DIR = "packages/core/apps/packages/template/app";
// harness가 아니라 world의 tool이다.
const WORLD_TOOL = /^(app__|mcp__|ext_)/;

const collapse = (text: string) => text.replace(/\s+/g, " ");

async function readRole(role: string): Promise<string> {
  const text = await rolePrompt(role);
  if (!text.ok) throw new Error(`role prompt missing: ${role}`);
  return text.value;
}

async function readTexts(
  dir: string,
  names: string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of names.sort()) {
    files[name] = await Deno.readTextFile(`${dir}/${name}`);
  }
  return files;
}

async function skillFolder(root: string, name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
    return null;
  }
  for (const base of SKILL_ROOTS) {
    const dir = `${root}/${base}/${name}`;
    try {
      if ((await Deno.stat(dir)).isDirectory) return dir;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return null;
}

async function skillNames(root: string): Promise<string[]> {
  const names: string[] = [];
  for (const base of SKILL_ROOTS) {
    try {
      for await (const e of Deno.readDir(`${root}/${base}`)) {
        if (e.isDirectory) names.push(e.name);
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return names.sort();
}

function frontmatter(text: string, where: string) {
  const parsed = parseSkillFrontmatter(text);
  if (!parsed.ok) throw new Error(`${where}: ${parsed.error}`);
  return parsed.value;
}

// hash가 content의 hash인 글 component.
async function textComponent(
  kind: VersionKind,
  name: string,
  content: string,
): Promise<Measured> {
  return { kind, name, hash: await hashText(content), content };
}

async function measureInstruction(role: string): Promise<Measured> {
  return textComponent("instruction", role, await readRole(role));
}

// 같은 model 이름이면 늘 같은 n이다.
async function measureModel(name: string): Promise<Measured> {
  return { kind: "model", name, hash: await hashText(name) };
}

async function measureSkill(dir: string, name: string): Promise<Measured> {
  const files = await readTexts(dir, await walkFiles(dir));
  if ("SKILL.md" in files) {
    files["SKILL.md"] = frontmatter(files["SKILL.md"], `${name}/SKILL.md`).body;
  }
  return {
    kind: "skill",
    name,
    hash: await hashBundle(files),
    content: prettyJson(files),
  };
}

function measureSkillDescription(
  name: string,
  description: string,
): Promise<Measured> {
  return textComponent("skill-description", name, collapse(description));
}

function measureGuide(topic: string, text: string): Promise<Measured> {
  return textComponent("guide", topic, text);
}

async function measureTemplate(root: string): Promise<Measured> {
  const dir = `${root}/${TEMPLATE_DIR}`;
  const files = await readTexts(dir, await walkFiles(dir));
  return {
    kind: "template",
    name: "app",
    hash: await hashBundle(files),
    content: prettyJson(files),
  };
}

export function measureCli(
  name: string,
  versionText: string,
): Promise<Measured> {
  return textComponent("cli", name, versionText);
}

async function measureGroup(
  root: string,
  group: "assembly" | "runtime",
): Promise<Measured> {
  return { kind: group, name: group, hash: await hashGroup(root, group) };
}

// 요청 body 없이 지금 checkout만으로 잴 수 있는 것 전부. 키는 `${kind}:${name}`이다.
export async function currentVersions(
  deps: Deps = {},
): Promise<Map<string, VersionRef>> {
  const root = deps.root ?? REPO_ROOT;
  const dir = deps.registryDir ?? REGISTRY_DIR;
  const measured: Measured[] = [];
  for (const role of ROLES) {
    measured.push(await measureInstruction(role));
  }
  for (const name of await skillNames(root)) {
    const folder = (await skillFolder(root, name))!;
    measured.push(await measureSkill(folder, name));
    const manifest = frontmatter(
      await Deno.readTextFile(`${folder}/SKILL.md`),
      `${name}/SKILL.md`,
    );
    measured.push(await measureSkillDescription(name, manifest.description));
  }
  for (const topic of guideTopics()) {
    measured.push(await measureGuide(topic, guideText(topic)!));
  }
  const tools = await toolFileTable(root);
  for (const name of TOOL_ORDER) {
    const tool = tools.get(name);
    if (tool === undefined) {
      throw new Error(`tool ${name} is not defined in any TOOL_FILES file`);
    }
    measured.push({ kind: "tool", name, hash: tool.hash });
  }
  measured.push(
    await measureGroup(root, "assembly"),
    await measureGroup(root, "runtime"),
    await measureTemplate(root),
  );
  const versions = new Map<string, VersionRef>();
  for (const m of measured) {
    versions.set(
      `${m.kind}:${m.name}`,
      (await resolveVersion(dir, m)).ref,
    );
  }
  const core = await coreVersion(deps);
  const checks = await checksVersion(deps);
  versions.set("core:core", core);
  versions.set("checks:checks", checks);
  return versions;
}

// 성공한 skill.read / guide.read가 연 이름. 중복 없이.
export function openedOf(
  toolCalls: CollectedToolCall[],
): { skills: string[]; guides: string[] } {
  const skills = new Set<string>();
  const guides = new Set<string>();
  for (const c of toolCalls) {
    if (c.call.outcome?.kind !== "success") continue;
    const input = c.input as Record<string, unknown> | null;
    if (c.call.tool === "skill.read" && typeof input?.name === "string") {
      skills.add(input.name);
    }
    if (c.call.tool === "guide.read" && typeof input?.topic === "string") {
      guides.add(input.topic);
    }
  }
  return { skills: [...skills], guides: [...guides] };
}

type Block = { text?: unknown };
type Body = { model: string; system: Block[]; tools: { name?: unknown }[] };

function bodyOf(request: unknown): Body {
  const b = request as Partial<Body> | null;
  if (
    b === null || typeof b !== "object" || typeof b.model !== "string" ||
    !Array.isArray(b.system) || !Array.isArray(b.tools)
  ) {
    throw new InvalidInput("model call request is not an Anthropic body");
  }
  return b as Body;
}

// run이 진짜 model이 본 component만 남긴다. core와 checks는 RunRecord에 따로 있어 넣지 않는다.
export async function seenComponents(
  sessions: {
    model_calls: CollectedModelCall[];
    tool_calls: CollectedToolCall[];
  }[],
  deps: Deps = {},
): Promise<Result<VersionRef[]>> {
  const root = deps.root ?? REPO_ROOT;
  const dir = deps.registryDir ?? REGISTRY_DIR;
  const calls = sessions.flatMap((s) => s.model_calls)
    .filter((c) => c.call.purpose === "judgment");
  if (calls.length === 0) return ok([]);
  try {
    const roleByText = new Map<string, string>();
    for (const role of ROLES) roleByText.set(await readRole(role), role);
    const wire = new Map(TOOL_ORDER.map((n) => [toWireToolName(n), n]));
    const tools = await toolFileTable(root);
    const measured = new Map<string, Measured>();
    const add = (m: Measured) => measured.set(`${m.kind}:${m.name}`, m);

    for (const c of calls) {
      if (c.request === null) {
        throw new InvalidInput("model call body could not be read");
      }
      const body = bodyOf(c.request);
      add(await measureModel(body.model));
      const first = body.system[0]?.text;
      const role = typeof first === "string"
        ? roleByText.get(first)
        : undefined;
      if (role === undefined) {
        throw new InvalidInput(
          `system[0] matches no role prompt: ${String(first).slice(0, 80)}`,
        );
      }
      add(await measureInstruction(role));
      for (const t of body.tools) {
        const wireName = String(t.name);
        if (WORLD_TOOL.test(wireName)) continue;
        const name = wire.get(wireName);
        const file = name === undefined ? undefined : tools.get(name);
        if (name === undefined || file === undefined) {
          throw new InvalidInput(`tool ${wireName} has no source file`);
        }
        add({ kind: "tool", name, hash: file.hash });
      }
      const skills = body.system.map((b) => b.text).find((t): t is string =>
        typeof t === "string" && t.startsWith("# Skills")
      );
      for (const line of skills?.split("\n").slice(2) ?? []) {
        const m = /^- ([^:]+): (.*)$/.exec(line);
        if (m === null || await skillFolder(root, m[1]) === null) continue;
        add(await measureSkillDescription(m[1], m[2]));
      }
    }
    add(await measureGroup(root, "assembly"));
    add(await measureGroup(root, "runtime"));

    const opened = openedOf(sessions.flatMap((s) => s.tool_calls));
    for (const name of opened.skills) {
      const folder = await skillFolder(root, name);
      if (folder !== null) add(await measureSkill(folder, name));
    }
    for (const topic of opened.guides) {
      const text = guideText(topic);
      if (text !== undefined) add(await measureGuide(topic, text));
    }

    const refs: VersionRef[] = [];
    for (const key of [...measured.keys()].sort()) {
      refs.push((await resolveVersion(dir, measured.get(key)!)).ref);
    }
    return ok(refs);
  } catch (e) {
    if (e instanceof InvalidInput) {
      return err({ code: "invalid_input", message: e.message });
    }
    throw e;
  }
}
