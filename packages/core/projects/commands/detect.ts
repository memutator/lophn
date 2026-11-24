// 프로젝트 등록 폴더를 읽기 전용으로 훑어 ProjectCommand 후보를 찾는다(spec 3.5).
// 어떤 파일도 쓰지 않고, 저절로 등록하지 않는다.
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  type CommandIcon,
  type CommandKind,
  type DetectedCommandCandidate,
  type DetectResult,
  type ProjectCommand,
  projectCommandCwdSchema,
  projectCommandEnvSchema,
  projectCommandPreviewUrlSchema,
} from "../../../protocol/projects/project-commands.ts";
import { slugifyCommandId } from "./store.ts";

export type DetectFs = {
  readText(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
};

export type DetectFolder = {
  folder_ref: string;
  path: string;
};

const SERVICE_SCRIPT_NAME =
  /^(?:dev|start|serve|watch|preview|server|backend|frontend)(?:[:_-]|$)|(?:[:_-])(?:dev|serve|watch)$/i;

function classifyScript(name: string): {
  kind: CommandKind;
  icon: CommandIcon;
} {
  if (SERVICE_SCRIPT_NAME.test(name)) {
    return { kind: "service", icon: "globe" };
  }
  const lower = name.toLowerCase();
  if (
    lower.includes("test") ||
    lower.includes("spec") ||
    lower.includes("e2e")
  ) {
    return { kind: "action", icon: "test" };
  }
  if (
    lower.includes("lint") ||
    lower.includes("check") ||
    lower.includes("fmt") ||
    lower.includes("format") ||
    lower.includes("type")
  ) {
    return { kind: "action", icon: "lint" };
  }
  if (
    lower.includes("build") ||
    lower.includes("compile") ||
    lower.includes("bundle")
  ) {
    return { kind: "action", icon: "build" };
  }
  if (lower.includes("debug")) {
    return { kind: "action", icon: "debug" };
  }
  return { kind: "action", icon: "terminal" };
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v;
  }
  const parsed = projectCommandEnvSchema.safeParse(out);
  return parsed.success && Object.keys(parsed.data).length > 0
    ? parsed.data
    : undefined;
}

function validCwd(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/^\.\/+/, "");
  if (cleaned === "" || cleaned === ".") return undefined;
  const parsed = projectCommandCwdSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : undefined;
}

function validPreviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = projectCommandPreviewUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(arg)
    ? arg
    : `'${arg.replace(/'/g, "'\\''")}'`;
}

async function detectPackageManager(
  fs: DetectFs,
  dir: string,
): Promise<string> {
  if (await fs.exists(join(dir, "pnpm-lock.yaml"))) return "pnpm run";
  if (await fs.exists(join(dir, "yarn.lock"))) return "yarn";
  if (
    (await fs.exists(join(dir, "bun.lock"))) ||
    (await fs.exists(join(dir, "bun.lockb")))
  ) {
    return "bun run";
  }
  return "npm run";
}

type RawCandidate = {
  name: string;
  command: string;
  kind: CommandKind;
  icon?: CommandIcon;
  description?: string;
  folder_ref?: string;
  cwd?: string;
  env?: Record<string, string>;
  preview_url?: string;
  source: string;
};

async function detectPackageJson(
  fs: DetectFs,
  folder: DetectFolder,
  out: RawCandidate[],
): Promise<void> {
  const text = await fs.readText(join(folder.path, "package.json"));
  if (text === null) return;
  let parsed: { scripts?: unknown };
  try {
    parsed = JSON.parse(text) as { scripts?: unknown };
  } catch {
    return;
  }
  if (
    parsed.scripts === null ||
    typeof parsed.scripts !== "object" ||
    Array.isArray(parsed.scripts)
  ) {
    return;
  }
  const pm = await detectPackageManager(fs, folder.path);
  for (const [scriptName, scriptBody] of Object.entries(parsed.scripts)) {
    if (typeof scriptBody !== "string" || scriptBody.trim() === "") continue;
    const { kind, icon } = classifyScript(scriptName);
    out.push({
      name: scriptName.slice(0, 60),
      command: `${pm} ${shellQuote(scriptName)}`,
      kind,
      icon,
      folder_ref: folder.folder_ref,
      source: "package.json",
    });
  }
}

async function detectMakefile(
  fs: DetectFs,
  folder: DetectFolder,
  out: RawCandidate[],
): Promise<void> {
  const text =
    (await fs.readText(join(folder.path, "Makefile"))) ??
    (await fs.readText(join(folder.path, "makefile")));
  if (text === null) return;
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/.exec(line);
    if (match === null) continue;
    const target = match[1]!;
    if (seen.has(target)) continue;
    seen.add(target);
    const { kind, icon } = classifyScript(target);
    out.push({
      name: target.slice(0, 60),
      command: `make ${shellQuote(target)}`,
      kind,
      icon,
      folder_ref: folder.folder_ref,
      source: "Makefile",
    });
  }
}

async function detectJustfile(
  fs: DetectFs,
  folder: DetectFolder,
  out: RawCandidate[],
): Promise<void> {
  const text =
    (await fs.readText(join(folder.path, "justfile"))) ??
    (await fs.readText(join(folder.path, "Justfile"))) ??
    (await fs.readText(join(folder.path, ".justfile")));
  if (text === null) return;
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+[^:=]*)?:(?!=)/.exec(line);
    if (match === null) continue;
    const recipe = match[1]!;
    if (seen.has(recipe)) continue;
    seen.add(recipe);
    const { kind, icon } = classifyScript(recipe);
    out.push({
      name: recipe.slice(0, 60),
      command: `just ${shellQuote(recipe)}`,
      kind,
      icon,
      folder_ref: folder.folder_ref,
      source: "justfile",
    });
  }
}

async function detectClaudeLaunch(
  fs: DetectFs,
  folder: DetectFolder,
  out: RawCandidate[],
  notes: string[],
): Promise<void> {
  const text = await fs.readText(join(folder.path, ".claude", "launch.json"));
  if (text === null) return;
  let parsed: { configurations?: unknown; autoVerify?: unknown };
  try {
    parsed = JSON.parse(text) as {
      configurations?: unknown;
      autoVerify?: unknown;
    };
  } catch {
    notes.push(".claude/launch.json could not be parsed as JSON.");
    return;
  }
  if (!Array.isArray(parsed.configurations)) return;
  for (const item of parsed.configurations) {
    if (item === null || typeof item !== "object") continue;
    const cfg = item as Record<string, unknown>;
    const name = typeof cfg.name === "string" ? cfg.name.trim() : "";
    const exec =
      typeof cfg.runtimeExecutable === "string"
        ? cfg.runtimeExecutable.trim()
        : "";
    if (name === "" || exec === "") continue;
    const args = Array.isArray(cfg.runtimeArgs)
      ? cfg.runtimeArgs.filter((a): a is string => typeof a === "string")
      : [];
    const command = [shellQuote(exec), ...args.map(shellQuote)].join(" ");
    const port = typeof cfg.port === "number" ? cfg.port : undefined;
    const previewUrl =
      port !== undefined && Number.isInteger(port) && port >= 1 && port <= 65535
        ? `http://localhost:${port}`
        : undefined;
    if (cfg.autoPort === true) {
      notes.push(
        `.claude/launch.json "${name}": autoPort is not supported in lophn and was omitted.`,
      );
    }
    out.push({
      name: name.slice(0, 60),
      command: command.slice(0, 4000),
      kind: "service",
      icon: "globe",
      folder_ref: folder.folder_ref,
      cwd: validCwd(cfg.cwd),
      env: asStringRecord(cfg.env),
      preview_url: validPreviewUrl(previewUrl),
      source: ".claude/launch.json",
    });
  }
}

async function detectCodexEnv(
  fs: DetectFs,
  folder: DetectFolder,
  out: RawCandidate[],
  notes: string[],
): Promise<void> {
  const text = await fs.readText(
    join(folder.path, ".codex", "environments", "environment.toml"),
  );
  if (text === null) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text) as Record<string, unknown>;
  } catch {
    notes.push(
      ".codex/environments/environment.toml could not be parsed as TOML.",
    );
    return;
  }
  if (parsed.setup !== undefined) {
    notes.push(
      ".codex/environments/environment.toml: setup worktree hooks are not imported by lophn.",
    );
  }
  const actions = parsed.actions;
  if (!Array.isArray(actions)) return;
  for (const item of actions) {
    if (item === null || typeof item !== "object") continue;
    const act = item as Record<string, unknown>;
    const name = typeof act.name === "string" ? act.name.trim() : "";
    const command = typeof act.command === "string" ? act.command.trim() : "";
    if (name === "" || command === "") continue;
    const { kind, icon } = classifyScript(name);
    out.push({
      name: name.slice(0, 60),
      command: command.slice(0, 4000),
      kind,
      icon,
      folder_ref: folder.folder_ref,
      source: ".codex/environments/environment.toml",
    });
  }
}

async function detectJsonToolConfig(
  fs: DetectFs,
  folder: DetectFolder,
  file: "paseo.json" | "t3.json" | ".emdash.json",
  out: RawCandidate[],
  notes: string[],
): Promise<void> {
  const text = await fs.readText(join(folder.path, file));
  if (text === null) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    notes.push(`${file} could not be parsed as JSON.`);
    return;
  }
  for (const unsupported of ["worktree", "hooks", "proxy", "ports"]) {
    if (parsed[unsupported] !== undefined) {
      notes.push(
        `${file}: "${unsupported}" is not supported in lophn and was omitted.`,
      );
    }
  }
  const list = parsed.scripts ?? parsed.commands;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item === null || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const command =
        typeof entry.command === "string"
          ? entry.command.trim()
          : typeof entry.run === "string"
            ? entry.run.trim()
            : "";
      if (name === "" || command === "") continue;
      if (entry.runOnWorktreeCreate === true || entry.setup === true) {
        notes.push(
          `${file} "${name}": worktree lifecycle hook flag was omitted.`,
        );
      }
      const classified = classifyScript(name);
      const kind: CommandKind =
        entry.kind === "service" || entry.type === "service"
          ? "service"
          : entry.kind === "action"
            ? "action"
            : classified.kind;
      out.push({
        name: name.slice(0, 60),
        command: command.slice(0, 4000),
        kind,
        icon: kind === "service" ? "globe" : classified.icon,
        folder_ref: folder.folder_ref,
        cwd: validCwd(entry.cwd),
        env: asStringRecord(entry.env),
        preview_url: validPreviewUrl(entry.preview_url ?? entry.url),
        source: file,
      });
    }
  } else if (list !== null && typeof list === "object") {
    for (const [key, value] of Object.entries(
      list as Record<string, unknown>,
    )) {
      if (
        file === ".emdash.json" &&
        ["setup", "teardown", "archive"].includes(key)
      ) {
        notes.push(
          `${file}: "${key}" worktree hook is not supported in lophn and was omitted.`,
        );
        continue;
      }
      if (typeof value === "string" && value.trim() !== "") {
        const { kind, icon } = classifyScript(key);
        out.push({
          name: key.slice(0, 60),
          command: value.trim().slice(0, 4000),
          kind,
          icon,
          folder_ref: folder.folder_ref,
          source: file,
        });
      }
    }
  }
}

export async function detectProjectCommands(deps: {
  fs: DetectFs;
  folders: readonly DetectFolder[];
  existing: readonly ProjectCommand[];
}): Promise<DetectResult> {
  const raw: RawCandidate[] = [];
  const notes: string[] = [];

  for (const folder of deps.folders) {
    await detectPackageJson(deps.fs, folder, raw);
    await detectMakefile(deps.fs, folder, raw);
    await detectJustfile(deps.fs, folder, raw);
    await detectClaudeLaunch(deps.fs, folder, raw, notes);
    await detectCodexEnv(deps.fs, folder, raw, notes);
    await detectJsonToolConfig(deps.fs, folder, "paseo.json", raw, notes);
    await detectJsonToolConfig(deps.fs, folder, "t3.json", raw, notes);
    await detectJsonToolConfig(deps.fs, folder, ".emdash.json", raw, notes);
  }

  const existingNames = new Set(
    deps.existing.map((cmd) => cmd.name.trim().toLowerCase()),
  );
  const existingCommands = new Set(
    deps.existing.map((cmd) => cmd.command.trim()),
  );
  const usedIds = new Set(deps.existing.map((cmd) => cmd.id));
  const seenCandidateKey = new Set<string>();
  const candidates: DetectedCommandCandidate[] = [];

  for (const item of raw) {
    const dedupKey = `${item.folder_ref ?? ""}\0${item.command.trim()}`;
    if (seenCandidateKey.has(dedupKey)) continue;
    seenCandidateKey.add(dedupKey);
    const id = slugifyCommandId(item.name, usedIds);
    usedIds.add(id);
    const alreadyRegistered =
      existingCommands.has(item.command.trim()) ||
      existingNames.has(item.name.trim().toLowerCase());
    candidates.push({
      id,
      name: item.name,
      command: item.command,
      kind: item.kind,
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      ...(item.description === undefined
        ? {}
        : { description: item.description }),
      ...(item.folder_ref === undefined ? {} : { folder_ref: item.folder_ref }),
      ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      ...(item.env === undefined ? {} : { env: item.env }),
      ...(item.preview_url === undefined
        ? {}
        : { preview_url: item.preview_url }),
      source: item.source,
      already_registered: alreadyRegistered,
    });
  }

  return { candidates, unsupported_notes: notes };
}
