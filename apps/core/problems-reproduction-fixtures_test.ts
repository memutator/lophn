// 깨지는 앱 fixture의 이전·고친 판(apps#T26 완료 9번의 판 A–E)으로 problems reproduction test를 실제 runner 경로로
// 돌린다(problems#T18). fake driver가 아니다: 판마다 source commit → 봉인 bundle을 만들고, runner를 core
// launch spec의 권한 flag 그대로 띄워 before·after를 새 fixture DB에서 실제 앱 자식·broker·요청별 Deno test 자식으로
// 돌린 뒤, 판정을 core ledger의 RecordVerification으로 남겨 읽는다. 사람 데이터 root(~/.lophn,
// ~/.config/lophn)는 열지 않고 temp lophn home만 쓴다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { installedHome } from "../../packages/core/apps/packages/testing/mod.ts";
import {
  type MadeFixture,
  madeFixture,
  type SealedBundle,
  sealedBundle,
  variantBundle,
} from "./testing/problems-app-test.ts";
import {
  recordReproductionThroughCore,
  type ReproductionOutcome,
  runReproduction,
} from "./testing/problems-reproduction.ts";

type Board = "A" | "B" | "C" | "D" | "E";

async function sealBoard(
  made: MadeFixture,
  mode: Board,
): Promise<SealedBundle> {
  const file = `${made.dir}/src/board.ts`;
  const text = await Deno.readTextFile(file);
  const patched = text.replace(
    /export const MODE: BoardMode = "[A-E]";/,
    `export const MODE: BoardMode = "${mode}";`,
  );
  assert(patched.includes(`BoardMode = "${mode}";`));
  await Deno.writeTextFile(file, patched);
  return await sealedBundle(made);
}

function assertBothSidesRan(outcome: ReproductionOutcome): void {
  const { executions, not_started } = outcome.result;
  assertEquals(not_started, null);
  assertEquals(executions.map((item) => item.side), ["before", "after"]);
  for (const side of executions) {
    assertEquals(side.end_reason, "exited", side.output_tail);
    assertEquals(side.exit_code, 0, side.output_tail);
    // 모든 접수는 이 요청의 test scope로 갔다(운영 문제에 묶이지 않는다, R15).
    for (const item of side.forwarded) {
      assert(item.scope.startsWith("reproduction-"), item.scope);
    }
  }
}

Deno.test(
  "problems/tests#R10 R11 R12 R15: 깨지는 앱 판 A→B pass, A→D fail, A→C·A→E inconclusive가 실제 runner 경로로 나와 RecordVerification으로 읽힌다",
  async (t) => {
    const made = await madeFixture("broken", await installedHome([]));
    try {
      const boards = new Map<Board, SealedBundle>();
      for (const mode of ["A", "B", "C", "D", "E"] as const) {
        boards.set(mode, await sealBoard(made, mode));
      }
      const board = (mode: Board) => boards.get(mode)!;
      assertEquals(
        new Set([...boards.values()].map((b) => b.bundleHash)).size,
        5,
      );
      const outcomes = new Map<string, ReproductionOutcome>();
      const run = async (before: Board, after: Board) => {
        const outcome = await runReproduction(
          made,
          board(before),
          board(after),
          { key: `reproduction-${before}-${after}` },
        );
        outcomes.set(`${before}-${after}`, outcome);
        return outcome;
      };

      await t.step(
        "A 깨짐 → B 고침은 pass이고 side마다 새 fixture DB·읽기 전용 source·같은 FrozenTest다 (R10, R15)",
        async () => {
          const outcome = await run("A", "B");
          assertBothSidesRan(outcome);
          const { judgment, executions } = outcome.result;
          assertEquals(judgment.result, "pass", judgment.reason);
          // 같은 FrozenTest hash가 양쪽 frame에 있다(runner가 hash 불일치를 판정 불가로 본다).
          assertEquals(
            executions.map((item) => item.bundle_hash),
            [board("A").bundleHash, board("B").bundleHash],
          );
          // side마다 새 fixture 폴더이고 source에는 쓸 수 없다.
          const dirs = executions.map((item) => item.isolation.fixture_dir);
          assertNotEquals(dirs[0], dirs[1]);
          for (const side of executions) {
            assert(side.isolation.fresh_fixture);
            assert(side.isolation.source_read_only);
          }
          const read = await recordReproductionThroughCore(
            board("A"),
            board("B"),
            outcome,
          );
          assertEquals(read.result, "pass");
          assertEquals(read.kind, "reproduction");
          assertEquals(read.target_bundle, board("B").bundleHash);
          assertEquals(read.test, outcome.test_hash);
          assertEquals(
            read.sides.map((item) => item.bundle_hash),
            [board("A").bundleHash, board("B").bundleHash],
          );
          assertEquals(read.observations.length, 64);
        },
      );

      await t.step(
        "A → B의 observations는 원래 증상·변경 후 기대·인접 불변식이 따로이고 외부 효과는 invocation 참조뿐이다 (R12)",
        () => {
          const { observations } = outcomes.get("A-B")!.result.judgment;
          assertEquals(
            observations.original_symptom.before?.symptom_reproduced,
            true,
          );
          assertEquals(
            observations.original_symptom.after?.symptom_reproduced,
            false,
          );
          assertEquals(observations.changed_expectation.sides.after?.met, true);
          assertEquals(
            observations.adjacent_invariants.map((item) => [
              item.side,
              item.name,
              item.held,
            ]),
            [["before", "mark_kind", true], ["after", "mark_kind", true]],
          );
          assertEquals(observations.weakening.found, []);
          const refs = observations.external_effects.invocations;
          // 기록된 호출(실패한 before의 호출)만 참조로 남고 내용은 observations에 없다.
          assertEquals(refs.map((item) => item.side), ["before"]);
          for (const item of refs) {
            assertEquals(Object.keys(item).sort(), ["invocation", "side"]);
            assert(item.invocation.startsWith("inv_"));
            assertNotEquals(item.invocation, "inv_not_recorded");
          }
          // 격리 사실(R15): 운영 DB 복사와 실계정 재전송이 없고 side마다 새 fixture DB·읽기 전용 source다.
          const { isolation } = observations;
          assertEquals(isolation.operating_db_copied, false);
          assertEquals(isolation.real_account_resend, false);
          assertEquals(
            isolation.sides.map((item) => [
              item.side,
              item.fresh_fixture,
              item.source_read_only,
            ]),
            [["before", true, true], ["after", true, true]],
          );
        },
      );

      await t.step("A → D 여전히 깨짐은 fail이다 (R10)", async () => {
        const outcome = await run("A", "D");
        assertBothSidesRan(outcome);
        const { judgment } = outcome.result;
        assertEquals(judgment.result, "fail", judgment.reason);
        assertEquals(
          judgment.observations.original_symptom.after?.symptom_reproduced,
          true,
        );
        const read = await recordReproductionThroughCore(
          board("A"),
          board("D"),
          outcome,
        );
        assertEquals(read.result, "fail");
      });

      await t.step(
        "A → C 약화(보고 경로 삭제)는 inconclusive와 약화 이유다 (R11, problem-codes#R10)",
        async () => {
          const outcome = await run("A", "C");
          assertBothSidesRan(outcome);
          const { judgment } = outcome.result;
          assertEquals(judgment.result, "inconclusive", judgment.reason);
          const after = judgment.observations.original_symptom.after!;
          // 업무 증상은 그대로인데 원래 problem code 보고가 사라졌다.
          assertEquals(after.failure_present, true);
          assertEquals(after.report_seen, false);
          assert(judgment.observations.weakening.found.length >= 1);
          assert(judgment.reason.includes("보고 경로 삭제"), judgment.reason);
          const read = await recordReproductionThroughCore(
            board("A"),
            board("C"),
            outcome,
          );
          assertEquals(read.result, "inconclusive");
        },
      );

      await t.step("A → E 다른 실패는 inconclusive다 (R10)", async () => {
        const outcome = await run("A", "E");
        assertBothSidesRan(outcome);
        const { judgment } = outcome.result;
        assertEquals(judgment.result, "inconclusive", judgment.reason);
        const after = judgment.observations.original_symptom.after!;
        assertEquals(after.symptom_reproduced, false);
        assertEquals(after.expectation_met, false);
        assertEquals(judgment.observations.weakening.found, []);
        const read = await recordReproductionThroughCore(
          board("A"),
          board("E"),
          outcome,
        );
        assertEquals(read.result, "inconclusive");
      });

      await t.step(
        "B → B처럼 before도 통과하면 inconclusive다 (R10)",
        async () => {
          const outcome = await run("B", "B");
          assertBothSidesRan(outcome);
          const { judgment } = outcome.result;
          assertEquals(judgment.result, "inconclusive", judgment.reason);
          assert(judgment.reason.includes("before도"), judgment.reason);
        },
      );

      await t.step(
        "고친 묶음이 원래 problem code 선언을 지우면 inconclusive와 약화 이유다 (R11, problem-codes#R10)",
        async () => {
          const removed = await variantBundle(made, board("B"), {
            name: "problem-code-removed",
            requirement: "problems/problem-codes#R10",
            base: "broken",
            patch: [{
              file: "blueprint.json",
              from: '"code":"fixture_broken"',
              to: '"code":"fixture_gone"',
            }],
            expect_fail: [],
          });
          assertNotEquals(removed.bundleHash, board("B").bundleHash);
          const outcome = await runReproduction(made, board("A"), removed, {
            key: "reproduction-A-code-removed",
          });
          assertBothSidesRan(outcome);
          const { judgment } = outcome.result;
          assertEquals(judgment.result, "inconclusive", judgment.reason);
          assert(judgment.reason.includes("선언"), judgment.reason);
          assertEquals(
            judgment.observations.weakening.checks.find((item) =>
              item.name === "problem_code_kept"
            )?.status,
            "weakened",
          );
        },
      );

      await t.step(
        "after 묶음을 시작하지 못하면 before의 실행과 미시작 이유만 남아 inconclusive다 (R10)",
        async () => {
          const missing: SealedBundle = {
            path: `${made.home}/missing-after-bundle`,
            bundleHash: "c".repeat(64),
            blueprintHash: "d".repeat(64),
          };
          const outcome = await runReproduction(made, board("A"), missing, {
            key: "reproduction-A-missing",
          });
          const { judgment, executions, not_started } = outcome.result;
          assertEquals(executions.map((item) => item.side), ["before"]);
          assertEquals(not_started?.side, "after");
          assert(not_started!.reason.length > 0);
          assertEquals(judgment.result, "inconclusive");
          assertEquals(
            judgment.observations.execution_not_started,
            not_started,
          );
          const read = await recordReproductionThroughCore(
            board("A"),
            missing,
            outcome,
          );
          assertEquals(read.result, "inconclusive");
          assertEquals(read.sides.map((item) => item.side), ["before"]);
        },
      );
    } finally {
      await made.dispose();
    }
  },
);
