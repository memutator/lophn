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
// 2단계 테스트는 그 아래에 있다. 하지 않는 것: 3~9단계(notification, App Engineer, repair ticket,
// 수리, activation, 닫힘). process의 unhandled rejection은 앱 자식이 바로 끝나 이후 읽기를 막으므로
// 일으키지 않는다. 화면이 이미 root render에서 깨져 있어 실패 command는 그 view의 lophnApp(화면이
// command를 부르는 통로)으로 일으킨다. 사람 조작 화면은 없다.
import { assert, assertEquals } from "@std/assert";

import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { e2eEnabled } from "../harness.ts";
import { APP, prepareBrokenApp, RELEASE, seedLedger } from "../broken-app.ts";
import {
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
