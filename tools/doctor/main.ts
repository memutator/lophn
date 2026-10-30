// lophn 개발 환경 self-diagnosis. 실행: npm run doctor [--fix]
// check는 선언 순서대로 찍고, 동시에 돈다. FAIL이 하나라도 있으면 exit 1.
// --fix는 안전하게 되돌릴 수 있는 fix(sudo·network·설치가 아닌 것)만 직접 고치고 그 check를 다시 돈다.
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checks } from "./checks.ts";
import { createCtx } from "./ctx.ts";
import { applyFixes, type CheckResult, runChecks } from "./runner.ts";
import type { Status } from "./types.ts";

const USAGE =
  "실행: npm run doctor [--fix]\n" +
  "  --fix: auto-fix가 있는 결과를 직접 고치고 그 check를 다시 돈다";

const LABELS: Record<Status, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
};
const MARKS: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗" };
const COLORS: Record<Status, string> = {
  pass: "32",
  warn: "33",
  fail: "31",
};

function paint(color: string, text: string): string {
  return `\x1b[${color}m${text}\x1b[0m`;
}

function printResult(result: CheckResult, color: boolean): void {
  const { status, detail, fix } = result.outcome;
  const label = `${LABELS[status]} [${MARKS[status]}]`;
  const suffix = result.applied
    ? result.fixed
      ? " (fixed)"
      : " (fix 적용)"
    : "";
  const head = color ? paint(COLORS[status], label) : label;
  console.log(`${head} ${result.check.title} — ${detail}${suffix}`);
  if (fix !== undefined && status !== "pass") {
    console.log(`  fix: ${fix.command}`);
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = args.filter((arg) => arg !== "--fix" && arg !== "--help");
  if (unknown.length > 0) {
    console.error(`모르는 인자: ${unknown.join(" ")}\n${USAGE}`);
    return 2;
  }
  const root = fileURLToPath(new URL("../..", import.meta.url)).replace(
    /\/$/,
    "",
  );
  const ctx = createCtx(root);
  const results = await runChecks(checks, ctx);
  if (args.includes("--fix")) await applyFixes(results, ctx);
  // TTY가 아니거나 NO_COLOR가 있으면 색을 쓰지 않는다(log·CI).
  const color =
    process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
  for (const result of results) printResult(result, color);
  const counts: Record<Status, number> = { pass: 0, warn: 0, fail: 0 };
  for (const result of results) counts[result.outcome.status] += 1;
  const summary = `${results.length} checks: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail`;
  console.log(
    color ? paint(counts.fail === 0 ? "32" : "31", summary) : summary,
  );
  return counts.fail > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
