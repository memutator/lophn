import { readdir, readFile, stat } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../packages/base/mod.ts";
import { TOOL_ORDER } from "../../../packages/core/agent-places/tool-lists.ts";
import { placePrompt } from "../../../packages/core/agent-places/prompts/prompts.ts";
import { parseSkillFrontmatter } from "../../../packages/core/lophn-agent/extensions/skills.ts";
import { PLACE_KINDS } from "../../../packages/protocol/lophn-agent/mod.ts";
import { RESERVED_DOMAIN_NAMES } from "../../../packages/protocol/apps/declaration/mod.ts";
import {
  MCP_TOOL_PREFIX,
  toWireToolName,
} from "../../../packages/protocol/lophn-agent/tool-catalog.ts";
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
  type VariantTexts,
} from "./registry.ts";

const SKILL_ROOTS = ["packages/core/agent-places/skills"];
const TEMPLATE_DIR = "packages/core/apps/packages/template/app";
// harness가 아니라 world의 tool이다. 앱 tool은 `<domain>_<tool>`이고 내장 자원 이름이 아닌 domain이다.
const isWorldTool = (wireName: string) =>
  wireName.startsWith(MCP_TOOL_PREFIX) ||
  !RESERVED_DOMAIN_NAMES.includes(wireName.split("_")[0]);

const collapse = (text: string) => text.replace(/\s+/g, " ");

async function readPlaceKind(
  kind: string,
  texts?: VariantTexts,
): Promise<string> {
  if (texts !== undefined) {
    const text = texts.place_prompts[kind];
    if (text === undefined)
      throw new Error(`place kind prompt missing: ${kind}`);
    return text;
  }
  const text = await placePrompt(kind as (typeof PLACE_KINDS)[number]);
  if (!text.ok) throw new Error(`place kind prompt missing: ${kind}`);
  return text.value;
}

async function readTexts(
  dir: string,
  names: string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of names.sort()) {
    files[name] = await readFile(`${dir}/${name}`, "utf8");
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
      if ((await stat(dir)).isDirectory()) return dir;
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e;
    }
  }
  return null;
}

async function skillNames(root: string): Promise<string[]> {
  const names: string[] = [];
  for (const base of SKILL_ROOTS) {
    try {
      for (const e of await readdir(`${root}/${base}`, {
        withFileTypes: true,
      })) {
        if (e.isDirectory()) names.push(e.name);
      }
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e;
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

async function measureInstruction(
  kind: string,
  texts?: VariantTexts,
): Promise<Measured> {
  return textComponent("instruction", kind, await readPlaceKind(kind, texts));
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
  for (const kind of PLACE_KINDS) {
    measured.push(await measureInstruction(kind, deps.texts));
  }
  for (const name of await skillNames(root)) {
    const folder = (await skillFolder(root, name))!;
    measured.push(await measureSkill(folder, name));
    const manifest = frontmatter(
      await readFile(`${folder}/SKILL.md`, "utf8"),
      `${name}/SKILL.md`,
    );
    measured.push(await measureSkillDescription(name, manifest.description));
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
    versions.set(`${m.kind}:${m.name}`, (await resolveVersion(dir, m)).ref);
  }
  const core = await coreVersion(deps);
  const checks = await checksVersion(deps);
  versions.set("core:core", core);
  versions.set("checks:checks", checks);
  return versions;
}

// 성공한 skill.read가 연 이름. guide도 `guide-<topic>` skill이라 여기 든다. 중복 없이.
export function openedOf(toolCalls: CollectedToolCall[]): { skills: string[] } {
  const skills = new Set<string>();
  for (const c of toolCalls) {
    if (c.call.outcome?.kind !== "success") continue;
    const input = c.input as Record<string, unknown> | null;
    if (c.call.tool === "skill.read" && typeof input?.name === "string") {
      skills.add(input.name);
    }
  }
  return { skills: [...skills] };
}

type Block = { text?: unknown };
type Body = { model: string; system: Block[]; tools: { name?: unknown }[] };

function bodyOf(request: unknown): Body {
  const b = request as Partial<Body> | null;
  if (
    b === null ||
    typeof b !== "object" ||
    typeof b.model !== "string" ||
    !Array.isArray(b.system) ||
    !Array.isArray(b.tools)
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
  const calls = sessions
    .flatMap((s) => s.model_calls)
    .filter((c) => c.call.purpose === "judgment");
  if (calls.length === 0) return ok([]);
  try {
    const kindByText = new Map<string, string>();
    for (const kind of PLACE_KINDS) {
      kindByText.set(await readPlaceKind(kind, deps.texts), kind);
    }
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
      const kind =
        typeof first === "string" ? kindByText.get(first) : undefined;
      if (kind === undefined) {
        throw new InvalidInput(
          `system[0] matches no place kind prompt: ${String(first).slice(0, 80)}`,
        );
      }
      add(await measureInstruction(kind, deps.texts));
      for (const t of body.tools) {
        const wireName = String(t.name);
        if (isWorldTool(wireName)) continue;
        const name = wire.get(wireName);
        const file = name === undefined ? undefined : tools.get(name);
        if (name === undefined || file === undefined) {
          throw new InvalidInput(`tool ${wireName} has no source file`);
        }
        add({ kind: "tool", name, hash: file.hash });
      }
      const skills = body.system
        .map((b) => b.text)
        .find(
          (t): t is string => typeof t === "string" && t.startsWith("# Skills"),
        );
      for (const line of skills?.split("\n").slice(2) ?? []) {
        const m = /^- ([^:]+): (.*)$/.exec(line);
        if (m === null || (await skillFolder(root, m[1])) === null) continue;
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
