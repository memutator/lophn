// `lophn settings get|set|unset`: lophn의 설정을 읽고 바꾼다. 설정마다 명령을 두지 않는다. 설정의 뜻과 고를 수 있는 값은
// core의 선언에서 오고(`settings/list`), theme처럼 항목마다 file 하나인 설정 묶음도 `<묶음 key>.<id>`로 같은 명령을 쓴다.
// 사람만 바꾸는 설정(locked)은 여기서 바꾸지 못한다. agent는 route가, 사람의 터미널은 이 명령이 막는다(둘 다 user token이 아닌
// 선언의 locked를 본다). 사람의 허락이 드는 설정(approval)은 agent turn에서 부르면 core가 그 tool call에 승인 카드를 열고
// 사람이 허락한 그 한 번만 쓴다. 명령은 tool call id를 싣기만 한다. 사람의 터미널은 바로 쓴다.
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  SETTING_ENTRY_ID,
  type SettingEntry,
  type SettingFolder,
  settingsList,
  settingsUpdate,
} from "../../protocol/config/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { type CommandContext, defineCommand } from "./types.ts";

const keySchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

type Listed = { settings: SettingEntry[]; folders: SettingFolder[] };

const valueOf = (entry: SettingEntry): unknown =>
  entry.chosen !== undefined ? entry.chosen : entry.default;

// 목록에서는 설명의 첫 문장만 보인다. 전체는 key를 주면 나온다.
function firstSentence(text: string): string {
  const end = text.search(/\. /);
  return end === -1 ? text : text.slice(0, end + 1);
}

const patternOf = (folder: SettingFolder) => `${folder.key}.<id>`;

function indexOf(listed: Listed): Record<string, unknown>[] {
  return [
    ...listed.settings.map((entry) => ({
      key: entry.key,
      value: valueOf(entry),
      ...(entry.locked === true ? { locked: true } : {}),
      ...(entry.approval === undefined ? {} : { approval: entry.approval }),
      description: firstSentence(entry.description),
    })),
    ...listed.folders.map((folder) => ({
      key: patternOf(folder),
      entries: folder.entries.map((entry) => entry.id),
      ...(folder.locked === true ? { locked: true } : {}),
      description: firstSentence(folder.description),
    })),
  ];
}

type Found =
  | { kind: "setting"; entry: SettingEntry }
  | { kind: "folder"; folder: SettingFolder }
  | { kind: "entry"; folder: SettingFolder; id: string };

function find(listed: Listed, key: string): Found | undefined {
  const entry = listed.settings.find((one) => one.key === key);
  if (entry !== undefined) return { kind: "setting", entry };
  for (const folder of listed.folders) {
    if (key === folder.key || key === patternOf(folder)) {
      return { kind: "folder", folder };
    }
    if (key.startsWith(`${folder.key}.`)) {
      return { kind: "entry", folder, id: key.slice(folder.key.length + 1) };
    }
  }
  return undefined;
}

const unknownKey = (key: string): LophnError => ({
  code: "not_found",
  message: `there is no setting ${key}; run \`lophn settings get\` for the list`,
});

const get = defineCommand({
  name: "settings.get",
  summary: "Read settings",
  description:
    "Read lophn's settings. Without <key> it lists every setting with its current value and a one-line description. " +
    "With <key> it prints that setting in full: description, value, default and the JSON Schema of the value. " +
    "A key prefix (`shell`, `shell.browser`) lists the settings under it. " +
    "A key shown as `<prefix>.<id>` is a set of entries stored one file each (color themes are `shell.themes.<id>`): " +
    "`settings get shell.themes` prints the shape and every entry, `settings get shell.themes.<id>` one entry. " +
    "`locked: true` means only the person changes it, in the Settings screen. " +
    '`approval: "person"` means a change you make asks the person first and applies only if they allow it.',
  input: z.strictObject({ key: keySchema.optional() }),
  positional: ["key"],
  effect: "read",
  routes: [settingsList],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(settingsList, {});
    if (!read.ok) return read;
    const listed = read.value;
    if (input.key === undefined) {
      const settings = indexOf(listed);
      return ok({
        summary: `${settings.length} settings`,
        content: { settings },
        arrayKeys: ["settings"],
      });
    }
    const found = find(listed, input.key);
    if (found?.kind === "setting") {
      const { chosen, ...rest } = found.entry;
      return ok({
        summary: found.entry.key,
        content: {
          ...rest,
          value: valueOf(found.entry),
          chosen: chosen !== undefined,
        },
      });
    }
    if (found?.kind === "folder") {
      const { key: _key, ...rest } = found.folder;
      return ok({
        summary: `${found.folder.entries.length} entries`,
        content: { key: patternOf(found.folder), ...rest },
        arrayKeys: ["entries"],
      });
    }
    if (found?.kind === "entry") {
      const entry = found.folder.entries.find((one) => one.id === found.id);
      if (entry === undefined) return err(unknownKey(input.key));
      return ok({
        summary: input.key,
        content: { key: input.key, value: entry.value },
      });
    }
    const under = indexOf(listed).filter((one) =>
      String(one.key).startsWith(`${input.key}.`),
    );
    if (under.length === 0) return err(unknownKey(input.key));
    return ok({
      summary: `${under.length} settings`,
      content: { settings: under },
      arrayKeys: ["settings"],
    });
  },
});

type JsonSchema = {
  type?: unknown;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
};

// 값이 글자인 설정인가. 그러면 명령줄의 글을 그대로 값으로 쓰고, 아니면 JSON으로 읽는다.
function takesText(schema: JsonSchema): boolean {
  if (schema.type === "string" || typeof schema.const === "string") return true;
  if (Array.isArray(schema.enum)) {
    return schema.enum.every((one) => typeof one === "string");
  }
  return Array.isArray(schema.anyOf) && schema.anyOf.some(takesText);
}

function readValue(schema: JsonSchema, text: string): Result<unknown> {
  if (takesText(schema)) return ok(text);
  try {
    return ok(JSON.parse(text));
  } catch {
    return err({
      code: "invalid_input",
      message: "<value> is not JSON; this setting takes a JSON value",
    });
  }
}

const REASON: Readonly<Record<string, string>> = {
  unknown_key: "there is no such setting",
  locked: "only the person changes it, in the Settings screen",
  needs_approval: "the person did not allow this change",
  wrong_type: "the value has the wrong type",
  out_of_range: "the value is out of range or not one of the allowed values",
  invalid_value: "the value is not valid",
};

// 바꿀 수 있는 key인지 보고 지금 값을 돌려준다. 바꾸기 전 값은 답에 실어 되돌릴 수 있게 한다.
async function target(
  ctx: CommandContext,
  key: string,
): Promise<Result<{ schema: JsonSchema; previous: unknown; exists: boolean }>> {
  const read = await ctx.core.read(settingsList, {});
  if (!read.ok) return read;
  const found = find(read.value, key);
  if (found === undefined || found.kind === "folder") {
    return err(
      found === undefined
        ? unknownKey(key)
        : {
            code: "invalid_input",
            message: `${key} is a set of entries; name one as ${found.folder.key}.<id>`,
          },
    );
  }
  const locked =
    found.kind === "setting" ? found.entry.locked : found.folder.locked;
  if (locked === true) {
    return err({
      code: "forbidden",
      message: `only the person changes ${key}, in the Settings screen`,
    });
  }
  if (found.kind === "entry" && !SETTING_ENTRY_ID.test(found.id)) {
    return err({
      code: "invalid_input",
      message: `${key}: the id after ${found.folder.key}. is lowercase letters, digits and \`-\` (1 to 64)`,
    });
  }
  if (found.kind === "setting") {
    return ok({
      schema: found.entry.type,
      previous: valueOf(found.entry),
      exists: found.entry.chosen !== undefined,
    });
  }
  const entry = found.folder.entries.find((one) => one.id === found.id);
  return ok({
    schema: found.folder.type,
    previous: entry?.value,
    exists: entry !== undefined,
  });
}

async function change(
  ctx: CommandContext,
  key: string,
  action: { action: "set"; value: unknown } | { action: "unset" },
): Promise<Result<{ changed: boolean; notes: string[] }>> {
  const updated = await ctx.core.read(settingsUpdate, {
    ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    changes: [{ key, ...action }],
  });
  if (!updated.ok) return updated;
  const rejection = updated.value.rejected[0];
  // 사람이 거절했거나 물을 수 없었다. 이유(사람이 쓴 글 포함)를 그대로 돌려준다. 값을 고쳐 다시 할 일이 아니다.
  if (rejection?.reason === "needs_approval") {
    return err({
      code: "forbidden",
      message: `${key}: ${rejection.message ?? REASON[rejection.reason]}`,
    });
  }
  if (rejection !== undefined) {
    return err({
      code:
        rejection.reason === "locked"
          ? "forbidden"
          : rejection.reason === "unknown_key"
            ? "not_found"
            : "invalid_input",
      message: `${key}: ${rejection.message ?? REASON[rejection.reason] ?? rejection.reason}. Run \`lophn settings get ${key}\` for what it takes.`,
    });
  }
  return ok({
    changed: updated.value.changed.length > 0,
    notes: updated.value.notes.map((one) => one.message),
  });
}

const set = defineCommand({
  name: "settings.set",
  summary: "Change a setting",
  description:
    "Set a setting of lophn. Find the key and what it takes with `settings get` first. " +
    "<value> is plain text for a text setting (`settings set shell.text_size large`) and JSON for every other one (`true`, `3`, `'[...]'`, `'{...}'`). " +
    'An entry of a set (`shell.themes.<id>`) is created or replaced as a whole: `settings set shell.themes.my-theme \'{"mode":"dark","colors":{...}}\'`. ' +
    "It applies at once: an open lophn window follows. The value is checked first, and a value that is not valid changes nothing and says why (invalid_input). " +
    "The answer carries `previous`, the value before the change; to undo, set it back (or `settings unset` when `previous` was the default). " +
    "`notes` are things that were accepted but need a look, such as a theme color pair with low contrast. " +
    "A locked setting is forbidden: only the person changes it, in the Settings screen. " +
    'A setting with `approval: "person"` (such as sync folders or remote addresses) shows the person exactly what changes and waits for their answer; ' +
    "if they reject it, nothing changes and the answer is forbidden with their reason. Tell the person why before you run it.",
  input: z.strictObject({ key: keySchema, value: z.string() }),
  positional: ["key", "value"],
  effect: "write",
  routes: [settingsList, settingsUpdate],
  workspaces: ["home"],
  run: async (input, ctx) => {
    const found = await target(ctx, input.key);
    if (!found.ok) return found;
    const value = readValue(found.value.schema, input.value);
    if (!value.ok) return value;
    const done = await change(ctx, input.key, {
      action: "set",
      value: value.value,
    });
    if (!done.ok) return done;
    return ok({
      summary: `set ${input.key}`,
      content: {
        key: input.key,
        value: value.value,
        ...(found.value.previous === undefined
          ? {}
          : { previous: found.value.previous }),
        changed: done.value.changed,
        ...(done.value.notes.length === 0 ? {} : { notes: done.value.notes }),
      },
    });
  },
});

const unset = defineCommand({
  name: "settings.unset",
  summary: "Put a setting back to its default, or delete an entry",
  description:
    "Remove the chosen value of a setting so it goes back to its default. For an entry of a set (`shell.themes.<id>`) it deletes that entry and its file. " +
    "The answer carries `previous`, the value that was removed; set it again to undo. " +
    "A locked setting is forbidden: only the person changes it, in the Settings screen. " +
    'A setting with `approval: "person"` asks the person first, as `settings set` does.',
  input: z.strictObject({ key: keySchema }),
  positional: ["key"],
  effect: "write",
  routes: [settingsList, settingsUpdate],
  workspaces: ["home"],
  run: async (input, ctx) => {
    const found = await target(ctx, input.key);
    if (!found.ok) return found;
    const done = await change(ctx, input.key, { action: "unset" });
    if (!done.ok) return done;
    return ok({
      summary: `unset ${input.key}`,
      content: {
        key: input.key,
        ...(found.value.exists ? { previous: found.value.previous } : {}),
        changed: done.value.changed,
      },
    });
  },
});

export const SETTINGS_COMMANDS = [get, set, unset];
