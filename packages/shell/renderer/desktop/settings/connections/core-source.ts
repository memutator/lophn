// CodingConnectionsSource를 main의 통로로 만든다. 제품마다 감지 결과와 다시 감지는 main IPC
// (`lophnCoding`의 `harnesses`·`refresh`·`hookStatus`·`installHooks`·`uninstallHooks`)이다. 응답은 main의 contract client가
// 이미 검사했다. 연결 생성·회수·token은 이 통로에 없다.
import type {
  CodingReply,
  HarnessHookView,
  HarnessName,
  HarnessSettingsView,
} from "../../../../ipc/coding.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type { CodingConnectionsSource, SourceResult } from "./source.ts";

/** Settings가 쓰는 shell IPC. `harnesses`는 저장한 감지 결과, `refresh`는 사람이 요청한 다시 감지다. */
interface CodingSettingsApi {
  harnesses(): Promise<CodingReply<readonly HarnessSettingsView[]>>;
  refresh(): Promise<CodingReply<unknown>>;
  hookStatus(): Promise<CodingReply<readonly HarnessHookView[]>>;
  installHooks(harness: HarnessName): Promise<CodingReply<HarnessHookView>>;
  uninstallHooks(harness: HarnessName): Promise<CodingReply<HarnessHookView>>;
}

export function windowCodingApi(): CodingSettingsApi | undefined {
  const bridge = (globalThis as { lophnCoding?: Partial<CodingSettingsApi> })
    .lophnCoding;
  return bridge !== undefined &&
    typeof bridge.harnesses === "function" &&
    typeof bridge.refresh === "function"
    ? (bridge as CodingSettingsApi)
    : undefined;
}

interface CodingConnectionsDeps {
  core: CoreSource;
  coding: CodingSettingsApi | undefined;
}

const unavailable = { ok: false, code: "unavailable" } as const;

function mapped<T>(reply: CodingReply<T>): SourceResult<T> {
  return reply.ok
    ? { ok: true, value: reply.value }
    : { ok: false, code: reply.error.code };
}

export function coreCodingConnectionsSource(
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
    watch: (listener) => deps.core.subscribe(listener),

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

    async hookStatus() {
      if (deps.coding === undefined) return unavailable;
      try {
        return mapped(await deps.coding.hookStatus());
      } catch {
        return unavailable;
      }
    },

    async installHooks(harness) {
      if (deps.coding === undefined) return unavailable;
      try {
        return mapped(await deps.coding.installHooks(harness));
      } catch {
        return unavailable;
      }
    },

    async uninstallHooks(harness) {
      if (deps.coding === undefined) return unavailable;
      try {
        return mapped(await deps.coding.uninstallHooks(harness));
      } catch {
        return unavailable;
      }
    },
  };
}
