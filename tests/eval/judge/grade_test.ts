// 세 질문
// - contract: 채점은 enum 안의 verdict와 입력에 글자 그대로 있는 인용일 때만 통과로 센다. 정상 채점은 덮이지 않는다.
// - 현실적 회귀: 바꿔 쓴 인용이나 enum 밖의 답이 통과로 세어져 eval 결과를 부풀리는 것. 채점 대기가 통과로 합쳐지는 것.
// - 왜 지금 test로 못 잡나: 이 규칙을 보는 다른 test가 없고, 채점은 돌리는 agent가 CLI로 넣어 사람이 매번 보지 않는다.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCriterion } from "../criteria/mod.ts";
import type { TrialResult } from "../types.ts";
import { loadJudgeDefinition } from "./definition.ts";
import { foldJudge, foldRun } from "./fold.ts";
import { canRegrade, gradeItem, judgePassed, newJudgeItem } from "./grade.ts";
import {
  judgeKey,
  outstanding,
  type PendingJudge,
  writePending,
} from "./pending.ts";

const INPUT =
  "[HUMAN_REQUEST]\nMake a budget app\n\n[CALL_BODY]\nBuild a budget app";
const criterion = await loadCriterion("relay-complete@1");
const pending = newJudgeItem({
  check: "chk",
  criterion,
  input: INPUT,
  judge: await loadJudgeDefinition(),
});

test("a recorded grade passes only with an allowed passing verdict and a verbatim quote", () => {
  const cases: [string, unknown, unknown, string | null, boolean][] = [
    ["verbatim", "all", " Build a budget app ", null, true],
    ["paraphrased", "all", "build a budget app", "quote not in input", false],
    [
      "not allowed",
      "maybe",
      "Build a budget app",
      "verdict not allowed: maybe",
      false,
    ],
    ["no quote", "all", undefined, "no quote", false],
    ["cannot_tell", "cannot_tell", "Build a budget app", null, false],
  ];
  for (const [name, verdict, quote, error, passed] of cases) {
    const item = gradeItem(pending, criterion, { verdict, quote, model: "m" });
    assert.deepStrictEqual(item.error, error, name);
    assert.deepStrictEqual(
      item.state,
      error === null ? "judged" : "error",
      name,
    );
    assert.deepStrictEqual(item.model, "m", name);
    assert.deepStrictEqual(judgePassed(criterion, item), passed, name);
  }
  assert.deepStrictEqual(pending.state, "pending");
  assert.ok(!judgePassed(criterion, pending));
});

test("foldJudge merges recorded grades into the trial, keeps waiting ones pending, and only errors can be regraded", () => {
  const other = { ...pending, check: "other" };
  const good = gradeItem(pending, criterion, {
    verdict: "all",
    quote: "Build a budget app",
    model: "m",
  });
  const trials = [
    {
      index: 1,
      checks: [
        {
          id: "chk",
          kind: "judge",
          pass: false,
          pending: true,
          reason: "채점 대기",
        },
        {
          id: "other",
          kind: "judge",
          pass: false,
          pending: true,
          reason: "채점 대기",
        },
      ],
      judge: [pending, other],
    },
  ] as unknown as TrialResult[];
  const entry = (item: typeof pending): PendingJudge => ({
    key: judgeKey(1, item.check),
    run: "r",
    trial: 1,
    kind: "check",
    asked_at: "t",
    criterion,
    item,
  });
  const entries = [entry(good), entry(other)];
  const before = JSON.stringify(trials);
  const [t] = foldJudge(trials, entries);

  assert.deepStrictEqual(JSON.stringify(trials), before);
  assert.deepStrictEqual(t.checks[0].pass, true);
  assert.deepStrictEqual(t.checks[0].pending, undefined);
  assert.deepStrictEqual(t.judge[0].verdict, "all");
  assert.deepStrictEqual(t.checks[1].pass, false);
  assert.deepStrictEqual(t.checks[1].pending, true);
  assert.deepStrictEqual(
    outstanding(entries).map((e) => e.key),
    ["t1-other"],
  );

  const bad = gradeItem(pending, criterion, {
    verdict: "all",
    quote: "nope",
    model: "m",
  });
  assert.ok(canRegrade(pending));
  assert.ok(canRegrade(bad));
  assert.ok(!canRegrade(good));
});

test("foldRun writes the summary and the full record only when they exist, and a pending entry is never overwritten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-eval-"));
  try {
    const evalDir = `${dir}/eval`;
    const runsDir = `${dir}/runs`;
    const good = gradeItem(pending, criterion, {
      verdict: "all",
      quote: "Build a budget app",
      model: "m",
    });
    const entry: PendingJudge = {
      key: judgeKey(1, "chk"),
      run: "r",
      trial: 1,
      kind: "check",
      asked_at: "t",
      criterion,
      item: good,
    };
    await writePending(evalDir, entry);
    await assert.rejects(() => writePending(evalDir, entry));
    const args = { evalDir, runsDir, run: "r" };
    assert.deepStrictEqual(await foldRun(args), false);

    await mkdir(runsDir);
    const trial = {
      index: 1,
      checks: [
        {
          id: "chk",
          kind: "judge",
          pass: false,
          pending: true,
          reason: "",
        },
      ],
      judge: [pending],
    };
    await writeFile(`${runsDir}/r.json`, JSON.stringify({ trials: [trial] }));
    await writeFile(
      `${evalDir}/r/trial-1.json`,
      JSON.stringify({ judge: [pending] }),
    );
    assert.deepStrictEqual(await foldRun(args), true);
    const summary = JSON.parse(await readFile(`${runsDir}/r.json`, "utf8"));
    assert.deepStrictEqual(summary.trials[0].checks[0].pass, true);
    const full = JSON.parse(
      await readFile(`${evalDir}/r/trial-1.json`, "utf8"),
    );
    assert.deepStrictEqual(full.judge[0].state, "judged");
  } finally {
    await rm(dir, { recursive: true });
  }
});
