import type { AskQuestion } from "../../../packages/protocol/lophn-agent/ask-tool.ts";
import type { EarlierAnswer } from "./answers.ts";

export type PendingQuestion = {
  key: string;
  run: string;
  trial: number;
  session: string;
  tool_call: string;
  asked_at: string;
  card: string; // 시나리오의 요구 카드
  earlier: EarlierAnswer[]; // 이 trial에서 앞서 한 답. 질문을 쓸 때의 값이다
  questions: AskQuestion[];
};

// 돌리는 agent가 적는 답. 질문마다 선택한 값의 배열이다.
export type GivenAnswer = {
  model: string;
  answered_at: string;
  selected: string[][];
};

export function questionKey(trial: number, toolCall: string): string {
  return `t${trial}-${toolCall}`;
}

const folder = (evalDir: string, run: string) => `${evalDir}/${run}/questions`;
const questionPath = (evalDir: string, run: string, key: string) =>
  `${folder(evalDir, run)}/${key}.json`;
const answerPath = (evalDir: string, run: string, key: string) =>
  `${folder(evalDir, run)}/${key}.answer.json`;

const text = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

const missing = (e: unknown) => e instanceof Deno.errors.NotFound;

// 같은 질문을 덮지 않는다.
export async function writeQuestion(
  evalDir: string,
  entry: PendingQuestion,
): Promise<void> {
  await Deno.mkdir(folder(evalDir, entry.run), { recursive: true });
  await Deno.writeTextFile(
    questionPath(evalDir, entry.run, entry.key),
    text(entry),
    { createNew: true },
  );
}

export async function readQuestions(
  evalDir: string,
  run: string,
): Promise<{ question: PendingQuestion; answered: boolean }[]> {
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(folder(evalDir, run))) {
      if (e.isFile) names.push(e.name);
    }
  } catch (e) {
    if (!missing(e)) throw e;
    return [];
  }
  const out: { question: PendingQuestion; answered: boolean }[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json") || name.endsWith(".answer.json")) continue;
    out.push({
      question: JSON.parse(
        await Deno.readTextFile(`${folder(evalDir, run)}/${name}`),
      ),
      answered: names.includes(name.replace(/\.json$/, ".answer.json")),
    });
  }
  return out;
}

// 이미 답이 있으면 던진다. runner가 넣기 전이거나 넣는 중이다.
export async function writeGivenAnswer(
  evalDir: string,
  run: string,
  key: string,
  given: GivenAnswer,
): Promise<void> {
  await Deno.writeTextFile(answerPath(evalDir, run, key), text(given), {
    createNew: true,
  });
}

export async function readGivenAnswer(
  evalDir: string,
  run: string,
  key: string,
): Promise<GivenAnswer | null> {
  try {
    return JSON.parse(await Deno.readTextFile(answerPath(evalDir, run, key)));
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

// 거절된 답을 지워 agent가 다시 답하게 한다.
export async function removeGivenAnswer(
  evalDir: string,
  run: string,
  key: string,
): Promise<void> {
  try {
    await Deno.remove(answerPath(evalDir, run, key));
  } catch (e) {
    if (!missing(e)) throw e;
  }
}
