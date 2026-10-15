// DiagnosticsSource를 main의 core 통로로 만든다. 결과는 contract memory(diagnostics/status)이고, 호출할
// 때마다 지금 점검한다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
import type { CoreSource } from "../../../connection/connection.ts";
import { call } from "../core-call.ts";
import type { DiagnosticsSource, DiagnosticsView } from "./source.ts";

interface StatusValue {
  checked_at: string;
  components: {
    component: string;
    available: boolean;
    reason?: string;
    checked_at: string;
  }[];
}

export function coreDiagnosticsSource(core: CoreSource): DiagnosticsSource {
  return {
    async check() {
      const read = await call<StatusValue>(
        core,
        "memory",
        "diagnostics",
        "status",
        {},
      );
      if (!read.ok) return read;
      const view: DiagnosticsView = {
        checkedAt: read.value.checked_at,
        components: read.value.components.map((item) => ({
          component: item.component,
          available: item.available,
          reason: item.reason ?? null,
          checkedAt: item.checked_at,
        })),
      };
      return { ok: true, value: view };
    },
  };
}
