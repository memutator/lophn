import type { AssemblyReport, SideStat } from "../spec/mod.ts";

const pct = (rate: number | null) =>
  rate === null ? "n/a" : `${Math.round(rate * 100)}%`;

// layer마다 baseline rate → variant rate와 variant에서 처음 깨진 자리.
export function formatAssembly(report: AssemblyReport): string[] {
  const head = `assembly ${report.run} trial ${report.trial}`;
  if (report.status === "not_replayable") {
    return [`${head}: not replayable (${report.reason})`];
  }
  const lines = [
    `${head}: ${report.status}, ${report.identical_calls}/${report.compared_calls} calls with identical boundaries`,
  ];
  if (report.reason !== null) lines.push(`  ${report.reason}`);
  const before = report.baseline;
  const after = report.variant;
  if (before === null || after === null) return lines;
  const names = [
    ...new Set([...before.layers, ...after.layers].map((l) => l.layer)),
  ];
  const find = (side: SideStat, layer: string) =>
    side.layers.find((l) => l.layer === layer);
  for (const layer of names) {
    const b = find(before, layer);
    const a = find(after, layer);
    lines.push(
      `  ${layer}: ${pct(b?.rate ?? null)} -> ${pct(a?.rate ?? null)}`,
    );
    for (const [side, stat] of [["baseline", b], ["variant", a]] as const) {
      const brk = stat?.first_break;
      if (brk) {
        lines.push(
          `    ${side} first break at call ${brk.call}: "${brk.before}" -> "${brk.after}"`,
        );
      }
    }
  }
  return lines;
}
