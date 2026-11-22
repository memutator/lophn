// 사용자 전역(home 기준)에서 lophn hook을 지운다. 놓기(`install.ts`)의 거꾸로다. 우리 항목(command가 `lophn hook <harness> `나
// 개발 경로로 시작), 우리 표시 block, 우리 이름의 file만 지우고 사람이 쓴 key·hook·주석은 그대로 둔다.
// 고칠 file을 모두 계산한 뒤 하나라도 못 만들면 아무것도 쓰지 않고 `failed`다.
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  HARNESS_ADAPTERS,
  type HARNESS_UNINSTALL_OUTCOMES,
  type HarnessHook,
  type HarnessId,
  TERMINAL_HOOK_ENV,
} from "../../protocol/coding-agent/mod.ts";
import { hermesHooksWithout, kimiHooksWithout } from "./block-hooks.ts";
import { codexHookKey } from "./codex-trust.ts";
import {
  CLINE_OWNED,
  CLINE_WIN_OWNED,
  CODEX_CONFIG_PATH,
  trustedHashes,
} from "./install.ts";
import {
  type InstallPorts,
  isObject,
  isWindowsHome,
  joinHome,
  type Json,
  ownedCommand,
  trimHome,
  unchangedSinceRead,
} from "./install-common.ts";
import { jsoncHooksWithout } from "./jsonc-hooks.ts";
import { type JsonHook, jsonHooksWithout, withoutOwned } from "./json-hooks.ts";

type UninstallOutcome = (typeof HARNESS_UNINSTALL_OUTCOMES)[number];
type UninstallStep = { outcome: UninstallOutcome; files: string[] };

// file째 지운다는 표시다.
const REMOVE = Symbol("remove");
type Change = string | null | typeof REMOVE;
type Job = { path: string; make(text: string): Change };

// 없는 file은 지울 것이 없다. null을 만든 job이 하나라도 있으면 아무것도 쓰지 않는다.
// 쓰기 직전에 file이 바뀌었으면 읽기부터 한 번 다시 하고, 두 번째도 바뀌었으면 아무것도 쓰지 않고 `failed`다.
async function changeFiles(
  ports: InstallPorts,
  jobs: readonly Job[],
): Promise<UninstallStep> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const planned: {
      path: string;
      text: string;
      next: string | typeof REMOVE;
    }[] = [];
    for (const job of jobs) {
      const text = await ports.read(job.path);
      if (text === null) continue;
      const next = job.make(text);
      if (next === null) return { outcome: "failed", files: [] };
      if (next !== text) planned.push({ path: job.path, text, next });
    }
    if (planned.length === 0) return { outcome: "unchanged", files: [] };
    if (!(await unchangedSinceRead(ports, planned))) continue;
    for (const one of planned) {
      if (one.next === REMOVE) await ports.remove(one.path);
      else await ports.write(one.path, one.next);
    }
    return { outcome: "removed", files: planned.map((one) => one.path) };
  }
  return { outcome: "failed", files: [] };
}

// 놓을 때 우리가 만든 file은 우리 것을 지우면 빈다. 빈 file은 남기지 않는다.
function orRemove(text: string, next: string | null): Change {
  return next !== null && next !== text && next.trim() === "" ? REMOVE : next;
}

function indentOf(text: string): string | number {
  return text.match(/\n(\t| {2,})"/)?.[1] ?? 2;
}

// 우리 이름의 file(`lophn.json`, `lophn-hooks.json`)이다. 사람의 항목이 남지 않으면 file째 지운다. 다른 file도 `{}`만
// 남으면 지운다.
function dedicated(path: string): boolean {
  return /[\\/]lophn[^\\/]*$/.test(path);
}

function emptyHooksDoc(text: string): boolean {
  const doc = JSON.parse(text) as Json;
  const hooks = doc.hooks;
  return (
    Object.keys(doc).every((key) => key === "version" || key === "hooks") &&
    (hooks === undefined ||
      (Array.isArray(hooks)
        ? hooks.length === 0
        : isObject(hooks) && Object.keys(hooks).length === 0))
  );
}

function jsonJob(harness: HarnessId, path: string, hook: JsonHook): Job {
  return {
    path,
    make(text) {
      const next = jsonHooksWithout(text, { harness, hook });
      if (next === null || next === text) return next;
      return next.trim() === "{}" || (dedicated(path) && emptyHooksDoc(next))
        ? REMOVE
        : next;
    },
  };
}

type TrustChange = { drop: Set<string>; rename: Map<string, string> };

// Codex trust 기록의 key는 hook의 group·handler 위치다. 우리 handler를 빼면 그 기록은 지우고, 뒤에 있던 사람 handler는
// 당겨져 key가 바뀐다. Codex는 key가 바뀐 hook을 새 hook으로 보고 다시 trust하라고 하므로 그 기록은 새 key로 옮긴다.
// group을 남기는 규칙은 `withoutOwned`와 같다.
function codexTrustChange(file: string, text: string): TrustChange {
  const change: TrustChange = { drop: new Set(), rename: new Map() };
  const hooks = (JSON.parse(text) as Json).hooks;
  if (!isObject(hooks)) return change;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    let groupAt = 0;
    for (const [groupIndex, group] of groups.entries()) {
      const handlers =
        isObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
      let handlerAt = 0;
      for (const [handlerIndex, handler] of handlers.entries()) {
        const key = codexHookKey(file, event, groupIndex, handlerIndex);
        if (isObject(handler) && ownedCommand("codex", handler.command)) {
          change.drop.add(key);
          continue;
        }
        const moved = codexHookKey(file, event, groupAt, handlerAt);
        if (moved !== key) change.rename.set(key, moved);
        handlerAt++;
      }
      if (withoutOwned("codex", group) !== undefined) groupAt++;
    }
  }
  return change;
}

// `[hooks.state."<key>"]` 머리 줄의 key와 따옴표 친 글이다.
function trustHeader(
  line: string,
): { key: string; quoted: string } | undefined {
  const found = line
    .trim()
    .match(/^\[hooks\.state\.("(?:[^"\\]|\\.)*")\]\s*(?:#.*)?$/);
  if (found === null) return undefined;
  try {
    return { key: JSON.parse(found[1]) as string, quoted: found[1] };
  } catch {
    return undefined;
  }
}

// config.toml에서 우리 trust table을 줄째 지우고, 당겨진 사람 table은 머리 줄의 key만 바꾼다. 나머지 byte는 그대로다.
function withoutTrust(text: string, change: TrustChange): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let at = 0; at < lines.length; at++) {
    const header = trustHeader(lines[at]);
    if (header !== undefined && change.drop.has(header.key)) {
      let end = at + 1;
      while (end < lines.length && !lines[end].trim().startsWith("[")) end++;
      if (end === lines.length) {
        // file 끝까지면 마지막 줄바꿈은 남기고, 놓을 때 table 앞에 띄운 빈 줄을 지운다.
        if (lines.at(-1) === "") end--;
        if (out.at(-1) === "") out.pop();
      } else {
        // 다음 table 앞의 주석은 그 table의 것이다.
        while (end > at + 1 && lines[end - 1].trim().startsWith("#")) end--;
      }
      at = end - 1;
      continue;
    }
    const moved =
      header === undefined ? undefined : change.rename.get(header.key);
    out.push(
      header === undefined || moved === undefined
        ? lines[at]
        : lines[at].replace(header.quoted, JSON.stringify(moved)),
    );
  }
  return out.join("\n");
}

// 우리 managed file을 가리키는 Muse 설정만 되돌린다. 다른 file을 가리키면 사람의 설정이라 그대로 둔다.
function museSettingsWithout(text: string, managed: string): string | null {
  let doc: Json;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) return null;
    doc = parsed;
  } catch {
    return null;
  }
  if (doc.managed_hooks_path !== managed) return text;
  delete doc.managed_hooks_path;
  const names = doc.managed_hooks_env_vars;
  if (Array.isArray(names)) {
    const kept = names.filter((name) => name !== TERMINAL_HOOK_ENV);
    if (kept.length === 0) delete doc.managed_hooks_env_vars;
    else doc.managed_hooks_env_vars = kept;
  }
  return `${JSON.stringify(doc, null, indentOf(text))}\n`;
}

// Hermes allowlist에서 우리 command의 승인만 지운다.
function allowlistWithout(text: string): string | null {
  let doc: Json;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) return null;
    doc = parsed;
  } catch {
    return null;
  }
  if (doc.approvals === undefined) return text;
  if (!Array.isArray(doc.approvals)) return null;
  const kept = doc.approvals.filter(
    (one) => !(isObject(one) && ownedCommand("hermes", one.command)),
  );
  if (kept.length === doc.approvals.length) return text;
  doc.approvals = kept;
  return `${JSON.stringify(doc, null, indentOf(text))}\n`;
}

async function uninstallHook(
  ports: InstallPorts,
  input: { harness: HarnessId; home: string },
  spec: HarnessHook,
): Promise<UninstallStep> {
  const { harness, home } = input;
  const win = isWindowsHome(home);
  const at = (path: string) => joinHome(home, path);
  switch (spec.format) {
    case "json": {
      const hooksPath = at(spec.path);
      if (harness !== "codex") {
        return await changeFiles(ports, [jsonJob(harness, hooksPath, spec)]);
      }
      const hooksText = await ports.read(hooksPath);
      let change: TrustChange = { drop: new Set(), rename: new Map() };
      if (hooksText !== null) {
        try {
          change = codexTrustChange(hooksPath, hooksText);
        } catch {
          return { outcome: "failed", files: [] };
        }
      }
      const hooksJob = jsonJob(harness, hooksPath, spec);
      return await changeFiles(ports, [
        // trust 변경을 계산한 본문과 달라졌으면 그 key가 맞지 않으므로 고치지 않는다.
        {
          path: hooksPath,
          make: (text) => (text === hooksText ? hooksJob.make(text) : null),
        },
        {
          path: at(CODEX_CONFIG_PATH),
          make(text) {
            const next = withoutTrust(text, change);
            if (next === text) return text;
            return trustedHashes(next) === null ? null : orRemove(text, next);
          },
        },
      ]);
    }
    case "jsonc":
      return await changeFiles(ports, [
        {
          path: at(spec.path),
          make(text) {
            const next = jsoncHooksWithout(text, harness);
            // 우리가 만든 file이면 `{}`만 남는다. 주석이 남으면 사람의 것이라 둔다.
            return next !== null &&
              next !== text &&
              next.replace(/\s/g, "") === "{}"
              ? REMOVE
              : next;
          },
        },
      ]);
    case "toml_block":
      return await changeFiles(ports, [
        {
          path: at(spec.path),
          make: (text) => orRemove(text, kimiHooksWithout(text)),
        },
      ]);
    case "managed_json": {
      const managed = at(spec.path);
      return await changeFiles(ports, [
        {
          path: at(spec.settings),
          make: (text) => museSettingsWithout(text, managed),
        },
        jsonJob(harness, managed, {
          format: "json",
          path: spec.path,
          shape: "nested",
          timeout: spec.timeout,
        }),
      ]);
    }
    case "yaml_hooks":
      return await changeFiles(ports, [
        {
          path: at(spec.path),
          make: (text) => orRemove(text, hermesHooksWithout(text)),
        },
        { path: at(spec.allowlist), make: allowlistWithout },
      ]);
    case "script_dir": {
      const dir = at(spec.path);
      const owned = win ? CLINE_WIN_OWNED : CLINE_OWNED;
      const step = await changeFiles(
        ports,
        Object.keys(HARNESS_ADAPTERS[harness].events).map((event) => ({
          path: joinHome(home, `${spec.path}/${win ? `${event}.ps1` : event}`),
          // 사람이 같은 이름으로 쓴 script는 남긴다.
          make: (text: string) => (owned.test(text) ? REMOVE : text),
        })),
      );
      if (step.outcome === "removed" && (await ports.list(dir))?.length === 0) {
        await ports.remove(dir);
      }
      return step;
    }
    case "plugin_file":
      // 이 이름의 file은 우리 것이라 놓을 때도 본문이 다르면 덮는다.
      return await changeFiles(ports, [
        { path: at(spec.path), make: () => REMOVE },
      ]);
  }
}

export async function uninstallGlobal(
  ports: InstallPorts,
  input: { harness: HarnessId; home: string },
): Promise<Result<{ hook: UninstallOutcome; files: string[] }, LophnError>> {
  const spec = HARNESS_ADAPTERS[input.harness].hook;
  if (spec === null) return ok({ hook: "not_supported", files: [] });
  try {
    const step = await uninstallHook(
      ports,
      { harness: input.harness, home: trimHome(input.home) },
      spec,
    );
    return ok({ hook: step.outcome, files: step.files });
  } catch {
    return err({
      code: "unavailable",
      message: "harness 전역 설정을 고치지 못했다",
    });
  }
}
