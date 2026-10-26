// 사용자 전역(home 기준)에 hook 설정을 놓고, lophn이 전에 놓은 얇은 skill 사본 가운데 지운 skill의 것만 지운다.
// hook은 harness마다 한 번이다. plugin 파일은 우리 파일이라 내용이 다르면 덮는다. 설정 file은 사람이
// 쓴 다른 key·다른 hook을 보존하고 우리 항목(command가 `lophn hook <harness> `나 개발 경로의 `<절대 경로> hook <harness> `로 시작)만 바꾼다.
// 놓을 hook 위치와 꼴은 `HARNESS_HOOKS`, 듣는 event는 `HOOK_EVENT_TABLE`의 key다.
import { parse as parseToml } from "@std/toml";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  HARNESS_ADAPTERS,
  HARNESS_HOOKS,
  type HarnessHook,
  type HarnessId,
  HOOK_EVENT_TABLE,
  TERMINAL_HOOK_ENV,
} from "../../protocol/coding-agent/mod.ts";
import { codexHookHash, codexHookKey } from "./codex-trust.ts";
import { hermesHooksText, kimiHooksText } from "./block-hooks.ts";
import { jsoncHooksText } from "./jsonc-hooks.ts";
import { jsonHooksText } from "./json-hooks.ts";
import { placedPluginCommand, pluginSource } from "./hook-bodies.ts";
import {
  editFiles,
  type InstallPorts,
  isObject,
  type Json,
  type Outcome,
  ownedCommand,
  placedCommand,
  sameJson,
  type Step,
} from "./install-common.ts";

export type { InstallPorts } from "./install-common.ts";

// lophn이 전에 사람 home에 skill 사본을 놓았던 이름 가운데 지운 것이다. 이름을 패턴이나 목록 읽기로 고르지 않는다.
const RETIRED_SKILL_NAMES = ["lophn-build-app", "lophn-repair"] as const;

type InstallResult = { skill: Outcome; hook: Outcome; files: string[] };

// 사람의 설정과 부딪쳐 놓지 않은 이유다. 있으면 결과 대신 오류로 사람에게 보인다.
type HookStep = Step & { conflict?: string };

// lophn이 쓰던 얇은 사본의 본문이다(frontmatter 뒤).
function thinBody(name: string): string {
  return `
# ${name}

절차는 \`lophn guide ${name}\`이 내준다. 그 출력을 따른다.
`;
}

// 지운 skill의 옛 사본 가운데 lophn이 쓴 꼴 그대로인 것만 지운다. 사람이 고쳤거나 다른 file이 더 든 폴더는 둔다.
async function removeRetiredSkills(
  ports: InstallPorts,
  home: string,
  skillDir: string,
  dryRun: boolean,
): Promise<Step> {
  const files: string[] = [];
  for (const name of RETIRED_SKILL_NAMES) {
    const folder = `${home}/${skillDir}/${name}`;
    const file = `${folder}/SKILL.md`;
    const names = await ports.list(folder);
    if (names === null || names.length !== 1 || names[0] !== "SKILL.md") {
      continue;
    }
    const text = await ports.read(file);
    const front = text?.match(/^---\n[\s\S]*?\n---\n/)?.[0];
    if (
      text === null || front === undefined ||
      !front.startsWith(`---\nname: ${name}\n`) ||
      text.slice(front.length) !== thinBody(name)
    ) continue;
    if (!dryRun) {
      await ports.remove(file);
      await ports.remove(folder);
    }
    files.push(file);
  }
  return {
    outcome: files.length === 0
      ? "unchanged"
      : dryRun
      ? "missing"
      : "installed",
    files,
  };
}

// Codex는 새·바뀐 hook을 사람이 /hooks에서 trust하기 전까지 건너뛴다. trust 기록은 hooks.json과 같은 폴더의
// config.toml에 있어서, 우리 hook마다 `[hooks.state."<key>"] trusted_hash`를 대신 쓴다. 기록은 hooks.json을 쓴 뒤의
// 실제 group·handler 위치(key)와 그 handler의 hash로 만든다. 다른 도구의 기록은 건드리지 않는다.
const CODEX_CONFIG_PATH = ".codex/config.toml";

type Trust = { key: string; hash: string };

async function codexTrustOf(
  hooksFile: string,
  hooksText: string,
): Promise<Trust[]> {
  const hooks = (JSON.parse(hooksText) as Json).hooks;
  if (!isObject(hooks)) return [];
  const trusts: Trust[] = [];
  for (const event of Object.keys(HOOK_EVENT_TABLE.codex)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [];
    for (const [groupIndex, group] of groups.entries()) {
      const handlers = (group as { hooks?: unknown } | null)?.hooks;
      if (!Array.isArray(handlers)) continue;
      for (const [handlerIndex, handler] of handlers.entries()) {
        if (!ownedCommand("codex", (handler as Json | null)?.command)) continue;
        trusts.push({
          key: codexHookKey(hooksFile, event, groupIndex, handlerIndex),
          hash: await codexHookHash(event, group as Json, handler),
        });
      }
    }
  }
  return trusts;
}

// config.toml에서 우리 table만 바꾼다. 있으면 `trusted_hash` 줄만 고치고 없으면 끝에 붙여, 나머지 byte는 그대로다.
function withTrust(text: string, trusts: Trust[]): string {
  let out = text;
  for (const { key, hash } of trusts) {
    const header = `[hooks.state.${JSON.stringify(key)}]`;
    const line = `trusted_hash = ${JSON.stringify(hash)}`;
    const lines = out.split("\n");
    const at = lines.findIndex((one) => {
      const rest = one.trim();
      return rest === header ||
        rest.startsWith(header) &&
          rest.slice(header.length).trimStart().startsWith("#");
    });
    if (at === -1) {
      const gap = out === "" ? "" : out.endsWith("\n") ? "\n" : "\n\n";
      out = `${out}${gap}${header}\n${line}\n`;
      continue;
    }
    let end = at + 1;
    while (end < lines.length && !lines[end].trim().startsWith("[")) end++;
    const own = lines.findIndex((one, index) =>
      index > at && index < end && /^\s*trusted_hash\s*=/.test(one)
    );
    if (own === -1) lines.splice(at + 1, 0, line);
    else lines[own] = line;
    out = lines.join("\n");
  }
  return out;
}

function trustedHashes(text: string | null): Json | null {
  if (text === null) return {};
  try {
    const hooks = parseToml(text).hooks;
    const state = isObject(hooks) ? hooks.state : undefined;
    return isObject(state) ? state : {};
  } catch {
    return null;
  }
}

// Muse는 hook을 지운 env로 돌려서 inline hook은 `LPN_TERMINAL_HOOK`을 잃는다. settings.json의 `managed_hooks_path`가
// 가리키는 파일에 hook을 두고 `managed_hooks_env_vars`에 그 env 이름을 허용한다. 사람의 다른 설정과 이미 있는 env 이름은
// 그대로 두고, 사람이 이미 다른 managed 파일을 쓰고 있으면 덮지 않는다.
function museSettingsText(text: string | null, managed: string): string | null {
  let doc: Json = { schema_version: 1 };
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) return null;
      doc = parsed;
    } catch {
      return null;
    }
  }
  const names = doc.managed_hooks_env_vars ?? [];
  if (!Array.isArray(names)) return null;
  const next = {
    ...doc,
    managed_hooks_path: managed,
    managed_hooks_env_vars: names.includes(TERMINAL_HOOK_ENV)
      ? names
      : [...names, TERMINAL_HOOK_ENV],
  };
  if (text !== null && sameJson(doc, next)) return text;
  return `${
    JSON.stringify(next, null, text?.match(/\n(\t| {2,})"/)?.[1] ?? 2)
  }\n`;
}

// Hermes shell hook은 (event, command)마다 사람이 처음 쓸 때 TTY에서 승인해야 하고, 승인은 allowlist에 남는다.
// 우리 (event, command)를 미리 적어 두고 다른 승인은 그대로 둔다. 우리 command의 옛 승인(경로가 바뀐 것)은 지운다.
function allowlistText(
  text: string | null,
  input: {
    events: readonly string[];
    command(event: string): string;
    now: string;
  },
): string | null {
  let doc: Json = {};
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) return null;
      doc = parsed;
    } catch {
      return null;
    }
  }
  if (doc.approvals !== undefined && !Array.isArray(doc.approvals)) return null;
  const wanted = (entry: unknown) =>
    isObject(entry) &&
    input.events.some((event) =>
      entry.event === event && entry.command === input.command(event)
    );
  const kept = ((doc.approvals as unknown[] | undefined) ?? []).filter((one) =>
    wanted(one) ||
    !(isObject(one) && ownedCommand("hermes", one.command))
  );
  const added = input.events.filter((event) =>
    !kept.some((one) =>
      isObject(one) && one.event === event &&
      one.command === input.command(event)
    )
  ).map((event) => ({
    event,
    command: input.command(event),
    approved_at: input.now,
    script_mtime_at_approval: null,
  }));
  if (
    added.length === 0 &&
    kept.length === (doc.approvals as unknown[] | undefined)?.length
  ) {
    return text;
  }
  doc.approvals = [...kept, ...added];
  return `${
    JSON.stringify(doc, null, text?.match(/\n(\t| {2,})"/)?.[1] ?? 2)
  }\n`;
}

// Cline은 event마다 script file 하나를 읽고, 이름이 event다. 인자를 못 받아 event 이름을 script에 박는다.
const CLINE_OWNED = /^#!\/bin\/sh\nexec "[^"\n]*" hook cline \w+\n$/;

function clineScript(command: string, event: string): string {
  return `#!/bin/sh\nexec "${command}" hook cline ${event}\n`;
}

async function installHook(
  ports: InstallPorts,
  input: {
    harness: HarnessId;
    home: string;
    dryRun: boolean;
    command?: string;
    now: string;
  },
  spec: HarnessHook,
): Promise<HookStep> {
  const { harness, home, dryRun } = input;
  const events = Object.keys(HOOK_EVENT_TABLE[harness]);
  const at = (path: string) => `${home}/${path}`;
  // 넘긴 command(개발 경로)가 없으면 놓을 때는 PATH의 `lophn`이고, dry_run은 놓인 command를 그대로 쓴다(command만 다른 것은
  // 놓을 것으로 보지 않는다).
  const commandOf = (placed: string | undefined) =>
    input.command ?? (dryRun ? placed : undefined) ?? "lophn";
  const commandIn = (text: string | null) =>
    commandOf(placedCommand(harness, text));
  const lineOf = (command: string) => (event: string) =>
    `${command} hook ${harness} ${event}`;

  switch (spec.format) {
    case "json": {
      const make = (text: string | null) =>
        jsonHooksText(text, {
          harness,
          hook: spec,
          events,
          command: commandIn(text),
        });
      if (harness !== "codex") {
        return await editFiles(ports, [{ path: at(spec.path), make }], dryRun);
      }
      const hooksText = await ports.read(at(spec.path));
      const nextHooks = make(hooksText);
      if (nextHooks === null) return { outcome: "failed", files: [] };
      const trusts = await codexTrustOf(at(spec.path), nextHooks);
      return await editFiles(ports, [
        { path: at(spec.path), make: () => nextHooks },
        {
          path: at(CODEX_CONFIG_PATH),
          make: (text) => {
            const state = trustedHashes(text);
            if (state === null) return null;
            const stale = trusts.filter(({ key, hash }) =>
              (state[key] as { trusted_hash?: unknown } | undefined)
                ?.trusted_hash !== hash
            );
            const next = withTrust(text ?? "", stale);
            try {
              parseToml(next);
            } catch {
              return null;
            }
            return next;
          },
        },
      ], dryRun);
    }
    case "jsonc":
      return await editFiles(ports, [{
        path: at(spec.path),
        make: (text) => {
          const line = lineOf(commandIn(text));
          return jsoncHooksText(text, {
            harness,
            events,
            ours: (event) => ({
              hooks: [{ type: "command", command: line(event) }],
            }),
          });
        },
      }], dryRun);
    case "toml_block":
      return await editFiles(ports, [{
        path: at(spec.path),
        make: (text) =>
          kimiHooksText(text, {
            events,
            command: lineOf(commandIn(text)),
            timeout: spec.timeout,
            matchers: spec.matchers,
          }),
      }], dryRun);
    case "managed_json": {
      const settings = at(spec.settings);
      const current = await ports.read(settings);
      const managed = museManaged(current);
      // 사람이 이미 다른 managed hook 파일을 쓰고 있으면 가리키는 곳을 바꾸지 않는다.
      if (managed !== undefined && managed !== at(spec.path)) {
        return {
          outcome: "failed",
          files: [],
          conflict:
            `Muse가 이미 다른 managed hook 파일(${managed})을 쓰고 있어 놓지 않았다`,
        };
      }
      return await editFiles(ports, [
        {
          path: at(spec.path),
          make: (text) =>
            jsonHooksText(text, {
              harness,
              hook: {
                format: "json",
                path: spec.path,
                shape: "nested",
                timeout: spec.timeout,
              },
              events,
              command: commandIn(text),
            }),
        },
        {
          path: settings,
          make: (text) => museSettingsText(text, at(spec.path)),
        },
      ], dryRun);
    }
    case "yaml_hooks": {
      const yaml = await ports.read(at(spec.path));
      const line = lineOf(commandIn(yaml));
      return await editFiles(ports, [
        {
          path: at(spec.path),
          make: (text) =>
            hermesHooksText(text, {
              events,
              command: line,
              timeout: spec.timeout,
            }),
        },
        {
          path: at(spec.allowlist),
          make: (text) =>
            allowlistText(text, { events, command: line, now: input.now }),
        },
      ], dryRun);
    }
    case "script_dir":
      return await editFiles(
        ports,
        events.map((event) => ({
          path: `${at(spec.path)}/${event}`,
          executable: true,
          // 사람이 같은 이름으로 쓴 script는 덮지 않는다.
          make: (text: string | null) => {
            if (text !== null && !CLINE_OWNED.test(text)) return null;
            const placed = text?.match(/^exec "([^"\n]*)" hook cline /m)?.[1];
            return clineScript(commandOf(placed), event);
          },
        })),
        dryRun,
      );
    case "plugin_file": {
      return await editFiles(ports, [{
        path: at(spec.path),
        make: (text) =>
          pluginSource(
            harness,
            input.command ??
              (dryRun ? placedPluginCommand(text) : undefined) ?? "lophn",
          ),
      }], dryRun);
    }
  }
}

function museManaged(text: string | null): unknown {
  try {
    return text === null ? undefined : JSON.parse(text).managed_hooks_path;
  } catch {
    return undefined;
  }
}

export async function installGlobal(
  ports: InstallPorts,
  input: {
    harness: HarnessId;
    home: string;
    dryRun: boolean;
    // 개발 실행의 hook command(절대 경로). 없으면 PATH의 `lophn`이다.
    command?: string;
    // 시각이다(ISO). Hermes 승인 기록의 `approved_at`에 쓴다.
    now: string;
  },
): Promise<Result<InstallResult, LophnError>> {
  const adapter = HARNESS_ADAPTERS[input.harness];
  const home = input.home.replace(/\/+$/, "");
  const none: Step = { outcome: "not_supported", files: [] };
  try {
    const skill = adapter.skill_dir === null
      ? none
      : await removeRetiredSkills(ports, home, adapter.skill_dir, input.dryRun);
    const spec = HARNESS_HOOKS[input.harness];
    const hook: HookStep = spec === null
      ? none
      : await installHook(ports, { ...input, home }, spec);
    if (hook.conflict !== undefined) {
      return err({ code: "conflict", message: hook.conflict });
    }
    return ok({
      skill: skill.outcome,
      hook: hook.outcome,
      files: [...skill.files, ...hook.files],
    });
  } catch {
    return err({
      code: "unavailable",
      message: "harness 전역 설정에 쓰지 못했다",
    });
  }
}
