import { sumMetrics } from "../collect/mod.ts";
import { contentFiles, readEntries, TEXT_KINDS } from "../versions/mod.ts";
import { refText, type RunRecord, type VersionRef } from "../types.ts";
import { versionChanges } from "./pick.ts";

type Op = { t: " " | "-" | "+"; s: string };

// 줄 단위 LCS diff. 바뀐 덩어리와 앞뒤 context줄. 같으면 "".
export function lineDiff(a: string, b: string, context = 2): string {
  const x = a.split("\n");
  const y = b.split("\n");
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (
    tail < x.length - head && tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  ) tail++;
  const xm = x.slice(head, x.length - tail);
  const ym = y.slice(head, y.length - tail);

  const w = ym.length + 1;
  const lcs = new Uint32Array((xm.length + 1) * w);
  for (let i = xm.length - 1; i >= 0; i--) {
    for (let j = ym.length - 1; j >= 0; j--) {
      lcs[i * w + j] = xm[i] === ym[j]
        ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const ops: Op[] = x.slice(0, head).map((s) => ({ t: " ", s }));
  let i = 0;
  let j = 0;
  while (i < xm.length || j < ym.length) {
    if (i < xm.length && j < ym.length && xm[i] === ym[j]) {
      ops.push({ t: " ", s: xm[i] });
      i++;
      j++;
    } else if (
      j >= ym.length ||
      (i < xm.length && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])
    ) ops.push({ t: "-", s: xm[i++] });
    else ops.push({ t: "+", s: ym[j++] });
  }
  ops.push(...x.slice(x.length - tail).map((s) => ({ t: " " as const, s })));

  // 바뀐 줄 둘레 context줄을 덩어리로 묶는다.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, k) => {
    if (op.t === " ") return;
    for (
      let m = Math.max(0, k - context);
      m <= Math.min(ops.length - 1, k + context);
      m++
    ) keep[m] = true;
  });
  if (!ops.some((op) => op.t !== " ")) return "";
  const out: string[] = [];
  let la = 1;
  let lb = 1;
  let inHunk = false;
  ops.forEach((op, k) => {
    if (keep[k]) {
      if (!inHunk) out.push(`@@ -${la} +${lb} @@`);
      inHunk = true;
      out.push(op.t + op.s);
    } else inHunk = false;
    if (op.t !== "+") la++;
    if (op.t !== "-") lb++;
  });
  return out.join("\n");
}

async function contentDiff(
  a: VersionRef,
  b: VersionRef,
  registryDir: string,
): Promise<string> {
  const [ea, eb] = await Promise.all([
    readEntries(registryDir, a.kind, a.name),
    readEntries(registryDir, b.kind, b.name),
  ]);
  const x = ea.find((e) => e.n === a.n);
  const y = eb.find((e) => e.n === b.n);
  if (x?.content === undefined || y?.content === undefined) {
    return "내용 없음 (registry에 없다)";
  }
  const fa = contentFiles(x);
  const fb = contentFiles(y);
  const blocks: string[] = [];
  for (
    const path of [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()
  ) {
    const d = lineDiff(fa[path] ?? "", fb[path] ?? "");
    if (d !== "") {
      blocks.push(
        `${path === "" ? "" : `\`${path}\`\n`}\`\`\`diff\n${d}\n\`\`\``,
      );
    }
  }
  return blocks.join("\n\n") || "같다";
}

async function componentSection(
  a: RunRecord,
  b: RunRecord,
  registryDir: string,
): Promise<string[]> {
  const key = (r: VersionRef) => `${r.kind}:${r.name}`;
  const ma = new Map(a.components.map((c) => [key(c), c]));
  const mb = new Map(b.components.map((c) => [key(c), c]));
  const lines: string[] = [];
  for (const k of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    const x = ma.get(k);
    const y = mb.get(k);
    if (x === undefined || y === undefined) {
      lines.push(`- ${refText((x ?? y)!)}: ${x === undefined ? "b" : "a"}에만`);
      continue;
    }
    if (x.n === y.n) continue;
    lines.push(`### ${k}@${x.n} → @${y.n}`, "");
    if (TEXT_KINDS.includes(x.kind)) {
      lines.push(await contentDiff(x, y, registryDir));
    } else {
      lines.push(
        `내용은 git에 있다: ${a.source.commit}..${b.source.commit}` +
          (a.source.dirty || b.source.dirty
            ? " (working tree에서 고쳐 돌린 run이다. source.dirty와 diff는 .dev-data/eval/<run id>/의 전체 기록에 있다)"
            : ""),
      );
    }
    lines.push("");
  }
  return lines.length > 0 ? lines : ["같다"];
}

function checkSection(a: RunRecord, b: RunRecord): string[] {
  const tally = (r: RunRecord) => {
    const m = new Map<string, { passed: number; of: number }>();
    for (const t of r.trials) {
      for (const c of t.checks) {
        const v = m.get(c.id) ?? { passed: 0, of: 0 };
        v.of += 1;
        if (c.pass) v.passed += 1;
        m.set(c.id, v);
      }
    }
    return m;
  };
  const ta = tally(a);
  const tb = tally(b);
  const text = (v?: { passed: number; of: number }) =>
    v === undefined ? "-" : `${v.passed}/${v.of}`;
  const verdicts = (r: RunRecord, id: string) =>
    r.trials.flatMap((t) => t.judge).filter((j) => j.check === id).map((j) =>
      j.state === "pending"
        ? "대기"
        : `${j.verdict ?? "error"}(${j.model ?? "-"})`
    );
  const lines = ["| check | a | b | |", "|---|---|---|---|"];
  for (const id of new Set([...ta.keys(), ...tb.keys()])) {
    const sa = text(ta.get(id));
    const sb = text(tb.get(id));
    lines.push(`| ${id} | ${sa} | ${sb} | ${sa === sb ? "" : "달라짐"} |`);
  }
  const judgeIds = new Set(
    [a, b].flatMap((r) => r.trials.flatMap((t) => t.judge.map((j) => j.check))),
  );
  if (judgeIds.size > 0) {
    lines.push("", "judge verdict");
    for (const id of judgeIds) {
      lines.push(
        `- ${id}: ${verdicts(a, id).join(", ") || "-"} → ${
          verdicts(b, id).join(", ") || "-"
        }`,
      );
    }
  }
  return lines;
}

function metricsSection(a: RunRecord, b: RunRecord): string[] {
  const ma = sumMetrics(a.trials.map((t) => t.metrics));
  const mb = sumMetrics(b.trials.map((t) => t.metrics));
  const rows: [string, number | null, number | null][] = [
    ["tokens.input", ma.tokens.input, mb.tokens.input],
    ["tokens.output", ma.tokens.output, mb.tokens.output],
    ["tokens.cache_read", ma.tokens.cache_read, mb.tokens.cache_read],
    ["tokens.cache_write", ma.tokens.cache_write, mb.tokens.cache_write],
    ["input_total", ma.input_total, mb.input_total],
    ["cache_hit_rate", ma.cache_hit_rate, mb.cache_hit_rate],
    ["cost_usd", ma.cost_usd, mb.cost_usd],
    ["time_ms.turns", ma.time_ms.turns, mb.time_ms.turns],
    ["time_ms.model_calls", ma.time_ms.model_calls, mb.time_ms.model_calls],
    ...(
      [
        "counted",
        "format",
        "success",
        "blocked",
        "repeated_calls",
        "max_repeat",
        "repeated_failure_turns",
      ] as const
    ).map((k): [string, number, number] => [
      `tools.${k}`,
      ma.tools[k],
      mb.tools[k],
    ]),
    ["truncated_calls", ma.truncated_calls, mb.truncated_calls],
    ["agent_calls", ma.agent_calls.length, mb.agent_calls.length],
  ];
  const num = (v: number | null) =>
    v === null ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(4);
  const lines: string[] = [];
  if (a.trials.length !== b.trials.length) {
    lines.push(`trial 수: ${a.trials.length} | ${b.trials.length}`, "");
  }
  lines.push("| 수치 | a | b | 차 |", "|---|---|---|---|");
  for (const [name, x, y] of rows) {
    lines.push(
      `| ${name} | ${num(x)} | ${num(y)} | ${
        x === null || y === null ? "-" : num(y - x)
      } |`,
    );
  }
  return lines;
}

// 다른 model이 채점한 run은 grader가 달라 따로 보인다.
function judgeModelChange(a: RunRecord, b: RunRecord): string[] {
  const models = (r: RunRecord) =>
    [
      ...new Set(
        r.trials.flatMap((t) => t.judge).map((j) => j.model ?? "대기"),
      ),
    ].sort().join(", ");
  const [x, y] = [models(a), models(b)];
  return x === y ? [] : [`judge model ${x || "-"} / ${y || "-"}`];
}

export async function diffRuns(
  a: RunRecord,
  b: RunRecord,
  deps: { registryDir: string },
): Promise<string> {
  const sameScenario = a.scenario.name === b.scenario.name &&
    a.scenario.n === b.scenario.n;
  const other = [
    ...versionChanges("materials", a.materials, b.materials),
    ...versionChanges("core", [a.core], [b.core]),
    ...versionChanges("criterion", a.grader.criteria, b.grader.criteria),
    ...versionChanges(
      "judge",
      a.grader.judge === null ? [] : [a.grader.judge],
      b.grader.judge === null ? [] : [b.grader.judge],
    ),
    ...versionChanges("checks", [a.grader.checks], [b.grader.checks]),
    ...(a.model === b.model ? [] : [`model ${a.model} → ${b.model}`]),
    ...judgeModelChange(a, b),
  ];
  return [
    `# diff ${a.id} → ${b.id}`,
    "",
    sameScenario
      ? `시나리오: ${a.scenario.name}@${a.scenario.n}`
      : `시나리오가 다르다: ${a.scenario.name}@${a.scenario.n} / ${b.scenario.name}@${b.scenario.n}`,
    "",
    "## component",
    "",
    ...(await componentSection(a, b, deps.registryDir)),
    "",
    "## 재료와 core",
    "",
    ...(other.length > 0 ? other.map((l) => `- ${l}`) : ["같다"]),
    "",
    "## check",
    "",
    ...checkSection(a, b),
    "",
    "## 수치",
    "",
    ...metricsSection(a, b),
    "",
  ].join("\n");
}
