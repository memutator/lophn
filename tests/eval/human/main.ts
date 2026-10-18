// 돌리는 agent가 답 대기를 보고 사람 역할의 답을 적는 입구.
//   deno task eval:answer <run>                          대기 목록
//   deno task eval:answer <run> show <key>               subagent에게 줄 전문
//   deno task eval:answer <run> set <key> --model <name> stdin의 JSON string[][]를 기록
// core에는 닿지 않는다. 답은 trial을 쥔 runner가 askAnswer로 넣는다.
// 종료 코드: 0 정상, 1 없는 run·key나 덮기 거절, 2 인자 오류.
import { systemClock } from "../../../packages/base/mod.ts";
import { loadHumanDefinition } from "./definition.ts";
import { readQuestions, writeGivenAnswer } from "./pending.ts";
import { renderForAgent } from "./show.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const EVAL_DIR = `${ROOT}/.dev-data/eval`;
const USAGE =
  "usage: eval:answer <run> [show <key> | set <key> --model <name>]";

function fail(code: number, message: string): never {
  console.error(message);
  Deno.exit(code);
}

const [run, command, key, ...rest] = Deno.args;
if (run === undefined) fail(2, USAGE);
const known = await Deno.stat(`${EVAL_DIR}/${run}`).then(
  () => true,
  () => false,
);
if (!known) fail(1, `not_found: 모르는 run ${run}`);
const entries = await readQuestions(EVAL_DIR, run);

if (command === undefined) {
  for (const e of entries) {
    const first = e.question.questions[0]?.question.split("\n")[0] ?? "";
    console.log(`${e.question.key}\t${e.answered ? "답함" : "대기"}\t${first}`);
  }
  Deno.exit(0);
}

if ((command !== "show" && command !== "set") || key === undefined) {
  fail(2, USAGE);
}
const entry = entries.find((e) => e.question.key === key);
if (entry === undefined) fail(1, `not_found: ${run}에 ${key}가 없다`);

if (command === "show") {
  console.log(renderForAgent(await loadHumanDefinition(), entry.question));
  Deno.exit(0);
}

const flag = rest.indexOf("--model");
const model = flag >= 0 ? rest[flag + 1] : undefined;
if (model === undefined || model === "") fail(2, "--model <name>이 필요하다");
const need = entry.question.questions.length;
let selected: string[][];
try {
  selected = JSON.parse(
    new TextDecoder().decode(await new Response(Deno.stdin.readable).bytes()),
  );
  if (
    !Array.isArray(selected) ||
    !selected.every((s) =>
      Array.isArray(s) && s.every((v) => typeof v === "string")
    )
  ) throw new Error("not string[][]");
} catch {
  fail(2, `stdin은 JSON string[][]여야 한다(질문 ${need}개, 배열 ${need}개)`);
}
if (selected.length !== need) {
  fail(
    2,
    `질문이 ${need}개라 배열이 ${need}개 필요하다(받은 것 ${selected.length}개)`,
  );
}
try {
  await writeGivenAnswer(EVAL_DIR, run, key, {
    model,
    answered_at: systemClock.now(),
    selected,
  });
} catch (e) {
  if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
  fail(1, `${key}: 이미 답함. runner가 넣기 전이거나 넣는 중이다`);
}
console.log(`${key}: 기록`);
