// 제품 core가 feedback과 view 오류를 collector로 서빙하는지 본다(problems#T5가 받은 T15·shell#T52·
// T16의 넘어온 것). 주입한 collector 없이 제품 main과 같은 감독으로 core를 띄우고 shell main이
// 부르는 모양 그대로 보낸다: user credential, JSON worker 호출, 선택한 PNG는 upload 머리와
// octet-stream body. view 오류의 binding은 그 core의 signer가 서명한 연결이다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  APP_A,
  AT,
  intake,
  pngBytes,
  rpt,
  sha256,
  view,
} from "../../packages/problems/feedback/testing/mod.ts";
import { startCore } from "./core.ts";
import { problemsReportDefinitions } from "./problems.ts";

const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0);
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const BUNDLE = "a".repeat(64);

// shell main이 받는 user credential이다(core/parent.ts greet과 같은 actor·process).
const shellUser: AuthenticatedContext = {
  principal: "user",
  actor: "user",
  scope: {
    operations: ["SubmitFeedback", "ObserveViewError", "GetSnapshot"],
    targets: {},
  },
  conditions: { process: "electron-main" },
  credential_ref: "cred-feedback-product",
};

function base64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

Deno.test("problems/feedback#R1 R6 R10, reporting#R6: 제품처럼 띄운 core는 주입 없이 collector로 submit-feedback(글만, PNG)과 observe-view-error를 접수한다", async (t) => {
  const home = await Deno.makeTempDir({ prefix: "lophn-feedback-product-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ problemsReportDefinitions }],
    teamModules: [new URL("./problems.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    const token = "f".repeat(43);
    assert(core.acceptTestCredential);
    assert((await core.acceptTestCredential(shellUser, token)).ok);
    assert((await core.record(shellUser)).ok);
    const url = (method: string) =>
      `http://127.0.0.1:${core.port}/v1/problems/${method}`;
    // collector child가 뜨기 전에는 unavailable(503)이다. 한도 안에서 뜨기를 기다린다.
    const send = async (make: () => Promise<Response>) => {
      let response = await make();
      const deadline = Date.now() + 30_000;
      while (response.status === 503 && Date.now() < deadline) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 250));
        response = await make();
      }
      return response;
    };
    const json = (method: string, body: unknown) => () =>
      fetch(url(method), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    let firstProblem = "";

    await t.step("submit-feedback: 글만 보내면 접수한다", async () => {
      const { screenshot: _none, ...rest } = intake({ report_id: rpt(1) });
      const response = await send(
        json("submit-feedback", { ...rest, screenshot: null }),
      );
      const body = await response.json();
      assertEquals(response.status, 200, JSON.stringify(body));
      assertEquals(body.report, rpt(1));
      assert(typeof body.problem === "string");
      firstProblem = body.problem;
    });

    await t.step(
      "submit-feedback: 선택한 PNG는 upload 머리와 octet-stream body로 접수한다",
      async () => {
        const png = pngBytes(800, 600, 4096);
        const input = {
          ...intake({
            report_id: rpt(2),
            selection: { screen: false, screenshot: true },
            view: view({ final_screenshot_hash: await sha256(png) }),
          }),
          screenshot: { size_bytes: png.length },
        };
        const response = await send(() =>
          fetch(url("submit-feedback"), {
            method: "POST",
            headers: {
              "content-type": "application/octet-stream",
              "x-lophn-input": base64Url(JSON.stringify(input)),
              authorization: `Bearer ${token}`,
            },
            body: png as Uint8Array<ArrayBuffer>,
          })
        );
        const body = await response.json();
        assertEquals(response.status, 200, JSON.stringify(body));
        assertEquals(body.report, rpt(2));
        // 저장된 이미지의 hash는 보낸 바이트의 hash다. 저장하지 않은 hash를 적지 않는다.
        const read = await send(
          json("get-snapshot", { snapshot: body.snapshot }),
        );
        const stored = await read.json();
        assertEquals(read.status, 200, JSON.stringify(stored));
        assertEquals(stored.snapshot.screen.screenshot, await sha256(png));
      },
    );

    await t.step(
      "submit-feedback: 선택한 기존 문제는 collector가 읽어 같은 문제로 묶는다",
      async () => {
        const { screenshot: _none, ...rest } = intake({
          report_id: rpt(3),
          existing_problem: firstProblem as `prb_${string}`,
        });
        const response = await send(
          json("submit-feedback", { ...rest, screenshot: null }),
        );
        const body = await response.json();
        assertEquals(response.status, 200, JSON.stringify(body));
        assertEquals(body.problem, firstProblem);
      },
    );

    await t.step(
      "observe-view-error: core가 서명한 binding의 view 오류를 접수한다",
      async () => {
        assert(core.appsControl);
        const signed = await core.appsControl.signer.signConnection({
          app: APP_A,
          release: RELEASE,
          bundle_hash: BUNDLE,
          mode: "live",
          process_nonce: "nonce-1",
          actor: `app:${APP_A}`,
          credential_ref: "view-connection",
          screens: ["main"],
          screen_sizes: { main: ["full"] },
          caller: null,
          commands: [],
          expires_at: new Date(NOW_MS + 60_000).toISOString(),
        });
        const response = await send(json("observe-view-error", {
          view: {
            view_session: "view-1",
            generation: 1,
            app: APP_A,
            release: RELEASE,
            mode: "live",
            bundle_hash: BUNDLE,
            binding: JSON.stringify(signed),
          },
          observation: {
            report_id: rpt(4),
            observed_at: AT,
            observation: "error",
            error: {
              name: "TypeError",
              message: "x is undefined",
              message_missing_reason: null,
              stack: null,
              stack_missing_reason: { reason: "view_stack_not_collected" },
            },
            error_missing_reason: null,
            invocation: null,
          },
        }));
        const body = await response.json();
        assertEquals(response.status, 200, JSON.stringify(body));
        assertEquals(body.report, rpt(4));
      },
    );
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
