// Issues 상세가 사용자용 GetProblem만 읽는지(problems#T22). contract의 사용자용 output을 그대로 통과한
// 값을 화면 값으로 옮기고, 그 결과에 ticket·version ID가 남지 않는지 본다.
import { assert, assertEquals } from "@std/assert";

import {
  getProblemOutputSchema,
  getProblemUserOutputSchema,
  userProblemReadOf,
} from "../../../../../../packages/protocol/problems/mod.ts";
import { issueViewOf } from "./core-read.ts";

const PRB = "prb_01h455vb4pex5v6nkc6gd5fd01";
const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const TKT = "tkt_01h455vb4pex5v6nkc6gd5fd01";
const VER = "ver_01h455vb4pex5v6nkc6gd5fd01";
const REL = "rel_01h455vb4pex5v6nkc6gd5fd01";

Deno.test("problems#T22 shell/wording#R9: Issues 상세는 detail의 담당·수리·테스트를 읽고 연결 ID를 싣지 않는다", () => {
  const internal = getProblemOutputSchema.parse({
    problem: {
      id: PRB,
      app: APP,
      group_key: { kind: "declared", code: "save_failed", discriminator: null },
      status: "open",
      work: TKT,
      interpretation: { version: VER, section: null },
      closure: null,
      seq: "5",
    },
    detail: {
      progress: { state: "open", label: "Open" },
      owner: { kind: "platform_check", label: "Lophn is checking the fix." },
      needed_action: null,
      repair: {
        state: "checking",
        label: "Checking",
        needs: [],
        last_check_failed: false,
      },
      result: {
        fix_report: "reported",
        fix_report_label: "The fix says it's done.",
        tests: {
          state: "fail",
          label: "A test failed",
          items: [{
            kind: "reproduction",
            state: "fail",
            label: "Reproduction",
            ended_at: "2026-10-07T08:00:00.000Z",
          }],
        },
      },
      closed: null,
    },
    text: "Saving failed.",
    report_count: 3,
    first_observed_at: "2026-10-05T09:00:00.000Z",
    last_observed_at: "2026-10-07T08:00:00.000Z",
    first_release: REL,
    last_release: REL,
    as_of_seq: "5",
    next_cursor: null,
  });
  const user = getProblemUserOutputSchema.parse(userProblemReadOf(internal));
  const view = issueViewOf(user);
  assert(view !== null);
  assertEquals(view.status, "open");
  assertEquals(view.owner, "Lophn is checking the fix.");
  assertEquals(view.repair.label, "Checking");
  assertEquals(view.result.claimed, true);
  assertEquals(view.result.tests.state, "fail");
  assertEquals(view.result.tests.items[0]?.endedAt, "2026-10-07T08:00:00.000Z");
  assertEquals(view.basis, { versionKnown: true, observationKnown: true });
  const text = JSON.stringify(view);
  assert(!text.includes(TKT) && !text.includes(VER), text);
});
