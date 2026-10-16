// CodingConnectionsSource를 main의 통로로 만든다. 제품마다 감지 결과와 다시 감지는 main IPC
// (`lophnCoding`의 `harnesses`·`refresh`)이고, 기본 실행 옵션은 선언 설정의 읽기·쓰기다.
// 응답은 main의 contract client가 이미 검사했다. 연결 생성·회수·token은 이 통로에 없다.
import type {
  CodingReply,
  HarnessName,
  HarnessSettingsView,
} from "../../../../../ipc/coding.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import { effectiveValue, listSettings, updateSettings } from "../declared.ts";
import type {
  CodingConnectionsSource,
  CodingDefaults,
  SourceResult,
} from "./source.ts";

/** 기본 제품. 비어 있을 수 있다(null). */
const DEFAULT_HARNESS_KEY = "coding-agent.default_harness";
/** 기본 model. 비어 있으면 제품의 기본이다. */
const DEFAULT_MODEL_KEY = "coding-agent.default_model";

/** Settings가 쓰는 shell IPC. `harnesses`는 저장한 감지 결과, `refresh`는 사람이 요청한 다시 감지다. */
interface CodingSettingsApi {
  harnesses(): Promise<CodingReply<readonly HarnessSettingsView[]>>;
  refresh(): Promise<CodingReply<unknown>>;
}

export function windowCodingApi(): CodingSettingsApi | undefined {
  const bridge = (globalThis as { lophnCoding?: Partial<CodingSettingsApi> })
    .lophnCoding;
  return bridge !== undefined && typeof bridge.harnesses === "function" &&
      typeof bridge.refresh === "function"
    ? bridge as CodingSettingsApi
    : undefined;
}

interface CodingConnectionsDeps {
  coding: CodingSettingsApi | undefined;
}

const unavailable = { ok: false, code: "unavailable" } as const;

function mapped<T>(reply: CodingReply<T>): SourceResult<T> {
  return reply.ok
    ? { ok: true, value: reply.value }
    : { ok: false, code: reply.error.code };
}

export function coreCodingConnectionsSource(
  core: CoreSource,
  deps: CodingConnectionsDeps,
): CodingConnectionsSource {
  const read = async (): Promise<
    SourceResult<readonly HarnessSettingsView[]>
  > => {
    if (deps.coding === undefined) return unavailable;
    try {
      return mapped(await deps.coding.harnesses());
    } catch {
      return unavailable;
    }
  };

  return {
    watch: (listener) => core.subscribe(listener),

    harnesses: read,

    async refresh() {
      if (deps.coding === undefined) return unavailable;
      try {
        const done = await deps.coding.refresh();
        if (!done.ok) return { ok: false, code: done.error.code };
      } catch {
        return unavailable;
      }
      // 다시 감지한 결과는 저장돼 있다. 같은 모양으로 읽어 온다.
      return read();
    },

    async defaults() {
      const listed = await listSettings(core, [
        DEFAULT_HARNESS_KEY,
        DEFAULT_MODEL_KEY,
      ]);
      if (!listed.ok) return listed;
      const valueOf = (key: string) => {
        const entry = listed.value.find((one) => one.key === key);
        return entry === undefined ? undefined : effectiveValue(entry);
      };
      const harness = valueOf(DEFAULT_HARNESS_KEY);
      const model = valueOf(DEFAULT_MODEL_KEY);
      const value: CodingDefaults = {
        harness: typeof harness === "string" ? harness as HarnessName : null,
        model: typeof model === "string" ? model : "",
      };
      return { ok: true, value };
    },

    async saveDefaults(values) {
      const result = await updateSettings(core, [
        values.harness === null
          ? { key: DEFAULT_HARNESS_KEY, action: "unset" }
          : { key: DEFAULT_HARNESS_KEY, action: "set", value: values.harness },
        values.model === ""
          ? { key: DEFAULT_MODEL_KEY, action: "unset" }
          : { key: DEFAULT_MODEL_KEY, action: "set", value: values.model },
      ]);
      if (!result.ok) return result;
      const rejection = result.value.rejected[0];
      return rejection === undefined
        ? { ok: true, value: null }
        : { ok: false, code: rejection.reason };
    },
  };
}
