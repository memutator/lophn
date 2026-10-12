// 진단 자리 화면 테스트의 가짜 통로. core를 부르지 않고 부른 것을 기록한다.
import type { DiagnosticsSource, DiagnosticsView } from "../source.ts";

export interface FakeDiagnosticsOptions {
  view?: DiagnosticsView;
  checkFails?: boolean;
}

export function fakeDiagnostics(options: FakeDiagnosticsOptions = {}) {
  const calls: unknown[][] = [];
  const source: DiagnosticsSource = {
    check() {
      calls.push(["check"]);
      if (options.checkFails) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      return Promise.resolve({
        ok: true,
        value: options.view ?? {
          rows: [],
          observedAt: "2026-10-06T00:00:00.000Z",
        },
      });
    },
  };
  return { source, calls };
}
