import type { OverfitWarning } from "../spec/mod.ts";

export function formatWarnings(warnings: OverfitWarning[]): string[] {
  return warnings.map(
    (w) =>
      `경고: ${w.term} (${
        w.kind === "name" ? "이름" : "구절"
      }) 가 ${w.component} 의 ${
        w.file === "" ? "본문" : w.file
      } 에 더해졌다. 시나리오 ${w.scenario}: "${w.line}"`,
  );
}
