// 돌리는 agent가 채점 대기를 보고 verdict를 적는 입구.
//   deno task eval:judge <run>                          대기 목록
//   deno task eval:judge <run> show <key>               subagent에게 줄 전문
//   deno task eval:judge <run> set <key> --model <name> stdin의 JSON {"verdict", "quote"}를 기록
// 종료 코드: 0 정상, 1 없는 run·key나 덮기 거절, 2 인자 오류.
import { stat } from "node:fs/promises";
import process from "node:process";
import { loadJudgeDefinition } from "./definition.ts";
import { foldRun } from "./fold.ts";
import { canRegrade, gradeItem } from "./grade.ts";
import { readPending, rewritePending } from "./pending.ts";
import { renderForAgent } from "./show.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const EVAL_DIR = `${ROOT}/.dev-data/eval`;
const RUNS_DIR = `${ROOT}/tests/eval/runs`;

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

const [run, command, key, ...rest] = process.argv.slice(2);
if (run === undefined) {
  fail(2, "usage: eval:judge <run> [show <key> | set <key> --model <name>]");
}
const known = await Promise.all(
  [`${EVAL_DIR}/${run}`, `${RUNS_DIR}/${run}.json`].map((p) =>
    stat(p).then(
      () => true,
      () => false,
    ),
  ),
);
if (!known.some(Boolean)) fail(1, `not_found: 모르는 run ${run}`);
const entries = await readPending(EVAL_DIR, run);

if (command === undefined) {
  for (const e of entries) {
    const state =
      e.item.state === "pending"
        ? "대기"
        : e.item.state === "error"
          ? "오류"
          : "채점됨";
    console.log(
      `${e.key}\t${e.kind}\t${e.item.check}\t${e.criterion.name}@${e.criterion.n}\t${state}`,
    );
  }
  process.exit(0);
}

if ((command !== "show" && command !== "set") || key === undefined) {
  fail(2, "usage: eval:judge <run> [show <key> | set <key> --model <name>]");
}
const entry = entries.find((e) => e.key === key);
if (entry === undefined) fail(1, `not_found: ${run}에 ${key}가 없다`);

if (command === "show") {
  console.log(renderForAgent(await loadJudgeDefinition(), entry));
  process.exit(0);
}

const flag = rest.indexOf("--model");
const model = flag >= 0 ? rest[flag + 1] : undefined;
if (model === undefined || model === "") fail(2, "--model <name>이 필요하다");
let answer: { verdict?: unknown; quote?: unknown };
try {
  const decoder = new TextDecoder();
  let input = "";
  for await (const chunk of process.stdin) {
    input += decoder.decode(chunk as Uint8Array, { stream: true });
  }
  input += decoder.decode();
  answer = JSON.parse(input);
  if (typeof answer !== "object" || answer === null) {
    throw new Error("not object");
  }
} catch {
  fail(2, 'stdin은 JSON {"verdict": "...", "quote": "..."}여야 한다');
}
if (!canRegrade(entry.item)) fail(1, `${key}: 이미 채점됨`);

const item = gradeItem(entry.item, entry.criterion, {
  verdict: answer.verdict,
  quote: answer.quote,
  model,
});
await rewritePending(EVAL_DIR, { ...entry, item });
// 요약이 아직 없으면(runner가 시나리오 끝에 쓴다) 그때 runner가 foldJudge로 합친다.
await foldRun({ evalDir: EVAL_DIR, runsDir: RUNS_DIR, run });
console.log(
  item.error === null
    ? `${key}: ${item.verdict} (인용 ${item.quote_found ? "있음" : "없음"})`
    : `${key}: 오류 ${item.error}`,
);
