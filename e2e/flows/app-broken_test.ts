// problems#T25 flow app-broken 1단계(docs/flows/app-broken.md). 실제 headless shell과
// 실제 core·실제 apps supervisor·실제 앱 자식으로 깨진 앱 fixture(fixtures/apps/broken, board A)를
// 앱 공간에 띄운다. 앱은 fixture source를 commit한 봉인 bundle이고 ledger에는 등록 transaction이
// 남기는 모양으로 앱·release 행을 심는다. 사람 데이터 root(~/.lophn)는 열지 않는다.
// HOME의 LOPHN_HOME은 임시 폴더이고 띄운 Electron·core 트리는 close가 정확한 pid로만 끝낸다.
//
// 이 단계가 보는 것: 선언한 실패(read_settings의 fixture_misconfigured, run_broken의 fixture_broken)와
// view의 처리되지 않은 render 오류가 수집된다. 당시 release·출처·snapshot이 고정되고, 없는 증거는
// 이유를 가진다. 자동 수집은 그 앱의 보고·오류·로그 범위만 남기고 사람이 고르지 않은 화면 증거는
// 남기지 않는다. 수집 과정은 화면에 보이지 않는다.
// (problem-codes#R2, reporting#R1 R2 R5, snapshots#R1 R4 R6 R15)
//
// 2단계·3단계 테스트는 그 아래에 있다. 3단계는 app-detail에서 문제 열림 notification으로 증상·진행·
// 다음 행동을 보고 봐 달라고 요청한다. 4단계 앞은 마지막 테스트다. App Engineer가 당시 snapshot·
// 설계·release·실제 테스트와 사실을 원인 가설과 구별한 해석 문서를 고정하고 problem에 연결한다.
// 하지 않는 것: ticket, claim, reproduction, activation, 자동 닫힘. process의 unhandled rejection은
// 앱 자식이 바로 끝나 이후 읽기를 막으므로 일으키지 않는다. 화면이 이미 root render에서 깨져 있어
// 실패 command는 그 view의 lophnApp(화면이
// command를 부르는 통로)으로 일으킨다. 1단계에는 사람 조작 화면이 없다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";

import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { e2eEnabled } from "../harness.ts";
import {
  APP,
  prepareBrokenApp,
  RELEASE,
  seedLedger,
  VERIFICATION,
} from "../broken-app.ts";
import {
  commandBody,
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
} from "../flow-support.ts";

const RENDER_MESSAGE = "view render failed in the broken fixture";
const EXCEPTION_SYMPTOM = "Something went wrong in this app.";
const BROKEN_SYMPTOM = "The broken fixture reported one of its failures.";
const SETTINGS_SYMPTOM =
  "The broken fixture is set up wrong. Check its settings.";
const USER_ACTION = "Adjust the app's settings or input for this problem.";
const EMPTY_LOGS = "수집은 성공했고 범위 안에 로그가 0줄이었다";
const SENTINEL = "lophn-e2e-person-file-not-collected-7c2e";
const LATER_MARKER = "later-screen-marker-9f3a";

const APP_VIEW =
  `electron.webContents.getAllWebContents().find((c) => c.getURL().startsWith("lophn-app:"))`;

type Reason = { reason: string } | null;

type Snapshot = {
  id: string;
  captured_at: string;
  invocation: { id: string; binding: string } | null;
  invocation_missing_reason: Reason;
  error: {
    name: string;
    message: string | null;
    message_missing_reason: Reason;
    frames: { path: string }[];
    source_missing_reason: Reason;
    stack: string | null;
    stack_missing_reason: Reason;
  } | null;
  error_missing_reason: Reason;
  logs: { line_count: number; scope: string } | null;
  logs_missing_reason: Reason;
  screen: { state: string | null; screenshot: string | null } | null;
  screen_missing_reason: Reason;
};

type ReadReport = {
  report: {
    id: string;
    app: string;
    source: string;
    mode: string;
    code: string;
    release: string | null;
    release_missing_reason: string | null;
    problem: string | null;
    text: string | null;
    details: string | null;
    snapshot: string;
  };
  snapshot: Snapshot | null;
  attachments?: { field: string }[];
};

type ProblemRow = {
  id: string;
  symptom: string;
  next_action: string | null;
  status: string;
};

function main(flow: FlowShell, expression: string): Promise<unknown> {
  return flow.shell.mainEvaluate(expression);
}

function inApp(flow: FlowShell, script: string): Promise<unknown> {
  return main(flow, `${APP_VIEW}.executeJavaScript(${JSON.stringify(script)})`);
}

function reasonOf(reason: Reason, label: string): string {
  assert(
    reason !== null && reason.reason.trim() !== "",
    `${label} 이유가 없다`,
  );
  return reason.reason;
}

function paired(value: unknown, reason: Reason, label: string): void {
  if (value === null) reasonOf(reason, label);
  else assertEquals(reason, null, `${label}은 값과 이유가 같이 있다`);
}

function assertEvidence(snapshot: Snapshot, home: string): void {
  assert(snapshot.captured_at.trim() !== "", "captured_at이 없다");
  paired(snapshot.invocation, snapshot.invocation_missing_reason, "invocation");
  paired(snapshot.error, snapshot.error_missing_reason, "error");
  paired(snapshot.logs, snapshot.logs_missing_reason, "logs");
  paired(snapshot.screen, snapshot.screen_missing_reason, "screen");
  // 자동 수집은 사람이 고른 화면 자료를 만들지 않는다.
  assertEquals(snapshot.screen, null);
  reasonOf(snapshot.screen_missing_reason, "screen");
  if (snapshot.logs === null) {
    const reason = reasonOf(snapshot.logs_missing_reason, "logs");
    if (reason.includes("0줄")) assertEquals(reason, EMPTY_LOGS);
    assert(
      !reason.includes("읽지 못했다") || !reason.includes("0줄"),
      reason,
    );
  } else {
    assert(
      snapshot.logs.line_count >= 1,
      "빈 로그를 수집 실패와 같은 값으로 두지 않는다",
    );
    assert(snapshot.logs.scope.trim() !== "");
  }
  if (snapshot.error !== null) {
    paired(
      snapshot.error.message,
      snapshot.error.message_missing_reason,
      "message",
    );
    paired(snapshot.error.stack, snapshot.error.stack_missing_reason, "stack");
    if (snapshot.error.frames.length === 0) {
      reasonOf(snapshot.error.source_missing_reason, "source");
    }
    for (const frame of snapshot.error.frames) {
      assert(
        !frame.path.startsWith("/") && !frame.path.includes(".."),
        frame.path,
      );
      assert(!frame.path.includes(home), frame.path);
    }
  }
  const dumped = JSON.stringify(snapshot);
  assert(!dumped.includes(SENTINEL), "사람 파일이 snapshot에 들어갔다");
  assert(!dumped.includes(home), "데이터 root 경로가 snapshot에 들어갔다");
  assert(!dumped.includes(LATER_MARKER), "나중 화면이 snapshot에 들어갔다");
}

async function listed(flow: FlowShell): Promise<ProblemRow[]> {
  const body = await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "list",
    body: { app: APP },
  });
  return body.problems as ProblemRow[];
}

async function reportsOf(
  flow: FlowShell,
  problem: string,
): Promise<{ id: string }[]> {
  const body = await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "list-reports",
    body: { problem },
  });
  return body.reports as { id: string }[];
}

async function readReport(
  flow: FlowShell,
  report: string,
): Promise<ReadReport> {
  return await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "get-report",
    body: { report },
  }) as unknown as ReadReport;
}

async function waitRender(flow: FlowShell): Promise<ReadReport> {
  const deadline = Date.now() + 45_000;
  let seen: ProblemRow[] = [];
  while (Date.now() < deadline) {
    seen = await listed(flow);
    for (const row of seen) {
      if (row.symptom !== EXCEPTION_SYMPTOM) continue;
      for (const item of await reportsOf(flow, row.id)) {
        const read = await readReport(flow, item.id);
        if (read.snapshot?.error?.message === RENDER_MESSAGE) return read;
      }
    }
    await delay(500);
  }
  throw new Error(`view render 보고가 없다: ${JSON.stringify(seen)}`);
}

async function waitSymptom(
  flow: FlowShell,
  symptom: string,
): Promise<ProblemRow> {
  const deadline = Date.now() + 45_000;
  let seen: ProblemRow[] = [];
  while (Date.now() < deadline) {
    seen = await listed(flow);
    const found = seen.find((row) => row.symptom === symptom);
    if (found) return found;
    await delay(500);
  }
  throw new Error(`${symptom} 문제가 없다: ${JSON.stringify(seen)}`);
}

function assertReportScope(
  read: ReadReport,
  source: string,
  code: string,
): Snapshot {
  const report = read.report;
  assertEquals(report.app, APP);
  assertEquals(report.source, source);
  assertEquals(report.mode, "live");
  assertEquals(report.code, code);
  assertEquals(report.release, RELEASE);
  assertEquals(report.release_missing_reason, null);
  assertEquals(report.problem !== null, true);
  assertEquals(report.text, null);
  assert(
    report.details === null || /^[0-9a-f]{64}$/.test(report.details),
    `details가 원문이다: ${report.details}`,
  );
  assert(read.snapshot !== null, "snapshot이 없다");
  assertEquals(read.snapshot.id, report.snapshot);
  for (const attachment of read.attachments ?? []) {
    assert(
      attachment.field !== "feedback_screenshot" &&
        attachment.field !== "feedback_state",
      attachment.field,
    );
  }
  return read.snapshot;
}

async function collectionHidden(flow: FlowShell): Promise<void> {
  assertEquals(await flow.count("[data-feedback]"), 0);
  assertEquals(await flow.count("[data-feedback-phase]"), 0);
  const desktop = String(await flow.evaluate("document.body.innerText"));
  assert(!desktop.includes(RENDER_MESSAGE), desktop);
  assert(!desktop.includes(SENTINEL), desktop);
  assert(!desktop.includes("rpt_"), desktop);
  assert(!desktop.includes("snp_"), desktop);
  const appText = String(
    await main(
      flow,
      `${APP_VIEW}.executeJavaScript("document.body.innerText")`,
    ),
  );
  assert(appText.includes("Couldn't show this screen."), appText);
  assert(!appText.includes(RENDER_MESSAGE), appText);
  assert(!appText.includes(SENTINEL), appText);
}

Deno.test({
  name:
    "problems/problem-codes#R2 problems/reporting#R1 R2 R5 problems/snapshots#R1 R4 R6 R15 flow app-broken 1: 선언 실패와 view exception을 수집하고 당시 snapshot을 고정한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-broken-" });
    let opened: FlowShell | undefined;
    try {
      await Deno.chmod(home, 0o700);
      const first = await openFlowShell({ home });
      await first.close();
      const bundle = await prepareBrokenApp(home, {
        installedHome,
        removeTree,
      });
      seedLedger(home, bundle);
      await Deno.writeTextFile(`${home}/person-private.txt`, SENTINEL);
      const flow = await openFlowShell({ home, start: `app:${APP}` });
      opened = flow;
      await t.step(
        "flow 1: 앱 공간이 서고 수집 과정은 화면에 없다",
        async () => {
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
            "앱 공간이 서지 않았다",
          );
          const deadline = Date.now() + 60_000;
          for (;;) {
            const runtime = await mustCall(flow, {
              kind: "read",
              resource: "apps",
              method: "runtime",
              body: { app: APP },
            });
            if ((runtime.state as { state: string }).state === "running") break;
            assert(Date.now() < deadline, "앱이 뜨지 않았다");
            await delay(500);
          }
          await flow.until(
            `document.querySelector('[data-phase="failed"] button') !== null || document.querySelector('[data-report-problem]:not([disabled])') !== null`,
            "화면 상태가 오지 않았다",
          );
          if ((await flow.count('[data-phase="failed"] button')) > 0) {
            await flow.click('[data-phase="failed"] button');
          }
          await flow.until(
            `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
            "[Report a problem]이 켜지지 않았다",
          );
          await delay(1_000);
          await collectionHidden(flow);
          const blueprint = await mustCall(flow, {
            kind: "read",
            resource: "apps",
            method: "blueprint",
            body: { app: APP },
          });
          assertEquals(blueprint.release, RELEASE);
          const codes = (blueprint.declarations as { problem_codes: string[] })
            .problem_codes;
          assert(codes.includes("fixture_broken"));
          assert(codes.includes("fixture_misconfigured"));
        },
      );

      let renderFrozen = "";
      let renderReport = "";
      await t.step(
        "reporting#R5 snapshots#R1 R4 R6 R15: view render 오류는 당시 release·출처·snapshot으로 접수되고 화면 증거는 없다",
        async () => {
          const read = await waitRender(flow);
          const snapshot = assertReportScope(read, "exception", "_exception");
          assertEvidence(snapshot, home);
          assertEquals(snapshot.invocation, null);
          reasonOf(snapshot.invocation_missing_reason, "invocation");
          assert(snapshot.error !== null);
          assertEquals(snapshot.error.name, "TypeError");
          assertEquals(snapshot.error.message, RENDER_MESSAGE);
          assertEquals(snapshot.error.stack, null);
          const row = (await listed(flow)).find((item) =>
            item.id === read.report.problem
          );
          assert(row !== undefined);
          assertEquals(row.status, "open");
          assertEquals(row.symptom, EXCEPTION_SYMPTOM);
          assertEquals(row.next_action, null);
          const got = await mustCall(flow, {
            kind: "read",
            resource: "problems",
            method: "get",
            body: { problem: row.id },
          });
          assertEquals(got.text, EXCEPTION_SYMPTOM);
          assertEquals(got.first_release, RELEASE);
          assertEquals(got.last_release, RELEASE);
          const logs = await mustCall(flow, {
            kind: "read",
            resource: "problems",
            method: "get-snapshot-logs",
            body: { snapshot: snapshot.id },
          });
          const fragment = JSON.stringify(logs.fragment);
          assert(!fragment.includes(SENTINEL), fragment);
          if (snapshot.logs === null) {
            assert(
              fragment.includes("absent") || fragment.includes("unavailable"),
              fragment,
            );
          }
          renderFrozen = JSON.stringify(snapshot);
          renderReport = read.report.id;
          await collectionHidden(flow);
        },
      );

      await t.step(
        "problem-codes#R2 reporting#R1 R2: 설정 실패는 선언 문구·user fixer로, 코드 실패는 coding_agent로 접수된다",
        async () => {
          const settingsCall = String(
            await inApp(
              flow,
              `lophnApp.call("read_settings", null).then((value) => "ok:" + JSON.stringify(value), (error) => "failed:" + String(error && error.message))`,
            ),
          );
          assert(settingsCall.startsWith("ok:"), settingsCall);
          assert(settingsCall.includes("label_max"), settingsCall);
          const settings = await waitSymptom(flow, SETTINGS_SYMPTOM);
          assertEquals(settings.status, "open");
          assertEquals(settings.next_action, USER_ACTION);
          const settingsReports = await reportsOf(flow, settings.id);
          assertEquals(settingsReports.length, 1);
          const settingsRead = await readReport(flow, settingsReports[0]!.id);
          const settingsSnapshot = assertReportScope(
            settingsRead,
            "app",
            "fixture_misconfigured",
          );
          assertEvidence(settingsSnapshot, home);
          assertEquals(settingsRead.report.source === "exception", false);
          assertEquals(settingsRead.report.source === "feedback", false);

          const brokenCall = String(
            await inApp(
              flow,
              `lophnApp.call("run_broken", { kind: "type_error" }).then((value) => "ok:" + JSON.stringify(value), (error) => "failed:" + String(error && error.message))`,
            ),
          );
          assert(brokenCall.startsWith("failed:"), brokenCall);
          const broken = await waitSymptom(flow, BROKEN_SYMPTOM);
          assertEquals(broken.next_action, null);
          const brokenReports = await reportsOf(flow, broken.id);
          assert(brokenReports.length >= 1);
          const brokenRead = await readReport(flow, brokenReports[0]!.id);
          const brokenSnapshot = assertReportScope(
            brokenRead,
            "app",
            "fixture_broken",
          );
          assertEvidence(brokenSnapshot, home);
          const got = await mustCall(flow, {
            kind: "read",
            resource: "problems",
            method: "get",
            body: { problem: broken.id },
          });
          assertEquals(got.text, BROKEN_SYMPTOM);
          assertEquals(got.first_release, RELEASE);
          await collectionHidden(flow);
        },
      );

      await t.step(
        "snapshots#R1: 화면이 바뀌고 새 보고가 생겨도 당시 snapshot은 그대로다",
        async () => {
          await inApp(
            flow,
            `document.body.setAttribute("data-later", ${
              JSON.stringify(LATER_MARKER)
            }); true`,
          );
          const again = await readReport(flow, renderReport);
          assertEquals(JSON.stringify(again.snapshot), renderFrozen);
          assertEquals(again.report.release, RELEASE);
          assertEquals(again.report.source, "exception");
          const held = (await listed(flow)).find((row) =>
            row.id === again.report.problem
          );
          assert(held !== undefined, "당시 문제가 목록에서 사라졌다");
          assertEquals(held.symptom, EXCEPTION_SYMPTOM);
          await collectionHidden(flow);
        },
      );
    } finally {
      await opened?.close();
      await removeTree(home);
    }
  },
});

const VIEW_TOKEN = ["ghp", "w".repeat(20)].join("_");
const OMIT_TOKEN = ["ghp", "omitzzzzzzzzzzzzzzzzz"].join("_");

type ReportItem = {
  id: string;
  problem: string;
  code: string;
  source: string;
};

type AppCall = {
  ok: boolean;
  value?: Record<string, unknown>;
  message?: string;
};

function callApp(
  flow: FlowShell,
  command: string,
  input: unknown,
): Promise<AppCall> {
  const script =
    `lophnApp.call(${JSON.stringify(command)}, ${JSON.stringify(input)})` +
    `.then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: String(error && error.message) }))`;
  return inApp(flow, script).then((raw) => {
    const reply = raw as AppCall;
    const outer = reply.value?.result;
    const inner = outer !== null && typeof outer === "object"
      ? (outer as { result?: unknown }).result
      : undefined;
    if (inner !== null && typeof inner === "object") {
      return { ok: true, value: inner as Record<string, unknown> };
    }
    return reply;
  });
}

async function reportItems(flow: FlowShell): Promise<ReportItem[]> {
  const items: ReportItem[] = [];
  for (const problem of await listed(flow)) {
    const body = await mustCall(flow, {
      kind: "read",
      resource: "problems",
      method: "list-reports",
      body: { problem: problem.id },
    });
    for (const report of body.reports as ReportItem[]) {
      items.push({
        id: report.id,
        problem: problem.id,
        code: report.code,
        source: report.source,
      });
    }
  }
  return items;
}

async function waitFor(
  label: string,
  read: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await delay(400);
  }
  throw new Error(label);
}

async function filesContaining(
  home: string,
  token: string,
): Promise<string[]> {
  const hits: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name === "apps") continue;
        await walk(path);
        continue;
      }
      if (!entry.isFile) continue;
      const info = await Deno.stat(path);
      if (info.size > 8_000_000) continue;
      const text = new TextDecoder().decode(await Deno.readFile(path));
      if (text.includes(token)) hits.push(path);
    }
  };
  await walk(home);
  return hits;
}

Deno.test({
  name:
    "platform/redaction#R5 R14 problems/reporting#R9 R11 R12 problems/grouping#R1 R2 R5 flow app-broken 2: 저장 전에 redaction하고 재전송·과다 보고·같은 분류를 한 문제로 다룬다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-broken-" });
    let opened: FlowShell | undefined;
    try {
      await Deno.chmod(home, 0o700);
      const first = await openFlowShell({ home });
      await first.close();
      const bundle = await prepareBrokenApp(home, {
        installedHome,
        removeTree,
      });
      seedLedger(home, bundle);
      const flow = await openFlowShell({ home, start: `app:${APP}` });
      opened = flow;
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
        "앱 공간이 서지 않았다",
      );
      const runningAt = Date.now() + 60_000;
      for (;;) {
        const runtime = await mustCall(flow, {
          kind: "read",
          resource: "apps",
          method: "runtime",
          body: { app: APP },
        });
        if ((runtime.state as { state: string }).state === "running") break;
        assert(Date.now() < runningAt, "앱이 뜨지 않았다");
        await delay(500);
      }
      await flow.until(
        `document.querySelector('[data-phase="failed"] button') !== null || document.querySelector('[data-report-problem]:not([disabled])') !== null`,
        "화면 상태가 오지 않았다",
      );
      if ((await flow.count('[data-phase="failed"] button')) > 0) {
        await flow.click('[data-phase="failed"] button');
      }
      await flow.until(
        `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
        "[Report a problem]이 켜지지 않았다",
      );
      await delay(1_000);
      await waitRender(flow);
      await collectionHidden(flow);

      await inApp(
        flow,
        `(() => {
          const token = ["ghp", "w".repeat(20)].join("_");
          const message = "view broke near " + token;
          const error = new Error(message);
          window.dispatchEvent(new ErrorEvent("error", { error, message }));
          return true;
        })()`,
      );
      let secretReport = "";
      await waitFor("가린 view 오류 보고가 없다", async () => {
        for (const item of await reportItems(flow)) {
          if (item.code !== "_exception") continue;
          const read = await readReport(flow, item.id);
          const message = read.snapshot?.error?.message ?? "";
          if (message === RENDER_MESSAGE || message === "") continue;
          if (!message.includes("view broke")) continue;
          secretReport = item.id;
          return true;
        }
        return false;
      });
      const secret = await readReport(flow, secretReport);
      const secretMessage = secret.snapshot?.error?.message ?? null;
      assert(secretMessage !== null, "통과한 문장을 통째로 빼 두지 않는다");
      assert(!secretMessage.includes(VIEW_TOKEN), secretMessage);
      assert(secretMessage.includes("*"), secretMessage);
      assert(
        !JSON.stringify(secret).includes(VIEW_TOKEN),
        "가린 원문이 조회에 남았다",
      );
      const secretLogs = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get-snapshot-logs",
        body: { snapshot: secret.snapshot!.id },
      });
      assert(!JSON.stringify(secretLogs).includes(VIEW_TOKEN));
      const screen = String(await flow.evaluate("document.body.innerText"));
      const appText = String(
        await main(
          flow,
          `${APP_VIEW}.executeJavaScript("document.body.innerText")`,
        ),
      );
      assert(!screen.includes(VIEW_TOKEN), screen);
      assert(!appText.includes(VIEW_TOKEN), appText);
      assertEquals(await filesContaining(home, VIEW_TOKEN), []);

      // RPC JSON 깊이 한도가 redaction 한도보다 앞에서 거절한다. 그 원문은 접수되지 않는다.
      const omitted = await callApp(flow, "repeat_report", { kind: "omit" });
      assert(omitted.ok, omitted.message);
      assertEquals(
        omitted.value?.status,
        "failed",
        JSON.stringify(omitted.value),
      );
      assertEquals(omitted.value?.reason, "invalid_input");
      const omittedId = String(omitted.value?.report_id);
      assert(
        !(await reportItems(flow)).some((item) => item.id === omittedId),
        omittedId,
      );
      for (const item of await reportItems(flow)) {
        const read = await readReport(flow, item.id);
        assert(!JSON.stringify(read).includes(OMIT_TOKEN), item.id);
      }
      assertEquals(await filesContaining(home, OMIT_TOKEN), []);

      const same = await callApp(flow, "repeat_report", { kind: "same" });
      assert(same.ok, same.message);
      assertEquals(same.value?.first, "accepted");
      assertEquals(same.value?.second, "accepted");
      const sameId = String(same.value?.report_id);
      await waitFor(
        "재전송 보고가 없다",
        async () =>
          (await reportItems(flow)).some((item) => item.id === sameId),
      );
      assertEquals(
        (await reportItems(flow)).filter((item) => item.id === sameId).length,
        1,
      );

      const altered = await callApp(flow, "repeat_report", {
        kind: "altered",
      });
      assert(altered.ok, altered.message);
      assertEquals(altered.value?.first, "accepted");
      assertEquals(altered.value?.second, "failed");
      assertEquals(altered.value?.reason, "conflict");
      const alteredId = String(altered.value?.report_id);
      assertEquals(
        (await reportItems(flow)).filter((item) => item.id === alteredId)
          .length,
        1,
      );

      const settingsFirst = await callApp(flow, "read_settings", null);
      assert(settingsFirst.ok, settingsFirst.message);
      const settingsSecond = await callApp(flow, "read_settings", null);
      assert(settingsSecond.ok, settingsSecond.message);
      await waitFor("설정 보고가 둘이 아니다", async () => {
        const settings = (await listed(flow)).filter((row) =>
          row.symptom === SETTINGS_SYMPTOM
        );
        if (settings.length !== 1) return false;
        return (await reportsOf(flow, settings[0]!.id)).length === 2;
      });
      const settingsProblem = (await listed(flow)).find((row) =>
        row.symptom === SETTINGS_SYMPTOM
      );
      assert(settingsProblem !== undefined);
      const settingsIds = (await reportsOf(flow, settingsProblem.id)).map((
        item,
      ) => item.id);
      assertEquals(settingsIds.length, 2);
      assert(settingsIds[0] !== settingsIds[1], settingsIds.join(","));

      const head = await callApp(flow, "run_broken", { kind: "type_error" });
      assertEquals(head.ok, false);
      const tail = await callApp(flow, "run_broken", {
        kind: "type_error",
        variant: "tail",
      });
      assertEquals(tail.ok, false);
      const deep = await callApp(flow, "run_broken", {
        kind: "type_error",
        variant: "deep",
      });
      assertEquals(deep.ok, false);
      type Thrown = {
        id: string;
        problem: string;
        frames: { path: string; function: string | null }[];
      };
      let thrown: Thrown[] = [];
      await waitFor("예외 frame 보고가 모이지 않았다", async () => {
        thrown = [];
        for (const item of await reportItems(flow)) {
          if (item.code !== "_exception") continue;
          const read = await readReport(flow, item.id);
          const frames = (read.snapshot?.error?.frames ?? []) as Thrown[
            "frames"
          ];
          if (frames.length === 0) continue;
          thrown.push({ id: item.id, problem: item.problem, frames });
        }
        const listedBroken = thrown.filter((item) =>
          item.frames.some((frame) => frame.function === "listBroken")
        );
        const panel = thrown.filter((item) =>
          item.frames.some((frame) => frame.function === "readPanel")
        );
        return listedBroken.length >= 2 && panel.length >= 1;
      });
      const listedBroken = thrown.filter((item) =>
        item.frames.some((frame) => frame.function === "listBroken")
      );
      const panel = thrown.filter((item) =>
        item.frames.some((frame) => frame.function === "readPanel") &&
        item.frames.every((frame) => frame.function !== "listBroken")
      );
      assertEquals(listedBroken.length, 2);
      assertEquals(listedBroken[0]!.problem, listedBroken[1]!.problem);
      assert(listedBroken[0]!.id !== listedBroken[1]!.id);
      assertEquals(panel.length, 1);
      assert(panel[0]!.problem !== listedBroken[0]!.problem);
      for (const item of [...listedBroken, ...panel]) {
        for (const frame of item.frames) {
          assert(!frame.path.startsWith("/"), frame.path);
          assert(!frame.path.includes(home), frame.path);
          assert(frame.path.includes("commands.ts"), frame.path);
        }
      }
      const brokenProblems = (await listed(flow)).filter((row) =>
        row.symptom === BROKEN_SYMPTOM
      );
      assertEquals(brokenProblems.length, 1);
      assert(brokenProblems[0]!.id !== settingsProblem.id);
      const brokenGot = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get",
        body: { problem: brokenProblems[0]!.id },
      });
      const brokenJson = JSON.stringify(brokenGot);
      assertEquals(
        (brokenGot.problem as { interpretation: unknown }).interpretation,
        null,
      );
      assert(!brokenJson.includes("root_cause"), brokenJson);
      assert(!brokenJson.includes("confirmed_cause"), brokenJson);
      assert(!brokenJson.includes("same_cause"), brokenJson);
      assert(!brokenJson.includes("같은 원인"), brokenJson);
      const shown = `${screen}\n${appText}\n${
        String(await flow.evaluate("document.body.innerText"))
      }`;
      assert(!shown.includes("group_key"), shown);
      assert(!shown.includes("fingerprint"), shown);
      assert(!shown.includes("같은 원인"), shown);
      await collectionHidden(flow);

      const kept = new Set((await reportItems(flow)).map((item) => item.id));
      assert(kept.size < 20, `창이 차기 전에 보고가 ${kept.size}개다`);
      assert(kept.has(sameId));
      const flood = await callApp(flow, "flood_reports", null);
      assert(flood.ok, flood.message);
      assertEquals(flood.value?.sent, 25);
      const beforeFlood = kept.size;
      let capped: ReportItem[] = [];
      let stable = 0;
      let previous = -1;
      await waitFor("과다 보고 상한이 보이지 않는다", async () => {
        capped = await reportItems(flow);
        if (capped.length === previous && capped.length > beforeFlood) {
          stable += 1;
        } else {
          stable = 0;
          previous = capped.length;
        }
        return stable >= 3;
      });
      assert(capped.length > beforeFlood, String(capped.length));
      assert(capped.length <= beforeFlood + 20, String(capped.length));
      for (const id of kept) {
        assert(capped.some((item) => item.id === id), id);
      }
      assertEquals(capped.filter((item) => item.id === sameId).length, 1);
      await delay(1_000);
      const settled = await reportItems(flow);
      assert(settled.length <= beforeFlood + 20, String(settled.length));
      assertEquals(settled.filter((item) => item.id === sameId).length, 1);
      for (const id of kept) {
        assert(settled.some((item) => item.id === id), id);
      }
    } finally {
      await opened?.close();
      await removeTree(home);
    }
  },
});

const ASK_ENGINEER = "Ask the App Engineer to look into this problem.";
const NOBODY = "Nobody has taken this yet.";
const LOOK = "Please look at this problem.";
const SESSION = "ses_01arz3ndektsv4rrffq69g5fav";
const MESSAGE = "msg_01arz3ndektsv4rrffq69g5fav";

type Note = {
  notification: { id: string; source_seq: string; read_at: string | null };
  source_event: string;
  occurred_at?: string;
  document?: string | null;
};

type Engineer = {
  id: string;
  state: string;
  revision: number;
  scope: { kind: string; id: string | null };
};

type RunRow = { source: { kind: string; message?: string } };

// 심은 앱 행에는 AppCreated가 없다. shell을 멈춘 동안 그 event만 남겨, 다시 열면
// 기존 assignment 반응이 이 앱의 App Engineer를 만든다. seedLedger는 다른 테스트가 쓴다.
function recordAppCreated(home: string): void {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.prepare(
      `insert into events (type, subject, actor, run, payload, at)
       values ('AppCreated', ?, 'user', null, ?, '2026-10-01T00:00:00.000Z')`,
    ).run(
      APP,
      JSON.stringify({
        slug: "broken",
        name: "Broken",
        description: "A deliberately broken app",
      }),
    );
  } finally {
    db.close();
  }
}

async function notesOf(flow: FlowShell): Promise<Note[]> {
  const body = await mustCall(flow, {
    kind: "read",
    resource: "notifications",
    method: "list",
    body: {},
  });
  return body.notifications as Note[];
}

function assertNoteSafe(notes: Note[]): void {
  const dumped = JSON.stringify(notes);
  assert(!dumped.includes("payload"), dumped);
  assert(!dumped.includes("group_key"), dumped);
  assert(!dumped.includes("rpt_"), dumped);
  assert(!dumped.includes(APP), dumped);
  assert(!dumped.includes(RENDER_MESSAGE), dumped);
  assert(!dumped.includes("ProblemObserved"), dumped);
  for (const note of notes) {
    assertEquals(note.source_event, "ProblemOpened");
    assert(
      typeof note.occurred_at === "string" && note.occurred_at !== "",
      JSON.stringify(note),
    );
    for (const key of Object.keys(note)) {
      assert(
        key === "notification" || key === "source_event" ||
          key === "occurred_at" || key === "document" || key === "delivery",
        key,
      );
    }
  }
}

async function problemRows(
  flow: FlowShell,
): Promise<Record<string, unknown>[]> {
  const body = await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "list",
    body: { app: APP },
  });
  return body.problems as Record<string, unknown>[];
}

function assertUserList(rows: Record<string, unknown>[]): void {
  assert(rows.length >= 1);
  for (const row of rows) {
    assertEquals(
      Object.keys(row).sort(),
      ["app", "id", "next_action", "seq", "status", "symptom"],
    );
    assertEquals(row.app, APP);
    assertEquals(row.status, "open");
    assert(typeof row.symptom === "string" && row.symptom !== "");
    assert(row.next_action === null || typeof row.next_action === "string");
  }
  const dumped = JSON.stringify(rows);
  assert(!dumped.includes("payload"), dumped);
  assert(!dumped.includes("group_key"), dumped);
  assert(!dumped.includes(RENDER_MESSAGE), dumped);
  assert(!dumped.includes("ProblemOpened"), dumped);
}

async function settledNotes(flow: FlowShell): Promise<Note[]> {
  let last = "";
  let stable = 0;
  let notes: Note[] = [];
  await waitFor("notification이 열린 문제 수와 맞지 않는다", async () => {
    const rows = await problemRows(flow);
    notes = await notesOf(flow);
    const key = `${rows.length}:${
      notes.map((note) => note.notification.id).join(",")
    }`;
    if (notes.length === rows.length && rows.length >= 1 && key === last) {
      stable += 1;
    } else {
      stable = 0;
      last = key;
    }
    return stable >= 2;
  });
  return notes;
}

async function engineerOf(flow: FlowShell): Promise<Engineer | undefined> {
  const body = await mustCall(flow, {
    kind: "read",
    resource: "assignments",
    method: "list",
    body: { role: "app_engineer" },
  });
  return (body.assignments as Engineer[]).find((row) =>
    row.scope?.kind === "app" && row.scope.id === APP &&
    row.state !== "withdrawn"
  );
}

async function runsOf(flow: FlowShell, assignment: string): Promise<RunRow[]> {
  const body = await mustCall(flow, {
    kind: "read",
    resource: "runs",
    method: "list",
    body: { assignment },
  });
  return body.runs as RunRow[];
}

async function openIssues(flow: FlowShell): Promise<void> {
  await flow.until(
    `document.querySelector('[data-app-bar="app-details"]') !== null`,
    "앱 막대",
  );
  await flow.click('[data-app-bar="app-details"]');
  await flow.until(
    `document.querySelector("[data-ops-panel]") !== null`,
    "운영 패널",
  );
  const picked = await flow.evaluate(`(() => {
    const tab = document.querySelector('[role=tab][id$="trigger-issues"]');
    if (!tab) return false;
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
    tab.click();
    return true;
  })()`);
  assertEquals(picked, true, "Issues 탭이 없다");
  await flow.until(
    `document.querySelector('[role=tab][id$="trigger-issues"]')?.getAttribute("aria-selected") === "true" && document.querySelector("[data-issues-list] [data-issue-open]") !== null`,
    "Issues 목록",
  );
}

async function issueRows(flow: FlowShell): Promise<{
  status: string;
  impact: string;
  text: string;
}[]> {
  const raw = await flow.evaluate(`JSON.stringify([...document.querySelectorAll(
    "[data-issues-list] [data-issue]",
  )].map((row) => ({
    status: row.getAttribute("data-issue"),
    impact: row.querySelector("[data-issue-open]")?.textContent ?? "",
    text: row.innerText,
  })))`);
  return JSON.parse(String(raw)) as {
    status: string;
    impact: string;
    text: string;
  }[];
}

function assertScreenHidesRaw(text: string): void {
  assert(!text.includes(RENDER_MESSAGE), text);
  assert(!text.includes("group_key"), text);
  assert(!text.includes("payload"), text);
  assert(!text.includes("ProblemOpened"), text);
  assert(!text.includes("rpt_"), text);
  assert(!text.includes("snp_"), text);
  assert(!text.includes("rel_"), text);
  assert(!text.includes("TypeError"), text);
}

Deno.test({
  name:
    "platform/notifications#R1 R2 R3 R7 problems/grouping#R11 R12 lophn-agent/roles/app-engineer#R1 flow app-broken 3: 문제 열림 notification으로 증상·진행·다음 행동을 보고 봐 달라고 요청한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-broken-" });
    let opened: FlowShell | undefined;
    try {
      await Deno.chmod(home, 0o700);
      const first = await openFlowShell({ home });
      await first.close();
      const bundle = await prepareBrokenApp(home, {
        installedHome,
        removeTree,
      });
      seedLedger(home, bundle);
      recordAppCreated(home);
      const flow = await openFlowShell({ home, start: `app:${APP}` });
      opened = flow;
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
        "앱 공간이 서지 않았다",
      );
      const runningAt = Date.now() + 60_000;
      for (;;) {
        const runtime = await mustCall(flow, {
          kind: "read",
          resource: "apps",
          method: "runtime",
          body: { app: APP },
        });
        if ((runtime.state as { state: string }).state === "running") break;
        assert(Date.now() < runningAt, "앱이 뜨지 않았다");
        await delay(500);
      }
      await flow.until(
        `document.querySelector('[data-phase="failed"] button') !== null || document.querySelector('[data-report-problem]:not([disabled])') !== null`,
        "화면 상태가 오지 않았다",
      );
      if ((await flow.count('[data-phase="failed"] button')) > 0) {
        await flow.click('[data-phase="failed"] button');
      }
      await flow.until(
        `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
        "[Report a problem]이 켜지지 않았다",
      );

      let engineer: Engineer | undefined;
      await waitFor("App Engineer assignment가 없다", async () => {
        engineer = await engineerOf(flow);
        return engineer?.state === "enabled";
      });
      assert(engineer !== undefined);
      assertEquals(await runsOf(flow, engineer.id), []);

      const render = await waitRender(flow);
      const openedNotes = await settledNotes(flow);
      assertNoteSafe(openedNotes);
      assertUserList(await problemRows(flow));
      assertEquals(await runsOf(flow, engineer.id), []);
      let chip = "";
      await waitFor("문제 열림 notification chip이 없다", async () => {
        chip = String(
          await flow.evaluate(
            `document.querySelector("[data-notification-chip]")?.innerText ?? ""`,
          ),
        );
        return chip.includes("An issue was reported");
      });
      assert(chip.includes("An issue was reported"), chip);
      assert(!chip.includes(RENDER_MESSAGE), chip);
      assert(!chip.includes("group_key"), chip);

      await openIssues(flow);
      const rows = await issueRows(flow);
      const exceptionRow = rows.find((row) => row.impact === EXCEPTION_SYMPTOM);
      assert(exceptionRow !== undefined, JSON.stringify(rows));
      assertEquals(exceptionRow.status, "open");
      assert(!exceptionRow.text.includes(ASK_ENGINEER), exceptionRow.text);
      assert(!exceptionRow.text.includes(USER_ACTION), exceptionRow.text);
      assertScreenHidesRaw(exceptionRow.text);

      const openedDetail = await flow.evaluate(`(() => {
        const open = [...document.querySelectorAll("[data-issues-list] [data-issue-open]")]
          .find((el) => el.textContent === ${
        JSON.stringify(EXCEPTION_SYMPTOM)
      });
        if (!open) return false;
        open.click();
        return true;
      })()`);
      assertEquals(openedDetail, true);
      await flow.until(
        `document.querySelector("[data-issue-needed]") !== null`,
        "문제 상세가 열리지 않았다",
      );
      assertEquals(
        String(
          await flow.evaluate(
            `document.querySelector("[data-issue-needed]")?.textContent ?? ""`,
          ),
        ),
        ASK_ENGINEER,
      );
      const nowText = String(
        await flow.evaluate(
          `document.querySelector("[data-issue-now]")?.innerText ?? ""`,
        ),
      );
      assert(nowText.includes(NOBODY), nowText);
      assert(nowText.includes("Open"), nowText);
      assert(nowText.includes("No repair work yet"), nowText);
      const seen = String(
        await flow.evaluate(
          `document.querySelector("[data-issue-seen]")?.innerText ?? ""`,
        ),
      );
      assert(seen.startsWith("Seen once"), seen);
      assert(seen.includes("First seen"), seen);
      assert(seen.includes("Last seen"), seen);
      const detailText = String(
        await flow.evaluate(
          `document.querySelector("[data-issue-detail]")?.innerText ?? ""`,
        ),
      );
      assertScreenHidesRaw(detailText);
      assertEquals(
        await flow.count("[data-issue-detail] [data-issue-details]"),
        0,
      );

      const shot = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get-snapshot",
        body: { snapshot: render.snapshot!.id, item: "screen" },
      });
      assertEquals(shot.item, null);
      assert(shot.missing !== null, JSON.stringify(shot.missing));
      assertEquals(shot.blobs, []);
      const again = await readReport(flow, render.report.id);
      assertEquals(again.snapshot?.screen, null);
      assertEquals(again.snapshot?.error?.stack, null);
      assertEquals(again.snapshot?.error?.message, RENDER_MESSAGE);
      assertEquals(await runsOf(flow, engineer.id), []);

      await flow.click("[data-issue-back]");
      await flow.until(
        `document.querySelector("[data-issues-list] [data-issue-open]") !== null`,
        "Issues 목록으로 돌아오지 않았다",
      );
      const beforeRepeat = await settledNotes(flow);
      assertNoteSafe(beforeRepeat);
      const held = beforeRepeat.map((note) => ({
        id: note.notification.id,
        source_seq: note.notification.source_seq,
        occurred_at: note.occurred_at,
      }));

      const firstSettings = await callApp(flow, "read_settings", null);
      assert(firstSettings.ok, firstSettings.message);
      await waitSymptom(flow, SETTINGS_SYMPTOM);
      let afterFirst: Note[] = [];
      await waitFor("새 문제의 notification이 없다", async () => {
        afterFirst = await notesOf(flow);
        return afterFirst.length === beforeRepeat.length + 1;
      });
      assertNoteSafe(afterFirst);
      for (const note of held) {
        const same = afterFirst.find((item) =>
          item.notification.id === note.id
        );
        assert(same !== undefined, note.id);
        assertEquals(same.notification.source_seq, note.source_seq);
        assertEquals(same.occurred_at, note.occurred_at);
      }
      // 목록은 열 때 한 번만 읽는다. 새 문제를 보려면 패널을 다시 연다.
      await flow.click("[data-ops-panel-close]");
      await flow.until(
        `document.querySelector("[data-ops-panel]") === null`,
        "운영 패널이 닫히지 않았다",
      );
      await openIssues(flow);
      const settingsRow = (await issueRows(flow)).find((row) =>
        row.impact === SETTINGS_SYMPTOM
      );
      assert(settingsRow !== undefined, JSON.stringify(await issueRows(flow)));
      assertEquals(settingsRow.status, "open");
      assert(settingsRow.text.includes(USER_ACTION), settingsRow.text);
      assertScreenHidesRaw(settingsRow.text);
      const settings = (await listed(flow)).find((row) =>
        row.symptom === SETTINGS_SYMPTOM
      );
      assert(settings !== undefined);
      assertEquals(settings.next_action, USER_ACTION);
      const settingsReports = await reportsOf(flow, settings.id);
      assertEquals(settingsReports.length, 1);

      const secondSettings = await callApp(flow, "read_settings", null);
      assert(secondSettings.ok, secondSettings.message);
      await waitFor(
        "반복 report가 같은 문제에 붙지 않았다",
        async () => (await reportsOf(flow, settings.id)).length === 2,
      );
      await delay(1_000);
      const afterSecond = await notesOf(flow);
      assertEquals(
        afterSecond.map((note) => note.notification.id),
        afterFirst.map((note) => note.notification.id),
      );
      assertNoteSafe(afterSecond);
      for (const note of held) {
        const same = afterSecond.find((item) =>
          item.notification.id === note.id
        );
        assert(same !== undefined);
        assertEquals(same!.notification.source_seq, note.source_seq);
        assertEquals(same!.occurred_at, note.occurred_at);
      }
      assertEquals(
        (await listed(flow)).filter((row) => row.symptom === SETTINGS_SYMPTOM)
          .length,
        1,
      );
      assertEquals(await runsOf(flow, engineer.id), []);

      const marked = await mustCall(flow, {
        kind: "command",
        resource: "notifications",
        method: "read",
        body: commandBody({
          notification: beforeRepeat[0]!.notification.id,
        }),
      });
      assertEquals(marked.changed, true);
      const readBack = await mustCall(flow, {
        kind: "read",
        resource: "notifications",
        method: "get",
        body: { notification: beforeRepeat[0]!.notification.id },
      });
      const readDump = JSON.stringify(readBack);
      assert(!readDump.includes("payload"), readDump);
      assert(!readDump.includes("group_key"), readDump);
      assert(!readDump.includes("rpt_"), readDump);
      assert(!readDump.includes(RENDER_MESSAGE), readDump);
      assertNoteSafe([{
        notification: readBack.notification as Note["notification"],
        source_event: String(readBack.source_event),
        occurred_at: readBack.occurred_at as string | undefined,
        ...(readBack.document === undefined
          ? {}
          : { document: readBack.document as string | null }),
      }]);
      assert(
        (readBack.notification as { read_at: string | null }).read_at !== null,
      );
      const still = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get",
        body: { problem: render.report.problem },
      });
      assertEquals((still.problem as { status: string }).status, "open");
      assertEquals(
        (still.problem as { interpretation: unknown }).interpretation,
        null,
      );
      assertEquals(await runsOf(flow, engineer.id), []);
      const detail = still.detail as {
        needed_action: string;
        owner: { label: string };
        progress: { state: string; label: string };
      };
      assertEquals(detail.needed_action, ASK_ENGINEER);
      assertEquals(detail.owner.label, NOBODY);
      assertEquals(detail.progress, { state: "open", label: "Open" });
      const detailDump = JSON.stringify(detail);
      assert(!detailDump.includes("tkt_"), detailDump);
      assert(!detailDump.includes("claim"), detailDump);
      assert(!detailDump.includes(RENDER_MESSAGE), detailDump);

      const openedSession = await mustCall(flow, {
        kind: "command",
        resource: "sessions",
        method: "open",
        body: commandBody({
          id: SESSION,
          assignment: engineer.id,
          role: "app_engineer",
          work_place: { kind: "app", id: APP },
          continued_from: null,
        }, {
          assignment_revision: engineer.revision,
          assignment_state: "enabled",
        }),
      });
      const asked = await mustCall(flow, {
        kind: "command",
        resource: "messages",
        method: "receive",
        body: commandBody({
          id: MESSAGE,
          session: SESSION,
          content: {
            schema_version: 1,
            parts: [{ kind: "text", text: LOOK }],
          },
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: String(
            (openedSession as { state_seq: string }).state_seq,
          ),
          assignment_revision: engineer.revision,
          assignment_state: "enabled",
        }),
      });
      assertEquals(
        (asked.message as { actor: string; mode: string }).actor,
        "user",
      );
      assertEquals(
        (asked.message as { mode: string }).mode,
        "request",
      );
      const body = await mustCall(flow, {
        kind: "read",
        resource: "messages",
        method: "body",
        body: { message: MESSAGE },
      });
      const parts =
        (body.content as { parts: { kind: string; text: string }[] })
          .parts;
      assertEquals(parts, [{ kind: "text", text: LOOK }]);
      const runs = await runsOf(flow, engineer.id);
      assertEquals(runs.length, 1);
      assertEquals(runs[0]!.source.kind, "message");
      assertEquals(runs[0]!.source.message, MESSAGE);
      const afterAsk = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get",
        body: { problem: render.report.problem },
      });
      assertEquals(
        (afterAsk.problem as { interpretation: unknown }).interpretation,
        null,
      );
      assertEquals(
        (afterAsk.problem as { status: string }).status,
        "open",
      );
      assertEquals(
        await notesOf(flow).then((notes) => notes.length),
        afterSecond.length,
      );
    } finally {
      await opened?.close();
      await removeTree(home);
    }
  },
});

const DESIGN_ASK = "이 앱의 설계를 문서로 남겨 달라.";
const DESIGN_DONE = "설계 문서를 남겼다.";
const LINK_DONE = "해석 문서를 문제에 연결했다.";
const SETTINGS_SENTENCE = "설정을 읽으면 설정이 보인다.";
const SCREEN_SENTENCE = "화면이 깨지면 그 오류를 문제로 남긴다.";
const FOURTH_CAUSE = "은행 파일 parser가 틀렸다";
const CAUSE_1 = "view가 그려지기 전에 예외를 던진다.";
const CAUSE_2 = "설정 화면이 나오기 전에 초기화가 실패한다.";
const CAUSE_3 = "활성 release의 화면 코드가 설계와 어긋난다.";
const DESIGN_TEXT = `# Broken app design

## 기대 {#expect}

${SETTINGS_SENTENCE}

## 깨진 화면 {#broken-screen}

${SCREEN_SENTENCE}
`;
const SESSION_4 = "ses_01arz3ndektsv4rrffq69g5fb4";
const DESIGN_MESSAGE = "msg_01arz3ndektsv4rrffq69g5fb4";
const LOOK_MESSAGE = "msg_01arz3ndektsv4rrffq69g5fb5";
const PROVIDER_4 = "pvd_01arz3ndektsv4rrffq69g5fb4";
const MODEL_4 = "claude-sonnet-4-5";
const LINK_EXPLANATION =
  "당시 snapshot·설계·release·실제 테스트를 구별한 해석 판의 원인 가설 절이다.";

type InterpretFacts = {
  problem: string;
  status: string;
  release: string;
  planningVersion: string | null;
  testsState: string;
  snapshotName: string;
  snapshotMessage: string;
  screenReason: string;
  designDocument: string;
  designVersion: string;
  settingsSentence: string;
  screenSentence: string;
  verification: string;
  verificationStatus: string;
  verificationCode: string;
};

type InterpretStep =
  | "design"
  | "design-saved"
  | "look"
  | "list"
  | "problem"
  | "releases"
  | "app"
  | "docs"
  | "design-body"
  | "verification"
  | "report"
  | "snapshot"
  | "create"
  | "outline"
  | "link"
  | "done";

type InterpretScript = {
  url: string;
  close: () => Promise<void>;
  failure: () => string;
  step: () => InterpretStep;
  callsNamed: () => readonly string[];
  body: (index: number) => string;
  calls: () => number;
  facts: () => InterpretFacts;
  text: () => string;
  document: () => string;
  version: () => string;
  section: () => string;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label}: ${JSON.stringify(value)?.slice(0, 300)}`,
  );
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function reasonText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && "reason" in value) {
    return textOf((value as { reason: unknown }).reason);
  }
  return "";
}

function toolCall(id: string, name: string, args: unknown): SemanticReply {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { input: 24, output: 8 },
    stop: "tool_calls",
  };
}

function said(text: string): SemanticReply {
  return { text, usage: { input: 16, output: 6 }, stop: "end" };
}

function turnOf(
  body: string,
): { kind: "user"; text: string } | { kind: "tool" } | {
  kind: "other";
} {
  const request = JSON.parse(body) as {
    messages?: { role?: string; content?: unknown }[];
  };
  const messages = request.messages ?? [];
  const last = messages[messages.length - 1];
  if (last?.role !== "user") return { kind: "other" };
  const content = last.content;
  const blocks = Array.isArray(content)
    ? content
    : typeof content === "string"
    ? [{ type: "text", text: content }]
    : [];
  if (
    blocks.some((block) =>
      typeof block === "object" && block !== null &&
      (block as { type?: string }).type === "tool_result"
    )
  ) {
    return { kind: "tool" };
  }
  const text = blocks.map((block) =>
    typeof block === "object" && block !== null &&
      (block as { type?: string }).type === "text"
      ? textOf((block as { text?: unknown }).text)
      : ""
  ).join("");
  return { kind: "user", text };
}

// 현재 요청은 매 호출의 마지막 user 글이다. tool 결과 차례는 그 글이 아니라
// 본문 tool_result 수가 이전보다 늘었는지로 가른다.
function toolResultCount(body: string): number {
  const request = JSON.parse(body) as { messages?: { content?: unknown }[] };
  let count = 0;
  for (const message of request.messages ?? []) {
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        typeof block === "object" && block !== null &&
        (block as { type?: string }).type === "tool_result"
      ) count += 1;
    }
  }
  return count;
}

function lastToolJson(body: string): Record<string, unknown> {
  const request = JSON.parse(body) as { messages?: { content?: unknown }[] };
  const blocks = (request.messages ?? []).flatMap((message) =>
    Array.isArray(message.content) ? message.content : []
  );
  const result = blocks.findLast((block) =>
    typeof block === "object" && block !== null &&
    (block as { type?: string }).type === "tool_result"
  ) as { content?: unknown } | undefined;
  assert(result !== undefined, `tool 결과가 없다: ${body.slice(-400)}`);
  const raw = typeof result.content === "string"
    ? result.content
    : Array.isArray(result.content)
    ? (result.content as { text?: string }[]).map((part) => part.text ?? "")
      .join("")
    : "";
  const start = raw.indexOf('{"status"');
  const end = raw.lastIndexOf("}");
  assert(
    start >= 0 && end > start,
    `tool 결과 JSON이 없다: ${raw.slice(0, 400)}`,
  );
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function toolContent(body: string): Record<string, unknown> {
  const json = lastToolJson(body);
  assertEquals(json["status"], "success", JSON.stringify(json).slice(0, 500));
  const content = json["content"];
  assert(
    content !== null && typeof content === "object",
    JSON.stringify(json).slice(0, 400),
  );
  assertEquals(json["complete"] === false, false, "결과가 잘렸다");
  return content as Record<string, unknown>;
}

function sliceFrom(body: string, sentence: string): string {
  const at = body.indexOf(sentence);
  assert(at >= 0, body.slice(0, 240));
  return body.slice(at, at + sentence.length);
}

function interpretationText(facts: InterpretFacts): string {
  const tests = facts.testsState === "not_run"
    ? `${facts.testsState}. 결과가 없다.`
    : facts.testsState;
  return `# 해석

## 사실 {#facts}

- 문제: ${facts.problem}
- 상태: ${facts.status}
- release: ${facts.release}
- snapshot 오류: ${facts.snapshotName}: ${facts.snapshotMessage}
- 화면 증거: ${facts.screenReason}
- 설계 문서: ${facts.designDocument} ${facts.designVersion}
- 설계: ${facts.settingsSentence}
- 설계: ${facts.screenSentence}
- verification: ${facts.verification}
- verification 읽기: ${facts.verificationStatus} ${facts.verificationCode}
- 통과로 쓰지 않음
- 테스트 상태: ${tests}

## 원인 가설 {#causes}

원인은 셋만 적는다.

### 가설 1

${CAUSE_1}

- 지지: snapshot 오류 ${facts.snapshotName} ${facts.snapshotMessage}
- 반박: 설계의 화면 문장은 기대이고 원인 증명이 아니다.
- 다음 확인: 그 release의 view 시작 순서를 본다.

### 가설 2

${CAUSE_2}

- 지지: 설계는 ${facts.settingsSentence} 라고 적는다.
- 반박: snapshot 오류는 설정 실패가 아니다.
- 다음 확인: 설정 읽기와 첫 화면의 순서를 본다.

### 가설 3

${CAUSE_3}

- 지지: 활성 release ${facts.release}
- 반박: verification ${facts.verification}는 통과로 쓰지 않음
- 다음 확인: 그 release의 화면과 설계 문장을 나란히 본다.

## 부족한 근거 {#missing}

${FOURTH_CAUSE}. snapshot·설계·테스트가 이 문장을 지지하지 않아 가설로 두지 않는다.
`;
}

// report id는 agent tool에 목록이 없다. core가 provider 응답을 기다리는 동안
// handler에서 다시 읽으면 서로 막히므로, 서버를 열기 전에 잡은 id만 심는다.
function startInterpretScript(reportId: string): InterpretScript {
  const bodies: string[] = [];
  const named: string[] = [];
  const found = {
    step: "design" as InterpretStep,
    failure: "",
    outlines: 0,
    document: "",
    version: "",
    section: "",
    text: "",
    facts: {
      problem: "",
      status: "",
      release: "",
      planningVersion: null,
      testsState: "",
      snapshotName: "",
      snapshotMessage: "",
      screenReason: "",
      designDocument: "",
      designVersion: "",
      settingsSentence: "",
      screenSentence: "",
      verification: "",
      verificationStatus: "",
      verificationCode: "",
    } as InterpretFacts,
  };
  let seq = 0;
  let seenResults = 0;
  const rememberResults = (next: number): boolean => {
    seenResults = next;
    return true;
  };
  const issue = (name: string, args: unknown): SemanticReply => {
    named.push(name);
    seq += 1;
    return toolCall(`toolu_s4_${seq}`, name, args);
  };
  const fail = (message: string): never => {
    throw new Error(message);
  };

  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      bodies.push(text);
      let reply = said("");
      try {
        const turn = turnOf(text);
        const results = toolResultCount(text);
        if (found.step === "design") {
          if (turn.kind !== "user" || !turn.text.includes(DESIGN_ASK)) {
            fail(`설계 요청이 아니다: ${text.slice(-300)}`);
          }
          seenResults = results;
          found.step = "design-saved";
          reply = issue("document.create", {
            title: "Broken app design",
            place: { kind: "app", id: APP },
            name: "broken-design",
            text: DESIGN_TEXT,
            media_type: "text/markdown",
          });
        } else if (results <= seenResults) {
          if (results < seenResults) seenResults = results;
          if (
            found.step !== "look" || turn.kind !== "user" ||
            !turn.text.includes(LOOK)
          ) {
            fail(
              `도구 결과 차례에 사람 글이 왔다: ${found.step} results=${results}`,
            );
          }
          found.step = "list";
          reply = issue("problem.list", { app: APP });
        } else if (rememberResults(results) && found.step === "design-saved") {
          const saved = toolContent(text);
          found.facts.designDocument = textOf(saved["document"]);
          found.facts.designVersion = textOf(saved["version"]);
          assert(
            found.facts.designDocument.startsWith("doc_"),
            JSON.stringify(saved),
          );
          assert(
            found.facts.designVersion.startsWith("ver_"),
            JSON.stringify(saved),
          );
          found.step = "look";
          reply = said(DESIGN_DONE);
        } else if (found.step === "list") {
          const problems = toolContent(text)["problems"] as {
            id?: string;
            symptom?: string;
          }[];
          const row = problems.find((item) =>
            item.symptom === EXCEPTION_SYMPTOM
          );
          assert(typeof row?.id === "string", JSON.stringify(problems));
          found.facts.problem = row.id;
          found.step = "problem";
          reply = issue("problem.read", { problem: row.id });
        } else if (found.step === "problem") {
          const body = toolContent(text);
          const problem = asRecord(body["problem"], "problem");
          assertEquals(textOf(problem["id"]), found.facts.problem);
          found.facts.status = textOf(problem["status"]);
          const detail = asRecord(body["detail"], "detail");
          const result = asRecord(detail["result"], "result");
          const tests = asRecord(result["tests"], "tests");
          found.facts.testsState = textOf(tests["state"]);
          assert(found.facts.testsState !== "", JSON.stringify(tests));
          assert(found.facts.testsState !== "pass", found.facts.testsState);
          found.step = "releases";
          reply = issue("app.releases", { app: APP });
        } else if (found.step === "releases") {
          const releases = toolContent(text)["releases"] as {
            id?: string;
            tests?: string[];
          }[];
          const release = releases.find((item) =>
            item.tests?.includes(VERIFICATION)
          );
          assert(typeof release?.id === "string", JSON.stringify(releases));
          found.facts.release = release.id;
          found.facts.verification = VERIFICATION;
          found.step = "app";
          reply = issue("app.read", { app: APP });
        } else if (found.step === "app") {
          const app = asRecord(toolContent(text)["app"], "app");
          assertEquals(app["planning_version"], null);
          assertEquals(textOf(app["active_release"]), found.facts.release);
          found.facts.planningVersion = null;
          found.step = "docs";
          reply = issue("document.list", {
            place: { kind: "app", id: APP },
          });
        } else if (found.step === "docs") {
          const documents = toolContent(text)["documents"] as {
            document?: { id?: string; title?: string; name?: string };
            latest_version?: { id?: string };
          }[];
          const design = documents.find((item) =>
            item.document?.name === "broken-design"
          );
          const designId = design?.document?.id;
          const designVersion = design?.latest_version?.id;
          assert(
            typeof designId === "string" && typeof designVersion === "string",
            JSON.stringify(documents).slice(0, 500),
          );
          assertEquals(designId, found.facts.designDocument);
          found.facts.designVersion = designVersion;
          found.step = "design-body";
          reply = issue("document.read_version", {
            reference: {
              document: designId,
              version: designVersion,
              section: null,
            },
          });
        } else if (found.step === "design-body") {
          const body = textOf(toolContent(text)["text"]);
          found.facts.settingsSentence = sliceFrom(body, SETTINGS_SENTENCE);
          found.facts.screenSentence = sliceFrom(body, SCREEN_SENTENCE);
          found.step = "verification";
          reply = issue("verification.read", {
            verification: found.facts.verification,
          });
        } else if (found.step === "verification") {
          const json = lastToolJson(text);
          found.facts.verificationStatus = textOf(json["status"]);
          found.facts.verificationCode = textOf(json["code"]);
          if (found.facts.verificationStatus === "success") {
            const verification = asRecord(
              asRecord(json["content"], "content")["verification"],
              "verification",
            );
            assert(
              textOf(verification["result"]) !== "pass",
              JSON.stringify(verification),
            );
          } else {
            assertEquals(found.facts.verificationStatus, "failure");
            assert(found.facts.verificationCode !== "", JSON.stringify(json));
          }
          found.step = "report";
          reply = issue("report.read", { report: reportId });
        } else if (found.step === "report") {
          const body = toolContent(text);
          const report = asRecord(body["report"], "report");
          assertEquals(textOf(report["id"]), reportId);
          const snapshot = asRecord(body["snapshot"], "snapshot");
          const error = asRecord(snapshot["error"], "error");
          found.facts.snapshotName = textOf(error["name"]);
          found.facts.snapshotMessage = textOf(error["message"]);
          assert(found.facts.snapshotMessage !== "", JSON.stringify(error));
          const screen = reasonText(snapshot["screen_missing_reason"]) ||
            reasonText(asRecord(body["missing"], "missing")["screen"]);
          assert(screen !== "", JSON.stringify(body["missing"]));
          found.facts.screenReason = screen;
          found.step = "snapshot";
          reply = issue("snapshot.read", { snapshot: textOf(snapshot["id"]) });
        } else if (found.step === "snapshot") {
          const snapshot = asRecord(
            toolContent(text)["snapshot"],
            "snapshot",
          );
          const error = asRecord(snapshot["error"], "error");
          assertEquals(textOf(error["message"]), found.facts.snapshotMessage);
          assertEquals(textOf(error["name"]), found.facts.snapshotName);
          found.text = interpretationText(found.facts);
          found.step = "create";
          reply = issue("document.create", {
            title: "문제 해석",
            place: { kind: "app", id: APP },
            name: "broken-interpretation",
            text: found.text,
            media_type: "text/markdown",
            evidence: {
              relied_on: [{
                document: found.facts.designDocument,
                version: found.facts.designVersion,
              }],
              missing: ["release에 적힌 verification 기록이 없다"],
            },
          });
        } else if (found.step === "create") {
          const saved = toolContent(text);
          const evidence = asRecord(saved["evidence"], "evidence");
          const read = evidence["read"] as {
            document?: string;
            version?: string;
          }[];
          assertEquals(evidence["all_read"], false);
          assert(
            read.some((item) =>
              item.document === found.facts.designDocument &&
              item.version === found.facts.designVersion
            ),
            JSON.stringify(evidence),
          );
          found.document = textOf(saved["document"]);
          found.version = textOf(saved["version"]);
          assert(found.document.startsWith("doc_"), JSON.stringify(saved));
          assert(found.version.startsWith("ver_"), JSON.stringify(saved));
          found.step = "outline";
          reply = issue("document.outline", {
            reference: {
              document: found.document,
              version: found.version,
              section: null,
            },
            depth: 6,
          });
        } else if (found.step === "outline") {
          const content = toolContent(text);
          const entries = content["entries"] as {
            key?: string;
            title?: string;
            anchor?: string | null;
          }[];
          const section = entries.find((entry) =>
            entry.title === "원인 가설" || entry.anchor === "causes"
          );
          const ready = content["section_status"] === "whole" &&
            typeof section?.key === "string";
          found.outlines += 1;
          if (!ready && found.outlines < 20) {
            await delay(1000);
            reply = issue("document.outline", {
              reference: {
                document: found.document,
                version: found.version,
                section: null,
              },
              depth: 6,
            });
          } else {
            assert(
              ready && typeof section?.key === "string",
              JSON.stringify(content).slice(0, 400),
            );
            found.section = section.key;
            found.step = "link";
            reply = issue("problem.set_interpretation", {
              problem: found.facts.problem,
              document: found.document,
              interpretation: {
                version: found.version,
                section: section.key,
              },
              explanation: LINK_EXPLANATION,
            });
          }
        } else if (found.step === "link") {
          const saved = toolContent(text);
          const link = asRecord(saved["interpretation"], "interpretation");
          assertEquals(textOf(link["version"]), found.version);
          assertEquals(textOf(link["section"]), found.section);
          found.step = "done";
          reply = said(LINK_DONE);
        } else {
          fail(`script가 끝났다: ${found.step}`);
        }
      } catch (error) {
        found.failure = error instanceof Error ? error.message : String(error);
        return Response.json({ error: found.failure }, { status: 500 });
      }
      const built = buildReply("messages", reply);
      return new Response(built.body ?? "", {
        status: built.status,
        headers: built.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    close: () => server.shutdown(),
    failure: () => found.failure,
    step: () => found.step,
    callsNamed: () => named,
    body: (index) => bodies[index] ?? "",
    calls: () => bodies.length,
    facts: () => found.facts,
    text: () => found.text,
    document: () => found.document,
    version: () => found.version,
    section: () => found.section,
  };
}

type RunSeen = {
  state: string;
  outcome: { kind: string; reason: string } | null;
  source: { kind: string; message?: string };
};

async function runRows(
  flow: FlowShell,
  assignment: string,
): Promise<RunSeen[]> {
  const body = await mustCall(flow, {
    kind: "read",
    resource: "runs",
    method: "list",
    body: { assignment },
  });
  return body.runs as RunSeen[];
}

async function visibleSurfaces(flow: FlowShell): Promise<string> {
  return String(
    await flow.evaluate(`(() => {
      const selectors = [
        "[data-ops-panel]",
        "[data-dock]",
        "[data-question-strip]",
        "[data-question-text]",
      ];
      return selectors.map((selector) =>
        document.querySelector(selector)?.innerText ?? ""
      ).join("\\n");
    })()`),
  );
}

function assertWritingHidden(text: string): void {
  for (
    const token of [
      "problem.set_interpretation",
      "document.create",
      "document.outline",
      "document.read_version",
      "verification.read",
      "report.read",
      "snapshot.read",
      "가설 1",
      "부족한 근거",
      "통과로 쓰지 않음",
      FOURTH_CAUSE,
      "group_key",
      "payload",
      RENDER_MESSAGE,
      "snp_",
      "rpt_",
      "rel_",
      "vrf_",
      "doc_",
      "ver_",
    ]
  ) {
    assert(!text.includes(token), `${token} ${text.slice(0, 400)}`);
  }
}

async function untilRunDone(
  flow: FlowShell,
  assignment: string,
  message: string,
  script: InterpretScript,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 180_000;
  let last = "";
  for (;;) {
    assert(script.failure() === "", script.failure());
    assertWritingHidden(await visibleSurfaces(flow));
    assertEquals(await flow.count("[data-dock]"), 0);
    assertEquals(await flow.count("[data-question-strip]"), 0);
    const run = (await runRows(flow, assignment)).find((item) =>
      item.source.message === message
    );
    last = JSON.stringify(run);
    if (run?.state === "waiting_user") {
      throw new Error(`사람이 기다리는 중: ${last}`);
    }
    if (run?.state === "finished") {
      assertEquals(run.outcome?.kind, "completed", last);
      return;
    }
    assert(
      Date.now() < deadline,
      `${label} ${last} ${script.body(script.calls() - 1).slice(-400)}`,
    );
    await delay(400);
  }
}

async function readDocumentText(
  flow: FlowShell,
  document: string,
  version: string,
  section: string | null,
  status: string,
): Promise<string> {
  const deadline = Date.now() + 60_000;
  let last = "";
  for (;;) {
    const body = await mustCall(flow, {
      kind: "worker",
      resource: "documents",
      method: "read",
      body: {
        reference: { document, version, section: null },
        section,
        include_children: section !== null,
      },
    });
    last = JSON.stringify(body).slice(0, 300);
    if (typeof body["text"] === "string" && body["section_status"] === status) {
      return body["text"];
    }
    assert(Date.now() < deadline, last);
    await delay(250);
  }
}

Deno.test({
  name:
    "lophn-agent/roles/app-engineer#R14 R15 flow app-broken 4: 사실과 원인 가설을 구별한 해석 문서를 고정하고 문제에 연결한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-broken-" });
    let opened: FlowShell | undefined;
    let script: InterpretScript | undefined;
    try {
      await Deno.chmod(home, 0o700);
      const first = await openFlowShell({ home });
      await first.close();
      const bundle = await prepareBrokenApp(home, {
        installedHome,
        removeTree,
      });
      seedLedger(home, bundle);
      recordAppCreated(home);
      const flow = await openFlowShell({ home, start: `app:${APP}` });
      opened = flow;
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
        "앱 공간이 서지 않았다",
      );
      const runningAt = Date.now() + 60_000;
      for (;;) {
        const runtime = await mustCall(flow, {
          kind: "read",
          resource: "apps",
          method: "runtime",
          body: { app: APP },
        });
        if ((runtime.state as { state: string }).state === "running") break;
        assert(Date.now() < runningAt, "앱이 뜨지 않았다");
        await delay(500);
      }
      await flow.until(
        `document.querySelector('[data-phase="failed"] button') !== null || document.querySelector('[data-report-problem]:not([disabled])') !== null`,
        "화면 상태가 오지 않았다",
      );
      if ((await flow.count('[data-phase="failed"] button')) > 0) {
        await flow.click('[data-phase="failed"] button');
      }
      await flow.until(
        `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
        "[Report a problem]이 켜지지 않았다",
      );
      const render = await waitRender(flow);
      assert(render.snapshot?.error?.message === RENDER_MESSAGE);
      const screenReason = reasonOf(
        render.snapshot.screen_missing_reason,
        "screen",
      );

      script = startInterpretScript(render.report.id);
      await mustCall(flow, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: commandBody({
          id: PROVIDER_4,
          name: "fixture",
          definition: {
            key: "anthropic",
            display_name: "Anthropic",
            protocols: ["anthropic-messages"],
            auth_kinds: ["none"],
            models_endpoint: null,
            oauth: null,
            revision: "2026-01-01",
          },
          endpoint: script.url,
          protocol: "anthropic-messages",
        }),
      });
      const defaults = await mustCall(flow, {
        kind: "read",
        resource: "agent-model-defaults",
        method: "read",
        body: {},
      });
      const settingsSeq = (defaults.defaults as { settings_seq: string })
        .settings_seq;
      await mustCall(flow, {
        kind: "command",
        resource: "agent-model-defaults",
        method: "change",
        body: commandBody(
          {
            judgment: {
              provider: PROVIDER_4,
              credentials: [],
              model_name: MODEL_4,
              reasoning_level: "provider_default",
              options: {},
            },
            organizing: null,
            settings_seq: settingsSeq,
          },
          { settings_seq: settingsSeq },
        ),
      });
      let engineer: Engineer | undefined;
      await waitFor("App Engineer assignment가 없다", async () => {
        engineer = await engineerOf(flow);
        return engineer?.state === "enabled";
      });
      assert(engineer !== undefined);
      await openIssues(flow);
      assertEquals(await flow.count("[data-dock]"), 0);
      assertWritingHidden(await visibleSurfaces(flow));

      const openedSession = await mustCall(flow, {
        kind: "command",
        resource: "sessions",
        method: "open",
        body: commandBody({
          id: SESSION_4,
          assignment: engineer.id,
          role: "app_engineer",
          work_place: { kind: "app", id: APP },
          continued_from: null,
        }, {
          assignment_revision: engineer.revision,
          assignment_state: "enabled",
        }),
      });
      await mustCall(flow, {
        kind: "command",
        resource: "messages",
        method: "receive",
        body: commandBody({
          id: DESIGN_MESSAGE,
          session: SESSION_4,
          content: {
            schema_version: 1,
            parts: [{ kind: "text", text: DESIGN_ASK }],
          },
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: String(
            (openedSession as { state_seq: string }).state_seq,
          ),
          assignment_revision: engineer.revision,
          assignment_state: "enabled",
        }),
      });
      await untilRunDone(
        flow,
        engineer.id,
        DESIGN_MESSAGE,
        script,
        "설계 run",
      );
      assertEquals(script.step(), "look");

      const session = await mustCall(flow, {
        kind: "read",
        resource: "sessions",
        method: "read",
        body: { session: SESSION_4 },
      });
      const again = await engineerOf(flow);
      assert(again !== undefined);
      await mustCall(flow, {
        kind: "command",
        resource: "messages",
        method: "receive",
        body: commandBody({
          id: LOOK_MESSAGE,
          session: SESSION_4,
          content: {
            schema_version: 1,
            parts: [{ kind: "text", text: LOOK }],
          },
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: String(
            (session.session as { state_seq: string }).state_seq,
          ),
          assignment_revision: again.revision,
          assignment_state: "enabled",
        }),
      });
      await untilRunDone(
        flow,
        engineer.id,
        LOOK_MESSAGE,
        script,
        "해석 run",
      );
      assertEquals(script.failure(), "");
      assertEquals(script.step(), "done");

      const named = script.callsNamed();
      for (
        const forbidden of [
          "ticket.create",
          "ticket.make_ready",
          "question.submit",
        ]
      ) {
        assertEquals(named.includes(forbidden), false, named.join(","));
      }
      assertEquals(
        named.filter((name) => name === "document.create").length,
        2,
      );
      assert(named.includes("document.outline"), named.join(","));
      assertEquals(named.at(-1), "problem.set_interpretation");
      const facts = script.facts();
      assertEquals(facts.problem, render.report.problem);
      assertEquals(facts.status, "open");
      assertEquals(facts.release, RELEASE);
      assertEquals(facts.planningVersion, null);
      assertEquals(facts.snapshotMessage, RENDER_MESSAGE);
      assertEquals(facts.snapshotName, "TypeError");
      assertEquals(facts.screenReason, screenReason);
      assertEquals(facts.verification, VERIFICATION);
      assertEquals(facts.verificationStatus, "failure");
      assertEquals(facts.settingsSentence, SETTINGS_SENTENCE);
      assertEquals(facts.screenSentence, SCREEN_SENTENCE);
      const saved = script.text();
      assert(saved.includes(facts.problem), saved);
      assert(saved.includes(facts.release), saved);
      assert(saved.includes(facts.snapshotMessage), saved);
      assert(saved.includes(facts.screenReason), saved);
      assert(saved.includes(facts.designDocument), saved);
      assert(saved.includes(facts.designVersion), saved);
      assert(saved.includes(SETTINGS_SENTENCE), saved);
      assert(saved.includes(SCREEN_SENTENCE), saved);
      assert(saved.includes(VERIFICATION), saved);
      assert(saved.includes("통과로 쓰지 않음"), saved);
      assert(saved.includes(facts.testsState), saved);
      assert(!saved.includes("통과함"), saved);
      if (facts.testsState === "not_run") {
        assert(saved.includes("결과가 없다"), saved);
      }
      assertEquals(saved.split("### 가설 ").length - 1, 3);
      assert(!saved.includes("가설 4"), saved);
      const causesAt = saved.indexOf("## 원인 가설");
      const missingAt = saved.indexOf("## 부족한 근거");
      assert(causesAt >= 0 && missingAt > causesAt, saved);
      assert(!saved.slice(causesAt, missingAt).includes(FOURTH_CAUSE), saved);
      assert(saved.slice(missingAt).includes(FOURTH_CAUSE), saved);
      for (const cause of [CAUSE_1, CAUSE_2, CAUSE_3]) {
        assert(saved.slice(causesAt, missingAt).includes(cause), cause);
      }

      const whole = await readDocumentText(
        flow,
        script.document(),
        script.version(),
        null,
        "whole",
      );
      assertEquals(whole, saved);
      const sectionText = await readDocumentText(
        flow,
        script.document(),
        script.version(),
        script.section(),
        "found",
      );
      assert(sectionText.includes(CAUSE_1), sectionText);
      assert(sectionText.includes(CAUSE_3), sectionText);
      assert(!sectionText.includes(FOURTH_CAUSE), sectionText);
      const gotDocument = await mustCall(flow, {
        kind: "read",
        resource: "documents",
        method: "get",
        body: { document: script.document(), version: script.version() },
      });
      assertEquals(
        (gotDocument.version as { id: string }).id,
        script.version(),
      );

      const got = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get",
        body: { problem: facts.problem },
      });
      const problem = got.problem as {
        status: string;
        work: string | null;
        closure: unknown;
        interpretation: { version: string; section: string | null };
      };
      assertEquals(problem.status, "open");
      assertEquals(problem.work, null);
      assertEquals(problem.closure, null);
      assertEquals(problem.interpretation, {
        version: script.version(),
        section: script.section(),
      });
      const detail = got.detail as {
        progress: { state: string; label: string };
        owner: { label: string };
        result: { tests: { state: string } };
      };
      assertEquals(detail.progress, { state: "open", label: "Open" });
      assertEquals(detail.owner.label, NOBODY);
      assertEquals(detail.result.tests.state, facts.testsState);
      assert(detail.result.tests.state !== "pass");

      const questions = await mustCall(flow, {
        kind: "read",
        resource: "questions",
        method: "list",
        body: {},
      });
      assertEquals(questions.questions, []);
      const tickets = await mustCall(flow, {
        kind: "read",
        resource: "tickets",
        method: "list",
        body: { app: APP },
      });
      assertEquals(tickets.tickets, []);
      const verifications = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "list-verifications",
        body: { app: APP },
      });
      for (
        const row of verifications.verifications as { result: string }[]
      ) {
        assert(row.result !== "pass", JSON.stringify(row));
      }
      const runs = await runRows(flow, engineer.id);
      assertEquals(runs.length, 2);
      assert(
        runs.every((run) => run.outcome?.kind === "completed"),
        JSON.stringify(runs),
      );

      const notes = await notesOf(flow);
      assertNoteSafe(notes);
      const noteDump = JSON.stringify(notes);
      assert(!noteDump.includes("원인 가설"), noteDump);
      assert(!noteDump.includes(FOURTH_CAUSE), noteDump);
      assert(!noteDump.includes("통과로 쓰지 않음"), noteDump);
      assertWritingHidden(await visibleSurfaces(flow));
      const openedDetail = await flow.evaluate(`(() => {
        const open = [...document.querySelectorAll("[data-issues-list] [data-issue-open]")]
          .find((el) => el.textContent === ${
        JSON.stringify(EXCEPTION_SYMPTOM)
      });
        if (!open) return false;
        open.click();
        return true;
      })()`);
      assertEquals(openedDetail, true);
      await flow.until(
        `document.querySelector("[data-issue-needed]") !== null`,
        "문제 상세가 열리지 않았다",
      );
      const nowText = String(
        await flow.evaluate(
          `document.querySelector("[data-issue-now]")?.innerText ?? ""`,
        ),
      );
      assert(nowText.includes(NOBODY), nowText);
      assert(nowText.includes("Open"), nowText);
      assert(nowText.includes("No repair work yet"), nowText);
      const detailText = String(
        await flow.evaluate(
          `document.querySelector("[data-issue-detail]")?.innerText ?? ""`,
        ),
      );
      assertScreenHidesRaw(detailText);
      assertWritingHidden(detailText);
      assertEquals(await flow.count("[data-dock]"), 0);
      assertEquals(await flow.count("[data-question-strip]"), 0);
    } finally {
      await script?.close();
      await opened?.close();
      await removeTree(home);
    }
  },
});
