import { appendFile, mkdir } from "node:fs/promises";
import { errorCode } from "../../../base/mod.ts";
import type { Diagnostic } from "../../../protocol/supervision/mod.ts";
import { CRASH_LOCATIONS } from "../../diagnostics/mod.ts";

type ShellViewLifetime = Extract<Diagnostic, { kind: "shell_view_lifetime" }>;

type InternalDiagnostic = Extract<Diagnostic, { kind: "lophn_internal" }>;

// shell main이 control socket으로 보내는 안전 진단을 받는 곳. 기록 실패는 core를 멈추지 않는다.
export type ControlDiagnostics = {
  shellView(diagnostic: ShellViewLifetime): Promise<void>;
  internal(diagnostic: InternalDiagnostic): void;
};

// view 수명 한 줄. schema가 고정한 field(구성 요소·관측 시각·view id·generation·개수)만 쓰고
// URL·query·token·경로는 payload에 들어올 자리가 없다.
function shellViewLogLine(diagnostic: ShellViewLifetime): string {
  const payload = diagnostic.payload;
  return JSON.stringify({
    at: payload.observed_at,
    component: payload.component,
    kind: "diagnostic",
    code: "shell_view_lifetime",
    view_id: payload.view_id,
    generation: payload.generation,
    created: payload.created,
    hidden: payload.hidden,
    replaced: payload.replaced,
    disposed: payload.disposed,
    attached: payload.attached,
  });
}

// `<데이터 root>/logs/shell-view.jsonl`에 덧붙인다. 다른 core 진단 파일과 같은 자리다.
function shellViewLog(dataRoot: string): Pick<ControlDiagnostics, "shellView"> {
  return {
    async shellView(diagnostic) {
      try {
        const directory = `${dataRoot}/logs`;
        try {
          await mkdir(directory, { mode: 0o700 });
        } catch (error) {
          if (errorCode(error) !== "EEXIST") throw error;
        }
        await appendFile(
          `${directory}/shell-view.jsonl`,
          shellViewLogLine(diagnostic) + "\n",
        );
      } catch {
        // 기록하지 못해도 core는 그대로 간다.
      }
    },
  };
}

// shell main이 보내는 안전 진단 두 종류를 받는 곳. 보내는 쪽 값을 믿지 않고 core가
// component·location을 정한다.
export function createControlDiagnostics(
  dataRoot: string,
  write: (diagnostic: Diagnostic) => Promise<boolean>,
): ControlDiagnostics {
  const log = shellViewLog(dataRoot);
  return {
    shellView: (diagnostic) => log.shellView(diagnostic),
    internal: (diagnostic) =>
      void write({
        ...diagnostic,
        payload: {
          ...diagnostic.payload,
          component: "platform/shell-main",
          location: CRASH_LOCATIONS.shellMain,
        },
      }).catch(() => {}),
  };
}

// 진단 하나를 그 종류의 처리로 보낸다. 다른 종류는 받지 않는다(control 계약이 두 종류만 받는다).
export async function routeDiagnostic(
  diagnostics: ControlDiagnostics,
  diagnostic: Diagnostic,
): Promise<void> {
  if (diagnostic.kind === "shell_view_lifetime") {
    await diagnostics.shellView(diagnostic);
  } else if (diagnostic.kind === "lophn_internal") {
    diagnostics.internal(diagnostic);
  }
}
