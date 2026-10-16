// Diagnostics 화면의 가짜 통로. core를 부르지 않고 부른 것을 기록한다.
import type { DiagnosticsSource, DiagnosticsView } from "../source.ts";

interface FakeDiagnosticsOptions {
  view?: DiagnosticsView;
  checkFails?: boolean;
}

const AT = "2026-10-06T10:42:07.000Z";

/** 화면 확인용 대표 결과: 쓸 수 없는 구성 요소 둘이 안전한 이유와 함께 있다. */
const SAMPLE_VIEW: DiagnosticsView = {
  checkedAt: "2026-10-06T10:42:09.000Z",
  components: [
    { component: "core", available: true, reason: null, checkedAt: AT },
    { component: "ledger", available: true, reason: null, checkedAt: AT },
    { component: "events", available: true, reason: null, checkedAt: AT },
    {
      component: "app-runtime",
      available: true,
      reason: null,
      checkedAt: "2026-10-06T10:42:08.000Z",
    },
    {
      component: "sandbox",
      available: false,
      reason: "The sandbox could not be set up on this system.",
      checkedAt: "2026-10-06T10:42:08.000Z",
    },
    {
      component: "agent-runtime",
      available: false,
      reason: "No model is available. Connect a provider and choose a model.",
      checkedAt: "2026-10-06T10:42:08.000Z",
    },
  ],
};

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
        value: options.view ?? SAMPLE_VIEW,
      });
    },
  };
  return { source, calls };
}
