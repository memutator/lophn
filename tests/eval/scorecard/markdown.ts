import { toolRates } from "../collect/mod.ts";
import type { RunRecord, ScorecardRow } from "../types.ts";

// 표 칸과 한 줄 글에 줄바꿈과 `|`가 들어가지 않게 한다.
const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|");
const pct = (v: number | null) =>
  v === null ? "-" : `${(v * 100).toFixed(1)}%`;
const runFile = (id: string) => `tests/eval/runs/${id}.json`;

function sumOf(row: ScorecardRow, kind: "program" | "judge"): string {
  const cs = row.checks.filter((c) => c.kind === kind);
  if (cs.length === 0) return "-";
  return `${cs.reduce((n, c) => n + c.passed, 0)}/${cs.reduce(
    (n, c) => n + c.of,
    0,
  )}`;
}

export function renderScorecard(
  rows: ScorecardRow[],
  runs: RunRecord[],
  opts: { date: string; model: string },
): string {
  const label = (r: ScorecardRow) => `${r.scenario.name}@${r.scenario.n}`;
  const byId = new Map(runs.map((r) => [r.id, r]));
  // 채점 대기는 통과로 세지 않는다. 숫자 옆에 따로 보인다.
  const judgeCell = (r: ScorecardRow) => {
    const sum = sumOf(r, "judge");
    const run = r.run === null ? undefined : byId.get(r.run);
    const pending =
      run?.trials.flatMap((t) => t.checks).filter((c) => c.pending).length ?? 0;
    return pending > 0 ? `${sum} (대기 ${pending})` : sum;
  };
  const out: string[] = [
    `# scorecard ${opts.date}`,
    "",
    `기준 model: ${opts.model}. 낡음은 지금 checkout의 version과 비교한 값이다. run마다 본 version은 \`tests/eval/runs/<id>.json\`에 있다.`,
    "",
    "| 시나리오 | run | 통과 | program | judge | 비용(USD) | cache hit | tool 성공 | 잘림 | agent call | 제안 | 낡음 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const m = r.metrics;
    out.push(
      `| ${[
        label(r),
        r.run ?? "-",
        `${r.passed}/${r.trials}`,
        sumOf(r, "program"),
        judgeCell(r),
        m === null
          ? "-"
          : m.cost_usd.toFixed(4) + (m.unpriced_calls > 0 ? "+?" : ""),
        m === null ? "-" : pct(m.cache_hit_rate),
        m === null ? "-" : pct(toolRates(m.tools).success),
        m === null ? "-" : String(m.truncated_calls),
        m === null ? "-" : String(m.agent_calls.length),
        r.proposal ? "제안" : "",
        r.stale.length > 0 ? "낡음" : "",
      ].join(" | ")} |`,
    );
  }

  out.push("", "## 떨어진 check", "");
  const failed = rows.flatMap((r) =>
    r.checks
      .filter((c) => c.passed < c.of)
      .map((c) => `| ${label(r)} | ${c.id} | ${cell(c.reasons.join("; "))} |`),
  );
  out.push(
    ...(failed.length > 0
      ? ["| 시나리오 | check | 이유 |", "|---|---|---|", ...failed]
      : ["없음"]),
  );

  out.push("", "## judge verdict", "");
  const verdicts: string[] = [];
  for (const r of rows) {
    const run = r.run === null ? undefined : byId.get(r.run);
    for (const item of run?.trials.flatMap((t) => t.judge) ?? []) {
      const bad = item.error !== null || item.verdict === "cannot_tell";
      const verdict =
        item.state === "pending"
          ? "채점 대기"
          : `${bad ? "!" : ""}${cell(item.verdict ?? `error: ${item.error}`)}`;
      verdicts.push(
        `| ${label(r)} | ${item.check} | ${item.criterion} | ${
          item.model ?? "-"
        } | ${verdict} | ${cell(item.quote ?? "-")} | ${runFile(run!.id)} |`,
      );
    }
  }
  out.push(
    ...(verdicts.length > 0
      ? [
          "| 시나리오 | check | criterion | model | verdict | 인용 | run file |",
          "|---|---|---|---|---|---|---|",
          ...verdicts,
        ]
      : ["없음"]),
  );

  out.push("", "## 낡음", "");
  const stale = rows.filter((r) => r.stale.length > 0);
  if (stale.length === 0) out.push("없음");
  for (const r of stale) {
    out.push(`- ${label(r)}${r.run === null ? "" : ` (${r.run})`}`);
    for (const reason of r.stale) out.push(`  - ${reason}`);
  }

  out.push("", "## 제안 줄에서 나온 case", "");
  const proposals = rows.filter((r) => r.proposal);
  out.push(
    "떨어지면 model보다 AGENT.md의 그 줄이나 지침이 틀렸을 수 있다.",
    "",
  );
  if (proposals.length === 0) out.push("없음");
  for (const r of proposals) {
    out.push(
      `- ${r.scenario.name}${
        r.run !== null && r.passed < r.trials ? " (떨어짐)" : ""
      }`,
    );
  }
  return out.join("\n") + "\n";
}
