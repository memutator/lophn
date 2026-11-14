// 선언한 설정의 `settings/list` 답 풀기와 바꾸기(`settings/update`). 화면은 `settings/list`를 useCoreRead로 읽고
// 이 file의 함수로 푼다. 틀린 값은 오류가 아니라 rejected로 온다.
import type { z } from "zod";

import type { settingsList } from "../../../../protocol/config/file.ts";
import type { CoreSource } from "../connection/connection.ts";
import { call } from "./core-call.ts";
import type {
  SettingChange,
  SettingEntry,
  SettingRejectReason,
  SettingsUpdateResult,
  SourceResult,
} from "./source.ts";

type ListValue = z.output<typeof settingsList.output>;

/** `settings/list`의 답을 화면의 설정 항목으로 옮긴다. */
export function entriesOf(value: ListValue): SettingEntry[] {
  return value.settings.map((entry) => ({
    key: entry.key,
    type: entry.type,
    hasDefault: "default" in entry,
    defaultValue: entry.default,
    hasChosen: "chosen" in entry,
    chosen: entry.chosen,
  }));
}

/** `settings/list`의 답에서 key마다 지금 값. 선언에 없는 key는 빠진다. */
export function effectiveOf(value: ListValue): Map<string, unknown> {
  return new Map(
    entriesOf(value).map((entry) => [entry.key, effectiveValue(entry)]),
  );
}

export function updateSettings(
  core: CoreSource,
  changes: readonly SettingChange[],
): Promise<SourceResult<SettingsUpdateResult>> {
  return call<SettingsUpdateResult>(core, "memory", "settings", "update", {
    changes,
  });
}

/** 항목마다 file 하나인 설정 묶음(`shell.themes`)의 항목과 core가 읽지 못한 file. */
export interface SettingFolderView {
  readonly entries: readonly { readonly id: string; readonly value: unknown }[];
  readonly unreadable: readonly {
    readonly name: string;
    readonly reason: "bad_id" | "too_large" | "not_json" | "bad_shape";
  }[];
}

/** `settings/list`의 답에서 한 묶음. 묶음이 없으면 빈 것이다. */
export function folderOf(value: ListValue, key: string): SettingFolderView {
  const folder = value.folders.find((one) => one.key === key);
  return folder ?? { entries: [], unreadable: [] };
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

/** 쓰기 직전에 정한 key들의 현재 값을 다시 읽는다. 화면이 쥔 값으로 통째로 쓰면 그 사이 바뀐 것을 잃는다. */
export async function readEffective(
  core: CoreSource,
  keys: readonly string[],
): Promise<SourceResult<Map<string, unknown>>> {
  const read = await call<ListValue>(core, "memory", "settings", "list", {
    keys,
  });
  return read.ok ? { ok: true, value: effectiveOf(read.value) } : read;
}
