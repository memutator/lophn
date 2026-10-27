// settings 화면 테스트의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. secret 값은 이
// 통로에 없다: 보호 창 열기는 이름만 기록한다.
import type {
  SettingEntry,
  SettingRejectReason,
  SettingsSource,
  SettingsUpdateResult,
  SourceResult,
} from "../source.ts";

/**
 * 선언한 설정 하나. 기본값을 주면 기본값이 있는 설정이고, 사람이 정한 값(chosen)을 주면 정한 설정이다.
 * 기본값도 정한 값도 없으면 사람이 골라야 하는 필수 설정이 비어 있는 모양이다.
 */
export function declared(
  key: string,
  type: Record<string, unknown>,
  options: { default?: unknown; chosen?: unknown } = {},
): SettingEntry {
  return {
    key,
    type,
    hasDefault: "default" in options,
    defaultValue: options.default,
    hasChosen: "chosen" in options,
    chosen: options.chosen,
  };
}

/** 화면 확인용 대표 선언: 불리언, 숫자 범위, 선택지, 목록이 한 번씩 있다. */
export const SAMPLE_DECLARED: readonly SettingEntry[] = [
  declared(
    "agents.model.catalog_auto_update",
    { type: "boolean" },
    {
      default: true,
      chosen: false,
    },
  ),
  declared(
    "agents.run.max_tool_calls",
    { type: "integer", minimum: 1, maximum: 200 },
    { default: 50, chosen: 80 },
  ),
  declared(
    "agents.run.max_minutes",
    { type: "integer", minimum: 1, maximum: 120 },
    { default: 30 },
  ),
  declared(
    "agents.run.on_limit",
    { type: "string", enum: ["stop", "ask"] },
    { default: "stop" },
  ),
  declared(
    "projects.search.skip_patterns",
    { type: "array", items: { type: "string" } },
    { default: [], chosen: ["*.log", "dist/"] },
  ),
];

interface FakeSettingsOptions {
  /** 선언한 설정. 없으면 대표 선언이다. */
  declared?: readonly SettingEntry[];
  /** 읽기가 실패하는지. */
  declaredFail?: boolean;
  /** 설정을 바꿀 때 거절되는 key와 이유. 거절되면 아무것도 저장하지 않는다. */
  rejects?: Readonly<Record<string, SettingRejectReason>>;
}

export function fakeSettings(options: FakeSettingsOptions = {}) {
  const calls: unknown[][] = [];
  let entries: readonly SettingEntry[] = options.declared ?? SAMPLE_DECLARED;
  const failed = <T>(code: string): Promise<SourceResult<T>> =>
    Promise.resolve({ ok: false, code });
  const source: SettingsSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    declared() {
      calls.push(["declared"]);
      return options.declaredFail
        ? failed("unavailable")
        : Promise.resolve({ ok: true, value: entries });
    },
    update(changes) {
      calls.push(["update", changes]);
      const rejected = changes.flatMap((change) => {
        const reason = options.rejects?.[change.key];
        return reason === undefined ? [] : [{ key: change.key, reason }];
      });
      const result: SettingsUpdateResult =
        rejected.length > 0
          ? { changed: [], rejected }
          : { changed: changes.map((change) => change.key), rejected: [] };
      if (rejected.length === 0) {
        entries = entries.map((entry) => {
          const change = changes.find((one) => one.key === entry.key);
          if (change === undefined) return entry;
          return change.action === "set"
            ? { ...entry, hasChosen: true, chosen: change.value }
            : { ...entry, hasChosen: false, chosen: undefined };
        });
      }
      return Promise.resolve({ ok: true, value: result });
    },
  };
  return { source, calls };
}
