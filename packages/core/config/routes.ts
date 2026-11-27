// settings/list·settings/update. 거절 결과와 오류에 입력한 값을 싣지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import { z } from "zod";
import type {
  ToolGateInput,
  ToolGateResult,
} from "../../protocol/approvals/mod.ts";
import {
  type SettingDeclaration,
  type SettingEntry,
  type SettingFolder,
  type SettingsView,
  settingsList,
  settingsUpdate,
} from "../../protocol/config/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { MemoryHandler } from "../server/mod.ts";
import type { SettingChange } from "./registry.ts";
import type { SettingsStore } from "./store.ts";

const jsonSchemaOf = (type: z.ZodType) =>
  z.toJSONSchema(type, { unrepresentable: "any" }) as SettingEntry["type"];

export function settingsListHandler(
  store: Pick<SettingsStore, "registry" | "chosen" | "folder">,
): MemoryHandler {
  return (_ctx, rawInput) => {
    const input = settingsList.input.safeParse(rawInput);
    if (!input.success) {
      return err({
        code: "invalid_input",
        message: "settings list is not valid",
      });
    }
    const asked =
      input.data.keys === undefined ? undefined : new Set(input.data.keys);
    const chosen = store.chosen();
    const settings = store.registry
      .declarations()
      .filter((one) => asked === undefined || asked.has(one.key))
      .map(
        (one): SettingEntry => ({
          key: one.key,
          description: one.description,
          ...(one.locked === true ? { locked: true } : {}),
          ...(one.approval === undefined ? {} : { approval: one.approval }),
          type: jsonSchemaOf(one.type),
          ...(one.default === undefined
            ? {}
            : { default: one.default as never }),
          ...(chosen[one.key] === undefined
            ? {}
            : { chosen: chosen[one.key] as never }),
        }),
      );
    const folders = store.registry
      .folders()
      .filter((one) => asked === undefined || asked.has(one.key))
      .map((one): SettingFolder => {
        const state = store.folder(one);
        return {
          key: one.key,
          description: one.description,
          ...(one.locked === true ? { locked: true } : {}),
          folder: one.folder,
          type: jsonSchemaOf(one.type),
          entries: Object.entries(state.values).map(([id, value]) => ({
            id,
            value: value as never,
          })),
          unreadable: [...state.unreadable],
        };
      });
    return ok({ settings, folders });
  };
}

// agent가 approval 설정을 바꿀 때 사람에게 묻는 길. 조립이 `tool_gate/check`를 꽂는다: 판정(unattended·팀 자식은 막는다),
// turn 안 request, 사람의 결정 기다리기를 거기서 한다. 호출 자격은 바꾸려는 agent의 것 그대로다.
export type AskPerson = (
  who: AuthenticatedContext,
  input: ToolGateInput,
) => Promise<Result<ToolGateResult>>;

const NOT_ASKED: Readonly<Record<string, string>> = {
  denied:
    "the person must allow this change; ask from a session the person is in",
  cancelled: "the request ended before the person answered",
};

export function settingsUpdateHandler(
  store: Pick<SettingsStore, "registry" | "update" | "chosen" | "folder">,
  askPerson?: AskPerson,
): MemoryHandler {
  return async (ctx, rawInput) => {
    const input = settingsUpdate.input.safeParse(rawInput);
    if (!input.success) {
      return err({
        code: "invalid_input",
        message: "settings update is not valid",
      });
    }
    const { changes } = input.data;
    // 기기의 연결 설정(`remote.*`)은 기기·명단 관리와 같은 종류라 터미널 입력을 허락받은 기기도 바꾸지 못한다.
    // `remote.hub`만 연다: 켜고 꺼도 붙어 있는 기기가 끊기지 않고, 화면 없는 기계(VPS)는 가서 켤 곳이 없다.
    if (
      changes.some(
        (change) =>
          change.key.startsWith("remote.") && change.key !== "remote.hub",
      ) &&
      ctx.principal.startsWith("device:")
    ) {
      return err({
        code: "forbidden",
        message: "a device may not change the remote settings",
      });
    }
    // agent가 자기 범위를 정하는 설정을 바꾸지 못하게 한다. 사람(Settings 화면, 사람의 터미널)은 지난다.
    if (ctx.actor.startsWith("agent:")) {
      const locked = changes.filter((change) =>
        store.registry.locked(change.key),
      );
      if (locked.length > 0) {
        return ok({
          changed: [],
          rejected: locked.map((change) => ({
            key: change.key,
            reason: "locked" as const,
          })),
          notes: [],
        });
      }
      const asking = changes.flatMap((change) => {
        const declaration = store.registry.get(change.key);
        return declaration?.approval === "person"
          ? [{ change, declaration }]
          : [];
      });
      if (asking.length > 0) {
        // 틀린 값은 사람에게 묻기 전에 거절한다. 사람이 허락한 뒤 거절되는 값을 보이지 않는다.
        const asked = asking.map((one) => one.change);
        const rejected = store.registry.validate(asked);
        if (rejected.length > 0) {
          return ok({ changed: [], rejected, notes: [] });
        }
        const checked = store.registry.check(asked, viewAfter(store, changes));
        if (checked.rejected.length > 0) {
          return ok({ changed: [], rejected: checked.rejected, notes: [] });
        }
        for (const { change, declaration } of asking) {
          const refused = await askFor(
            ctx,
            input.data.tool_call,
            store,
            change,
            declaration,
            askPerson,
          );
          if (refused !== null) {
            return ok({
              changed: [],
              rejected: [
                {
                  key: change.key,
                  reason: "needs_approval" as const,
                  message: refused,
                },
              ],
              notes: [],
            });
          }
        }
      }
    }
    return store.update(changes);
  };
}

// 묻고 허락이면 null, 아니면 agent에게 갈 이유. 허락은 물은 그 호출 하나가 물은 그 값을 쓰는 것뿐이라 id를 남기지 않는다.
// 기다리는 동안 그 설정이 바뀌어 사람이 본 줄과 지금 바뀜이 다르면 쓰지 않는다.
async function askFor(
  ctx: AuthenticatedContext,
  toolCall: string | undefined,
  store: Pick<SettingsStore, "chosen">,
  change: SettingChange,
  declaration: SettingDeclaration,
  askPerson: AskPerson | undefined,
): Promise<string | null> {
  const lines = linesOf(store, change, declaration);
  if (lines.length === 0) return null;
  const { session, turn } = ctx.conditions;
  if (
    askPerson === undefined ||
    toolCall === undefined ||
    session === undefined ||
    turn === undefined
  ) {
    return "the person must allow this change; only a lophn agent turn can ask, or the person changes it in Settings";
  }
  const asked = await askPerson(ctx, {
    session,
    turn,
    tool_call: toolCall,
    tool: "lophn",
    call: { kind: "setting", key: change.key, lines },
  });
  if (!asked.ok) return asked.error.message;
  const result = asked.value;
  if (result.kind === "rejected") {
    return result.reason === null
      ? "the person rejected this change"
      : `the person rejected this change: ${result.reason}`;
  }
  if (result.kind !== "run") return NOT_ASKED[result.kind]!;
  const now = linesOf(store, change, declaration);
  return now.join("\n") === lines.join("\n")
    ? null
    : "the setting changed while the person was deciding; ask again";
}

// 지금 값과 바꾼 뒤 값의 바뀜. 파일에 틀린 값이 있으면 기본값으로 본다(읽기와 같다).
function linesOf(
  store: Pick<SettingsStore, "chosen">,
  change: SettingChange,
  declaration: SettingDeclaration,
): string[] {
  const valueOf = (raw: unknown) => {
    const picked =
      raw !== undefined && declaration.type.safeParse(raw).success
        ? raw
        : declaration.default;
    return picked === undefined ? undefined : declaration.type.parse(picked);
  };
  const before = valueOf(store.chosen()[change.key]);
  const after = valueOf(change.action === "set" ? change.value : undefined);
  return declaration.describe?.(before, after) ?? [];
}

// 뜻 검사가 보는 값(변경을 모두 적용한 뒤). folder 항목은 지금 값이다: 묻기 전 검사라 store.update가 쓸 때 다시 본다.
function viewAfter(
  store: Pick<SettingsStore, "chosen" | "folder">,
  changes: readonly SettingChange[],
): SettingsView {
  const next: Record<string, unknown> = { ...store.chosen() };
  for (const change of changes) {
    if (change.action === "set") next[change.key] = change.value;
    else delete next[change.key];
  }
  return {
    get: (setting) => {
      const picked = next[setting.key] ?? setting.default;
      return picked === undefined ? undefined : setting.type.parse(picked);
    },
    entries: (folder) => store.folder(folder).values,
  };
}
