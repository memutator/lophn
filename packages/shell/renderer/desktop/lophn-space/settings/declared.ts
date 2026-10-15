// 선언한 설정을 읽고 바꾸는 core 부르기(`settings/list`, `settings/update`). General·Appearance·
// Reactions·Coding agents의 기본 실행 옵션이 같이 쓴다. 틀린 값은 오류가 아니라 rejected로 온다.
import type { CoreSource } from "../../connection/connection.ts";
import { call } from "./core-call.ts";
import type {
  SettingChange,
  SettingEntry,
  SettingRejectReason,
  SettingsUpdateResult,
  SourceResult,
} from "./source.ts";

interface ListValue {
  settings: {
    key: string;
    type: Record<string, unknown>;
    default?: unknown;
    chosen?: unknown;
  }[];
}

export async function listSettings(
  core: CoreSource,
  keys?: readonly string[],
): Promise<SourceResult<SettingEntry[]>> {
  const read = await call<ListValue>(
    core,
    "memory",
    "settings",
    "list",
    keys === undefined ? {} : { keys },
  );
  if (!read.ok) return read;
  return {
    ok: true,
    value: read.value.settings.map((entry) => ({
      key: entry.key,
      type: entry.type,
      hasDefault: "default" in entry,
      defaultValue: entry.default,
      hasChosen: "chosen" in entry,
      chosen: entry.chosen,
    })),
  };
}

export function updateSettings(
  core: CoreSource,
  changes: readonly SettingChange[],
): Promise<SourceResult<SettingsUpdateResult>> {
  return call<SettingsUpdateResult>(core, "memory", "settings", "update", {
    changes,
  });
}

/** 사람이 정한 값이 있으면 그 값, 없으면 선언의 기본값이다. 둘 다 없으면 undefined다. */
export function effectiveValue(entry: SettingEntry): unknown {
  return entry.hasChosen ? entry.chosen : entry.defaultValue;
}

/** 한 key의 값을 정한다. 거절은 code가 이유다(`out_of_range` 등). */
export async function chooseSetting(
  core: CoreSource,
  key: string,
  value: unknown,
): Promise<SourceResult<null>> {
  const result = await updateSettings(core, [{ key, action: "set", value }]);
  if (!result.ok) return result;
  const rejection = result.value.rejected[0];
  return rejection === undefined
    ? { ok: true, value: null }
    : { ok: false, code: rejection.reason satisfies SettingRejectReason };
}

/** 정한 key들의 현재 값. 선언에 없는 key는 빠진다. */
export async function readEffective(
  core: CoreSource,
  keys: readonly string[],
): Promise<SourceResult<Map<string, unknown>>> {
  const listed = await listSettings(core, keys);
  if (!listed.ok) return listed;
  return {
    ok: true,
    value: new Map(
      listed.value.map((entry) => [entry.key, effectiveValue(entry)]),
    ),
  };
}
