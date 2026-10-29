// JSON 설정에 `lophn hook <harness> <event>` 항목을 event마다 하나씩 넣는다. 사람이 쓴 다른 key·hook·indent는
// 그대로 두고 우리 항목(command가 `lophn hook <harness> `나 개발 경로로 시작)만 제자리에서 바꾼다.
// 파싱되지 않거나 모양이 틀리면 null이다(쓰지 않고 `failed`).
import type {
  HarnessHook,
  HarnessId,
} from "../../protocol/coding-agent/mod.ts";
import {
  isObject,
  type Json,
  ownedCommand,
  sameJson,
} from "./install-common.ts";

export type JsonHook = Extract<HarnessHook, { format: "json" }>;

// 한 항목이 가진 command들이다(shape마다 칸이 다르다).
function commandsOf(entry: unknown): unknown[] {
  if (!isObject(entry)) return [];
  const own = [entry.command, entry.bash];
  if (isObject(entry.action)) own.push(entry.action.command);
  if (Array.isArray(entry.hooks)) {
    for (const handler of entry.hooks) {
      if (isObject(handler)) own.push(handler.command);
    }
  }
  return own;
}

export function ownedEntry(harness: HarnessId, entry: unknown): boolean {
  return commandsOf(entry).some((command) => ownedCommand(harness, command));
}

function handlerOf(
  hook: JsonHook,
  harness: HarnessId,
  event: string,
  command: string,
): Json {
  const line = `${command} hook ${harness} ${event}`;
  if (hook.shape === "copilot") {
    return {
      type: "command",
      bash: line,
      ...(hook.timeout === undefined ? {} : { timeoutSec: hook.timeout }),
    };
  }
  return {
    type: "command",
    command: line,
    ...(hook.timeout === undefined ? {} : { timeout: hook.timeout }),
  };
}

// event 하나에 놓을 항목이다.
function entryOf(
  hook: JsonHook,
  harness: HarnessId,
  event: string,
  command: string,
): Json {
  const handler = handlerOf(hook, harness, event, command);
  const matcher = hook.matchers?.[event];
  if (hook.shape === "flat" || hook.shape === "copilot") return handler;
  if (hook.shape === "kiro") {
    return {
      name: `lophn-${event}`,
      trigger: event,
      action: { type: "command", command: handler.command },
      timeout: hook.timeout,
    };
  }
  return {
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [handler],
  };
}

// 우리 항목은 첫 것을 제자리에서 바꾸고 나머지는 지운다. 없으면 끝에 붙인다.
function mergeOwned(
  list: readonly unknown[],
  owned: (entry: unknown) => boolean,
  ours: Json,
): unknown[] {
  const at = list.findIndex(owned);
  if (at === -1) return [...list, ours];
  return list.flatMap((entry, index) =>
    index === at ? [ours] : owned(entry) ? [] : [entry],
  );
}

function indentOf(text: string | null): string {
  return text?.match(/\n(\t| {2,})"/)?.[1] ?? "  ";
}

export function jsonHooksText(
  text: string | null,
  input: {
    harness: HarnessId;
    hook: JsonHook;
    events: readonly string[];
    command: string;
  },
): string | null {
  const { harness, hook, events, command } = input;
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
  const before = structuredClone(doc);
  const owned = (entry: unknown) => ownedEntry(harness, entry);
  const ours = (event: string) => entryOf(hook, harness, event, command);

  if (hook.shape === "named") {
    // 이름 key 하나가 통째로 우리 것이다. PreToolUse·PostToolUse만 matcher group이고 나머지는 handler 목록이다.
    doc.lophn = Object.fromEntries(
      events.map((event) => {
        const handler = handlerOf(hook, harness, event, command);
        const matcher = hook.matchers?.[event];
        return [
          event,
          event === "PreToolUse" || event === "PostToolUse"
            ? [
                {
                  ...(matcher === undefined ? {} : { matcher }),
                  hooks: [handler],
                },
              ]
            : [handler],
        ];
      }),
    );
  } else if (hook.shape === "kiro") {
    if (doc.version === undefined) doc.version = "v1";
    if (doc.hooks !== undefined && !Array.isArray(doc.hooks)) return null;
    // 표에서 빠진 event의 옛 항목은 지운다.
    let list = ((doc.hooks as unknown[] | undefined) ?? []).filter(
      (entry) =>
        !owned(entry) ||
        events.includes((entry as { trigger?: string }).trigger ?? ""),
    );
    for (const event of events) {
      list = mergeOwned(
        list,
        (entry) =>
          owned(entry) && (entry as { trigger?: string }).trigger === event,
        ours(event),
      );
    }
    doc.hooks = list;
  } else {
    if (hook.shape !== "nested" && doc.version === undefined) doc.version = 1;
    if (doc.hooks !== undefined && !isObject(doc.hooks)) return null;
    const hooks: Json = doc.hooks ?? {};
    for (const event of events) {
      if (hooks[event] !== undefined && !Array.isArray(hooks[event])) {
        return null;
      }
      hooks[event] = mergeOwned(
        (hooks[event] as unknown[] | undefined) ?? [],
        owned,
        ours(event),
      );
    }
    doc.hooks = hooks;
  }
  if (text !== null && sameJson(before, doc)) return text;
  return `${JSON.stringify(doc, null, indentOf(text))}\n`;
}

// 항목에서 우리 handler만 뺀 것이다. 남는 것이 없으면 undefined, 우리 것이 없으면 그 항목 그대로다.
// 사람이 우리 group에 자기 handler를 더했어도 그 handler는 남긴다.
export function withoutOwned(harness: HarnessId, entry: unknown): unknown {
  if (isObject(entry) && Array.isArray(entry.hooks)) {
    const kept = entry.hooks.filter(
      (handler) =>
        !(isObject(handler) && ownedCommand(harness, handler.command)),
    );
    if (kept.length === entry.hooks.length) return entry;
    return kept.length === 0 ? undefined : { ...entry, hooks: kept };
  }
  return ownedEntry(harness, entry) ? undefined : entry;
}

// 우리 항목을 지운 본문이다. 우리 것만 남았던 event key와 그래서 빈 `hooks`도 지운다. 지울 것이 없으면 text 그대로다.
export function jsonHooksWithout(
  text: string,
  input: { harness: HarnessId; hook: JsonHook },
): string | null {
  const { harness, hook } = input;
  let doc: Json;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) return null;
    doc = parsed;
  } catch {
    return null;
  }
  const before = structuredClone(doc);
  if (hook.shape === "named") {
    delete doc.lophn;
  } else if (hook.shape === "kiro") {
    if (doc.hooks !== undefined && !Array.isArray(doc.hooks)) return null;
    if (Array.isArray(doc.hooks)) {
      doc.hooks = doc.hooks.filter((entry) => !ownedEntry(harness, entry));
    }
  } else {
    if (doc.hooks !== undefined && !isObject(doc.hooks)) return null;
    const hooks = doc.hooks;
    if (isObject(hooks)) {
      for (const [event, list] of Object.entries(hooks)) {
        if (!Array.isArray(list)) continue;
        const kept = list.flatMap((entry) => {
          const left = withoutOwned(harness, entry);
          return left === undefined ? [] : [left];
        });
        if (
          kept.length === list.length &&
          kept.every((one, i) => one === list[i])
        ) {
          continue;
        }
        if (kept.length === 0) delete hooks[event];
        else hooks[event] = kept;
      }
      if (Object.keys(hooks).length === 0 && !sameJson(before, doc)) {
        delete doc.hooks;
      }
    }
  }
  if (sameJson(before, doc)) return text;
  return `${JSON.stringify(doc, null, indentOf(text))}\n`;
}
