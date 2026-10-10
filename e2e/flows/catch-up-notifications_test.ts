// platform operations slice flow E2E: catch-up-notifications(docs/flows/catch-up-notifications.md).
// 실제 shell(headless)·core·worker를 임시 LOPHN_HOME으로 띄운다. OS notification은 사람이
// settings에서 켠 뒤에만 가고, headless 표시는 LOPHN_SHELL_OS_NOTIFY=fail로 실패한다.
// 계기는 사람이 직접 만든 context의 watch 변화(ContextWatchedItemChanged)다.
//
// 이 파일이 단정하지 않는 갈래:
// - 문제 닫힘(ProblemClosed). 사실을 내는 길이 machine credential의 record-report와 reproduction
//   Verification이라 이 shell 기동에서는 만들지 못한다(아래 ticket test의 ignore step).
//   끝난 question·approval의 오래된 notification과 ticket 검사 결과는 아래 test가 본다.
// - core가 살아 있는 채 event socket만 끊겼다가 같은 core에 다시 붙는 경우. harness가 socket만
//   끊지 못한다. core를 죽이면 shell main에는 core를 다시 띄우거나 구독을 다시 잇는 길이
//   없어(`reconnect`를 부르는 곳이 없다) 앱을 다시 시작해야 붙는다. 그 경우만 아래 test가 본다.
// - 이 test는 core를 다시 시작한 뒤 실패 이유를 확인하지 않는다. 실패 관측은 프로세스
//   메모리라 재시작 뒤에는 성공으로 채우지 않을 뿐이다. 창만 닫았다 다시 연 뒤의 다음
//   조회는 아래 맨 끝의 test가 본다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";

import { fingerprint } from "../../packages/base/mod.ts";
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";

import {
  copyFixture,
  editExternally,
} from "../../fixtures/projects/scenarios.ts";
import {
  descendantPids,
  e2eEnabled,
  processAlive,
  READY_TIMEOUT_MS,
  signalPids,
} from "../harness.ts";
import type { PageSession } from "../run.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  mustCall,
  openFlowShell,
  PROJECT,
  registerTrackedProject,
  removeHome,
  repoRoot,
  untilDocuments,
  untilSearch,
} from "../flow-support.ts";

const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const FOCUS_TITLE = "Something you follow changed";
const FAILURE_PHRASE = "Couldn't show this as a desktop notification";
const RAW_OS_ERROR = "headless os-notification fails";

const FIRST_GLOSSARY = `# 용어집

## 문서

문서 하나가 한 정본을 가지는 대상이다.

## 용어

용어는 사람이 정한 새로운 뜻이다.
`;

const SECOND_GLOSSARY = `# 용어집

## 문서

문서 하나가 한 정본을 가지는 대상이다.

## 용어

용어는 두 번째로 바뀐 뜻이다.
`;

type Delivery = {
  state: string;
  reason?: string;
  observed_at?: string;
};

type Listed = {
  notification: { id: string; source_seq: string; read_at: string | null };
  source_event: string;
  occurred_at?: string;
  document?: string | null;
  delivery?: Delivery;
};

async function screenOf(flow: FlowShell): Promise<string> {
  const value = await flow.evaluate(
    `document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") ?? ""`,
  );
  return typeof value === "string" ? value : "";
}

async function focusOf(flow: FlowShell): Promise<string> {
  const value = await flow.evaluate(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body";
    return [
      el.tagName,
      el.getAttribute("role") ?? "",
      el.getAttribute("data-action") ?? "",
    ].join(":");
  })()`);
  return typeof value === "string" ? value : "";
}

async function listNotifications(flow: FlowShell): Promise<Listed[]> {
  const page = await mustCall(flow, {
    kind: "read",
    resource: "notifications",
    method: "list",
    body: {},
  });
  return page.notifications as Listed[];
}

async function untilWatchNotifications(
  flow: FlowShell,
  count: number,
  what: string,
): Promise<Listed[]> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: Listed[] = [];
  for (;;) {
    last = await listNotifications(flow);
    if (
      last.length === count &&
      last.every((row) => row.source_event === "ContextWatchedItemChanged")
    ) return last;
    assert(
      Date.now() < deadline,
      `${what}: ${JSON.stringify(last.map((row) => row.source_event))}`,
    );
    await delay(250);
  }
}

async function notificationOf(flow: FlowShell, id: string): Promise<Listed> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "notifications",
    method: "get",
    body: { notification: id },
  });
  return got as unknown as Listed;
}

async function untilFailed(flow: FlowShell, id: string): Promise<Delivery> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: unknown;
  for (;;) {
    const got = await notificationOf(flow, id);
    const listed = (await listNotifications(flow)).find((row) =>
      row.notification.id === id
    );
    last = { get: got.delivery, list: listed?.delivery };
    if (
      got.delivery?.state === "failed" &&
      got.delivery.reason === "show_failed" &&
      listed?.delivery?.state === "failed" &&
      listed.delivery.reason === "show_failed"
    ) {
      assertEquals(listed.delivery, got.delivery);
      assert(
        typeof got.delivery.observed_at === "string" &&
          got.delivery.observed_at.length > 0,
      );
      assert(
        !JSON.stringify(got.delivery).includes(RAW_OS_ERROR),
        JSON.stringify(got.delivery),
      );
      return got.delivery;
    }
    assert(
      Date.now() < deadline,
      `전달이 failed가 아니다: ${JSON.stringify(last)}`,
    );
    await delay(200);
  }
}

async function visibleEventTypes(flow: FlowShell): Promise<Set<string>> {
  const types = new Set<string>();
  let after = "0";
  for (let page = 0; page < 20; page++) {
    const read = await mustCall(flow, {
      kind: "read",
      resource: "events",
      method: "list",
      body: { after_seq: after },
    });
    for (const event of read.events as { type: string }[]) {
      types.add(event.type);
    }
    const through = String(read.scanned_through_seq);
    const head = String(read.head_seq);
    if (BigInt(through) >= BigInt(head)) return types;
    assert(BigInt(through) > BigInt(after), "event 조회가 전진하지 않는다");
    after = through;
  }
  throw new Error("event 조회가 head에 닿지 않았다");
}

async function runCount(flow: FlowShell): Promise<number> {
  const page = await mustCall(flow, {
    kind: "read",
    resource: "runs",
    method: "list",
    body: {},
  });
  return (page.runs as unknown[]).length;
}

async function watchChanges(flow: FlowShell): Promise<unknown> {
  const page = await mustCall(flow, {
    kind: "read",
    resource: "contexts",
    method: "watch",
    body: { context: CONTEXT },
  });
  return page.changes;
}

async function openNotificationsTab(flow: FlowShell): Promise<void> {
  await flow.mouseClickText("[role=tab]", "Notifications");
  await flow.until(
    `document.querySelector("[data-tab-panel='notifications']") !== null`,
    "Notifications 탭이 열리지 않았다",
  );
}

function assertStoredLine(row: Listed, document: string): string {
  assert(
    typeof row.occurred_at === "string" &&
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(row.occurred_at),
    JSON.stringify(row),
  );
  assertEquals(row.document, document);
  assertEquals("payload" in row, false);
  return row.occurred_at;
}

async function assertVisibleLine(
  flow: FlowShell,
  id: string,
  occurredAt: string,
  document: string,
): Promise<void> {
  await flow.until(
    `(() => {
      const row = document.querySelector("[data-notification='${id}']");
      const time = row?.querySelector("[data-occurred-at]");
      const link = row?.querySelector("[data-document]");
      return time?.getAttribute("data-occurred-at") === ${
      JSON.stringify(occurredAt)
    }
        && (time.textContent ?? "").trim().length > 0
        && link?.getAttribute("data-document") === ${JSON.stringify(document)}
        && (link.textContent ?? "").trim() === "Open the document";
    })()`,
    "notification 줄에 당시 발생 시각이나 원래 문서 링크가 없다",
  );
}

function showsInternalName(text: string | null): boolean {
  const value = text ?? "";
  return value.includes(RAW_OS_ERROR) ||
    value.includes("show_failed") ||
    value.includes("unconfirmed") ||
    value.includes("ContextWatchedItemChanged");
}

Deno.test({
  name:
    "platform/notifications#R1 platform/notifications#R2 platform/notifications#R3 platform/notifications#R4 platform/notifications#R5 platform/notifications#R6 platform/notifications#R8 platform/notifications#R9 platform/notifications#R10 platform/notifications#R11 shell/desktop#R9 shell/desktop#R10 shell/wording#R2 flow catch-up-notifications: watch 계기 → OS 표시 실패 → 읽음",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    try {
      let flow = await openFlowShell({
        start: "settings",
        osNotifyFails: true,
      });
      const home = flow.home;
      try {
        let focusBefore = "";
        await t.step(
          "shell/desktop#R10 platform/notifications#R9: OS notification은 사람이 켠 뒤에만 준비된다",
          async () => {
            assertEquals(await screenOf(flow), "settings");
            await flow.until(
              `[...document.querySelectorAll("[role=tab]")].some((el) => el.textContent.trim() === "Notifications")`,
              "settings에 Notifications 탭이 없다",
            );
            await flow.mouseClickText("[role=tab]", "Notifications");
            await flow.until(
              `document.querySelector('[data-action="os-notifications"] [role=switch]')?.getAttribute("aria-checked") === "false"`,
              "OS notification 스위치가 꺼진 채로 오지 않았다",
            );
            await flow.mouseClick(
              '[data-action="os-notifications"] [role=switch]',
            );
            await flow.until(
              `document.querySelector('[data-notice="saved"]')?.textContent.includes("Saved. Notifications follow this choice.") && document.querySelector('[data-action="os-notifications"] [role=switch]')?.getAttribute("aria-checked") === "true"`,
              "OS notification을 켜서 저장하지 못했다",
            );
            assertEquals(await screenOf(flow), "settings");
          },
        );

        let glossaryId = "";
        let section = "";
        await t.step(
          "platform/notifications#R1 platform/notifications#R2: 문서 관측과 context 구성만으로는 notification을 만들지 않는다",
          async () => {
            await registerTrackedProject(flow, { folder });
            await untilDocuments(
              flow,
              ["glossary", "migration"],
              "문서 관측 대기",
            );
            await untilSearch(
              flow,
              "용어",
              (page) => page.results.length > 0,
              "목차 반영 대기",
            );
            const glossary = await documentTitled(flow, "glossary");
            const migration = await documentTitled(flow, "migration");
            glossaryId = glossary.id;
            const outline = await mustCall(flow, {
              kind: "worker",
              resource: "outline",
              method: "document",
              body: {
                reference: {
                  document: glossary.id,
                  version: glossary.latest_version,
                  section: null,
                },
              },
            });
            section = (outline.entries as { key: string; title: string }[])
              .find((row) => row.title === "용어")?.key ?? "";
            assert(section, `용어 section이 없다: ${JSON.stringify(outline)}`);
            await mustCall(flow, {
              kind: "command",
              resource: "contexts",
              method: "create",
              body: commandBody({
                id: CONTEXT,
                title: "Reading terms",
                purpose: "자료에서 쓰는 말의 변화를 확인한다.",
                items: [
                  {
                    target: {
                      kind: "document",
                      document: glossary.id,
                      section: null,
                    },
                    perspective: "basis",
                    reason: "말을 정하는 기준",
                  },
                  {
                    target: {
                      kind: "document",
                      document: migration.id,
                      section: null,
                    },
                    perspective: "reference",
                    reason: "사용하는 배경",
                  },
                  {
                    target: {
                      kind: "document",
                      document: glossary.id,
                      section,
                    },
                    perspective: "watch",
                    reason: "뜻의 변화만 확인",
                  },
                ],
              }),
            });
            assertEquals(await listNotifications(flow), []);
            assertEquals(await runCount(flow), 0);
            assertEquals(await screenOf(flow), "settings");
            focusBefore = await focusOf(flow);
          },
        );

        let firstId = "";
        await t.step(
          "shell/desktop#R10 platform/notifications#R9 platform/notifications#R1: 같은 화면과 focus를 유지한 채 고정 제목만 보여 준다",
          async () => {
            await editExternally(folder, "glossary.md", FIRST_GLOSSARY);
            const rows = await untilWatchNotifications(
              flow,
              1,
              "watch notification 대기",
            );
            firstId = rows[0].notification.id;
            await flow.until(
              `(() => {
              const chip = document.querySelector("[data-notification-chip]");
              const screen = document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen");
              return chip !== null && (chip.textContent ?? "").includes(${
                JSON.stringify(FOCUS_TITLE)
              }) && screen === "settings";
            })()`,
              "notification chip이 settings 화면을 유지한 채 오지 않았다",
            );
            assertEquals(await screenOf(flow), "settings");
            assertEquals(await focusOf(flow), focusBefore);
            const chip = await flow.text("[data-notification-chip]");
            assert(chip?.includes(FOCUS_TITLE), chip ?? undefined);
            assert(!showsInternalName(chip), chip ?? "");
            const types = await visibleEventTypes(flow);
            assert(types.has("NotificationCreated"), [...types].join(","));
            assert(
              !types.has("ContextWatchedItemChanged"),
              [...types].join(","),
            );
          },
        );

        await t.step(
          "platform/notifications#R8 platform/notifications#R10 platform/notifications#R3 shell/desktop#R9 shell/wording#R2: 다음 조회에 같은 사실과 안전한 실패 이유가 있고 재시도 run은 없다",
          async () => {
            const delivery = await untilFailed(flow, firstId);
            assertEquals(delivery.state, "failed");
            assertEquals(delivery.reason, "show_failed");
            await flow.mouseClickText(
              "[data-notification-chip] button",
              "View",
            );
            await flow.until(
              `document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") === "things-to-confirm"`,
              "View가 things-to-confirm으로 가지 않았다",
            );
            await flow.until(
              `document.querySelector("[data-tab-panel='waiting'] [data-counts]") !== null`,
              "기다리는 결정 목록이 서지 않았다",
            );
            assertEquals(
              await flow.count(
                "[data-tab-panel='waiting'] ul:not([data-counts]) li",
              ),
              0,
            );
            const waitingEmpty = await flow.text(
              "[data-tab-panel='waiting'] [data-empty]",
            );
            if (waitingEmpty !== null) {
              assertEquals(waitingEmpty.trim(), "Nothing is waiting for you.");
            }
            await flow.mouseClickText("[role=tab]", "Past");
            await flow.until(
              `document.querySelector("[data-tab-panel='past'] [data-empty]")?.textContent.includes("Nothing has been decided yet.")`,
              "지난 결과가 비어 있지 않다",
            );
            await openNotificationsTab(flow);
            await flow.until(
              `document.querySelector("[data-notification='${firstId}'][data-unread] [data-os-failed='show_failed']") !== null`,
              "notification 줄에 OS 실패 이유가 없다",
            );
            const row = await flow.text(`[data-notification="${firstId}"]`);
            assert(row?.includes(FOCUS_TITLE), row ?? undefined);
            assert(row?.includes("Unread"), row ?? undefined);
            assert(row?.includes(FAILURE_PHRASE), row ?? undefined);
            assert(!showsInternalName(row), row ?? "");
            assertEquals(
              await listNotifications(flow).then((rows) => rows.length),
              1,
            );
            await delay(2_000);
            assertEquals(
              await listNotifications(flow).then((rows) => rows.length),
              1,
            );
            assertEquals(await runCount(flow), 0);
            assert(
              (await notificationOf(flow, firstId)).notification.read_at ===
                null,
            );
          },
        );

        await t.step(
          "platform/notifications#R3 shell/desktop#R9: notification 줄에 당시 발생 시각과 원래 문서 링크가 있다",
          async () => {
            const listed = (await listNotifications(flow)).find((row) =>
              row.notification.id === firstId
            );
            assert(listed);
            const occurredAt = assertStoredLine(listed, glossaryId);
            const got = await notificationOf(flow, firstId);
            assertEquals(got.occurred_at, occurredAt);
            assertEquals(got.document, glossaryId);
            await assertVisibleLine(flow, firstId, occurredAt, glossaryId);
            assertEquals(
              await flow.count("[data-notification] [data-document]"),
              1,
            );
            await flow.click(
              `[data-notification="${firstId}"] [data-document]`,
            );
            await flow.until(
              `document.querySelector("[data-reader='${glossaryId}']") !== null && document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") === "documents"`,
              "원래 문서가 열리지 않았다",
            );
            await flow.click('[data-screen="things-to-confirm"]');
            await openNotificationsTab(flow);
            await assertVisibleLine(flow, firstId, occurredAt, glossaryId);
          },
        );

        let secondId = "";
        await t.step(
          "platform/notifications#R11 shell/desktop#R9: 서로 다른 사실 둘을 버리지 않는다",
          async () => {
            const stayed = await screenOf(flow);
            await editExternally(folder, "glossary.md", SECOND_GLOSSARY);
            const rows = await untilWatchNotifications(
              flow,
              2,
              "두 번째 watch notification 대기",
            );
            secondId = rows.find((row) => row.notification.id !== firstId)
              ?.notification.id ?? "";
            assert(secondId);
            await untilFailed(flow, secondId);
            assertEquals(
              (await notificationOf(flow, firstId)).delivery?.state,
              "failed",
            );
            await flow.until(
              `document.querySelectorAll("[data-os-failed='show_failed']").length === 2`,
              "두 notification의 OS 실패 이유가 화면에 없다",
            );
            assertEquals(await screenOf(flow), stayed);
            assertEquals(await flow.count("[data-notification]"), 2);
            assertEquals(await runCount(flow), 0);
            assert(glossaryId !== "" && section !== "");
            const both = await listNotifications(flow);
            assertEquals(both.length, 2);
            const times = new Set<string>();
            for (const row of both) {
              const occurredAt = assertStoredLine(row, glossaryId);
              times.add(occurredAt);
              await assertVisibleLine(
                flow,
                row.notification.id,
                occurredAt,
                glossaryId,
              );
            }
            assertEquals(times.size, 2);
            assertEquals(
              await flow.count("[data-notification] [data-document]"),
              2,
            );
          },
        );

        let readId = "";
        let unreadId = "";
        await t.step(
          "platform/notifications#R5 platform/notifications#R6 shell/desktop#R10: 읽음은 명시적이고 클릭만으로 결정하지 않는다",
          async () => {
            const changes = JSON.stringify(await watchChanges(flow));
            readId = firstId;
            unreadId = secondId;
            await flow.click(`[data-notification="${readId}"] button`);
            assertEquals(await screenOf(flow), "things-to-confirm");
            assert(
              (await notificationOf(flow, readId)).notification.read_at ===
                null,
            );
            await flow.mouseClickText("[role=tab]", "Waiting");
            await flow.until(
              `document.querySelector("[data-tab-panel='waiting'] [data-counts]") !== null`,
              "기다리는 결정 목록이 다시 서지 않았다",
            );
            assertEquals(
              await flow.count(
                "[data-tab-panel='waiting'] ul:not([data-counts]) li",
              ),
              0,
            );
            await openNotificationsTab(flow);
            await flow.click(
              `[data-notification="${readId}"] [data-mark-read]`,
            );
            await flow.until(
              `document.querySelector("[data-notification='${readId}']")?.hasAttribute("data-unread") === false && document.querySelector("[data-notification='${unreadId}']")?.hasAttribute("data-unread") === true`,
              "하나만 읽음이 되지 않았다",
            );
            const marked = await flow.text(`[data-notification="${readId}"]`);
            assert(
              marked?.includes("Read") === true && !marked.includes("Unread"),
              marked ?? undefined,
            );
            assert(
              (await notificationOf(flow, readId)).notification.read_at !==
                null,
            );
            assert(
              (await notificationOf(flow, unreadId)).notification.read_at ===
                null,
            );
            assertEquals(JSON.stringify(await watchChanges(flow)), changes);
            assertEquals((await listNotifications(flow)).length, 2);
            assertEquals(await runCount(flow), 0);
          },
        );

        await t.step(
          "platform/notifications#R4 platform/notifications#R5 platform/notifications#R8: 재시작 뒤 같은 notification과 읽음이 남고 성공으로 채우지 않는다",
          async () => {
            await flow.close();
            flow = await openFlowShell({
              home,
              start: "things-to-confirm",
              osNotifyFails: true,
            });
            const rows = await listNotifications(flow);
            assertEquals(
              rows.map((row) => row.notification.id).sort(),
              [
                firstId,
                secondId,
              ].sort(),
            );
            const read = rows.find((row) => row.notification.id === readId);
            const unread = rows.find((row) => row.notification.id === unreadId);
            assert(read?.notification.read_at !== null);
            assert(unread?.notification.read_at === null);
            for (const row of rows) {
              const state = row.delivery?.state;
              assert(
                state === "unconfirmed" ||
                  (state === "failed" &&
                    row.delivery?.reason === "show_failed"),
                JSON.stringify(row.delivery),
              );
            }
            await openNotificationsTab(flow);
            await flow.until(
              `document.querySelector("[data-notification='${readId}']")?.hasAttribute("data-unread") === false && document.querySelector("[data-notification='${unreadId}'][data-unread]") !== null`,
              "재시작 뒤 읽음이 화면에 남지 않았다",
            );
            assertEquals(await flow.count("[data-notification]"), 2);
            assertEquals(await runCount(flow), 0);
            assertEquals(
              (await watchChanges(flow) as unknown[]).length > 0,
              true,
            );
          },
        );
      } finally {
        try {
          await flow.close();
        } catch {
          // 재시작 단계에서 이미 닫았거나 기동이 실패한 경우다.
        }
        await removeHome(home);
      }
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// 아래는 위 Deno.test가 보지 않은 갈래를 하나씩 더한 test다. 위 test의 단계는 그대로다.
// 각 test는 새 shell과 임시 LOPHN_HOME을 쓴다.

/** settings에서 사람이 OS notification을 켠다(위 test의 첫 단계와 같은 조작). */
async function enableOsNotifications(flow: FlowShell): Promise<void> {
  await flow.until(
    `[...document.querySelectorAll("[role=tab]")].some((el) => el.textContent.trim() === "Notifications")`,
    "settings에 Notifications 탭이 없다",
  );
  await flow.mouseClickText("[role=tab]", "Notifications");
  await flow.until(
    `document.querySelector('[data-action="os-notifications"] [role=switch]')?.getAttribute("aria-checked") === "false"`,
    "OS notification 스위치가 꺼진 채로 오지 않았다",
  );
  await flow.mouseClick('[data-action="os-notifications"] [role=switch]');
  await flow.until(
    `document.querySelector('[data-action="os-notifications"] [role=switch]')?.getAttribute("aria-checked") === "true"`,
    "OS notification을 켜서 저장하지 못했다",
  );
}

/** 용어집의 한 절을 watch하는 context를 만든다. 문서를 고치면 watch notification이 생긴다. */
async function watchGlossary(
  flow: FlowShell,
  folder: string,
): Promise<{ glossary: string }> {
  await registerTrackedProject(flow, { folder });
  await untilDocuments(flow, ["glossary", "migration"], "문서 관측 대기");
  await untilSearch(
    flow,
    "용어",
    (page) => page.results.length > 0,
    "목차 반영 대기",
  );
  const glossary = await documentTitled(flow, "glossary");
  const outline = await mustCall(flow, {
    kind: "worker",
    resource: "outline",
    method: "document",
    body: {
      reference: {
        document: glossary.id,
        version: glossary.latest_version,
        section: null,
      },
    },
  });
  const section = (outline.entries as { key: string; title: string }[])
    .find((row) => row.title === "용어")?.key ?? "";
  assert(section, `용어 section이 없다: ${JSON.stringify(outline)}`);
  await mustCall(flow, {
    kind: "command",
    resource: "contexts",
    method: "create",
    body: commandBody({
      id: CONTEXT,
      title: "Reading terms",
      purpose: "자료에서 쓰는 말의 변화를 확인한다.",
      items: [{
        target: { kind: "document", document: glossary.id, section },
        perspective: "watch",
        reason: "뜻의 변화만 확인",
      }],
    }),
  });
  return { glossary: glossary.id };
}

Deno.test({
  name:
    "platform/notifications#R8 platform/notifications#R10 platform/notifications#R4 shell/desktop#R9 shell/wording#R2 flow catch-up-notifications: 창을 닫고 다시 연 뒤 다음 조회에도 같은 notification과 실패 이유 문구가 보인다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    try {
      const flow = await openFlowShell({
        start: "settings",
        osNotifyFails: true,
      });
      const home = flow.home;
      try {
        let notificationId = "";
        await t.step(
          "platform/notifications#R8 platform/notifications#R10: 창이 열려 있는 동안 OS 표시가 실패한다",
          async () => {
            await enableOsNotifications(flow);
            await watchGlossary(flow, folder);
            await editExternally(folder, "glossary.md", FIRST_GLOSSARY);
            const rows = await untilWatchNotifications(
              flow,
              1,
              "watch notification 대기",
            );
            notificationId = rows[0].notification.id;
            await untilFailed(flow, notificationId);
          },
        );

        await t.step(
          "platform/notifications#R8: 창을 닫아도 shell과 core는 그대로 있다",
          async () => {
            const closed = await flow.shell.mainEvaluate(
              `(async () => {
                for (const window of electron.BrowserWindow.getAllWindows()) window.close();
                const deadline = Date.now() + 10000;
                while (electron.BrowserWindow.getAllWindows().length > 0) {
                  if (Date.now() > deadline) return -1;
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                return 0;
              })()`,
            );
            assertEquals(closed, 0, "창이 닫히지 않았다");
            assert(
              processAlive(flow.shell.pid),
              "창을 닫았는데 shell main이 끝났다",
            );
          },
        );

        await t.step(
          "platform/notifications#R4 platform/notifications#R8 platform/notifications#R10 shell/desktop#R9 shell/wording#R2: 창을 다시 열면 같은 notification과 실패 이유가 보이고 새 notification이나 run은 없다",
          async () => {
            await openSecondWindow(flow.home);
            const page = await flow.shell.connect("//desktop/");
            const screen = pageHelpers(page);
            await screen.until(
              `document.querySelector("[data-space]") !== null && document.querySelector("[data-connection]") === null`,
              "다시 연 창이 core 준비 상태가 되지 않았다",
            );
            // 창만 닫혔으니 core 기록은 그대로다: 같은 notification과 안전한 실패 이유.
            await screen.until(
              `document.querySelector('[data-screen="things-to-confirm"]') !== null`,
              "things-to-confirm 입구가 없다",
            );
            await screen.click('[data-screen="things-to-confirm"]');
            await screen.mouseClickText("[role=tab]", "Notifications");
            await screen.until(
              `document.querySelector("[data-notification='${notificationId}'][data-unread] [data-os-failed='show_failed']") !== null`,
              "다시 연 창의 notification 줄에 OS 실패 이유가 없다",
            );
            const row = String(
              await page.evaluate(
                `document.querySelector("[data-notification='${notificationId}']")?.textContent ?? ""`,
              ),
            );
            assert(row.includes(FOCUS_TITLE), row);
            assert(row.includes(FAILURE_PHRASE), row);
            assert(!showsInternalName(row), row);
            const listed = await screen.read("notifications", "list", {});
            assertEquals(listed.notifications.length, 1);
            assertEquals(
              listed.notifications[0].delivery?.state,
              "failed",
            );
            assertEquals(
              listed.notifications[0].delivery?.reason,
              "show_failed",
            );
            assertEquals(
              (await screen.read("runs", "list", {})).runs.length,
              0,
            );
            await delay(2_000);
            assertEquals(
              (await screen.read("notifications", "list", {})).notifications
                .length,
              1,
            );
          },
        );
      } finally {
        try {
          await flow.close();
        } catch {
          // 이미 닫혔다.
        }
        await removeHome(home);
      }
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  },
});

/**
 * 같은 데이터 root로 shell을 한 번 더 시작한다. 두 번째 시작은 single instance lock에 막혀
 * 끝나고, 이미 떠 있는 main에 새 기본 창을 요청할 뿐이다(shell/desktop#R13).
 */
async function openSecondWindow(home: string): Promise<void> {
  const second = new Deno.Command(
    `${repoRoot}/apps/shell/main/node_modules/electron/dist/electron`,
    {
      args: [`${repoRoot}/apps/shell/main/dist/main.cjs`, "--home", home],
      env: {
        ...Deno.env.toObject(),
        LOPHN_HOME: home,
        LOPHN_SHELL_HEADLESS: "1",
      },
      stdout: "null",
      stderr: "null",
    },
  );
  const child = second.spawn();
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // 이미 끝났다.
    }
  }, 30_000);
  try {
    await child.status;
  } finally {
    clearTimeout(timer);
  }
}

/** FlowShell이 아닌 CDP page 하나(다시 연 창)에 쓰는 조작. */
function pageHelpers(page: PageSession) {
  const until = async (expression: string, what: string): Promise<void> => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        last = await page.evaluate(expression);
      } catch (error) {
        last = String(error);
      }
      if (last) return;
      await delay(200);
    }
    throw new Error(`${what}: ${JSON.stringify(last)}`);
  };
  const click = async (selector: string): Promise<void> => {
    const clicked = await page.evaluate(
      `(() => { const el = document.querySelector(${
        JSON.stringify(selector)
      }); if (!el) return false; el.click(); return true; })()`,
    );
    assertEquals(clicked, true, `누를 요소가 없다: ${selector}`);
  };
  const mouseClickText = async (
    selector: string,
    text: string,
  ): Promise<void> => {
    const target = await page.evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((item) => item.textContent?.trim() === ${JSON.stringify(text)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    })()`);
    assert(typeof target === "string", `글이 ${text}인 요소가 없다`);
    const point = JSON.parse(target) as { x: number; y: number };
    const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
    await page.command("Input.dispatchMouseEvent", {
      ...base,
      type: "mouseMoved",
      button: "none",
    });
    await page.command("Input.dispatchMouseEvent", {
      ...base,
      type: "mousePressed",
    });
    await page.command("Input.dispatchMouseEvent", {
      ...base,
      type: "mouseReleased",
    });
  };
  // 사람 token의 read를 이 창의 core 통로로 부른다.
  const read = async (
    resource: string,
    method: string,
    body: unknown,
  ): Promise<{ notifications: Listed[]; runs: unknown[] }> => {
    const reply = JSON.parse(String(
      await page.evaluate(
        `window.lophnCore.call(${
          JSON.stringify({ kind: "read", resource, method, body })
        }).then((reply) => JSON.stringify(reply))`,
      ),
    )) as { ok: boolean; value: never };
    assert(reply.ok, JSON.stringify(reply));
    return reply.value;
  };
  return { until, click, mouseClickText, read };
}

/** shell이 띄운 core process의 pid. cmdline에 core entry가 있는 자손이다. */
async function corePid(shellPid: number): Promise<number> {
  for (const pid of await descendantPids(shellPid)) {
    try {
      const cmdline = await Deno.readTextFile(`/proc/${pid}/cmdline`);
      if (cmdline.includes("apps/core/main.ts")) return pid;
    } catch {
      // 그 사이 끝난 process다.
    }
  }
  throw new Error("shell 아래에서 core process를 찾지 못했다");
}

Deno.test({
  name:
    "shell/desktop#R7 platform/notifications#R4 platform/notifications#R8 platform/notifications#R11 flow catch-up-notifications: core 연결이 끊기면 마지막 화면을 유지하고 다시 시작한 뒤 놓친 진행을 연속 재생하지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    try {
      let flow = await openFlowShell({
        start: "settings",
        osNotifyFails: true,
      });
      const home = flow.home;
      try {
        let firstId = "";
        await t.step(
          "shell/desktop#R9: 연결된 동안 notification 하나가 things-to-confirm에 보인다",
          async () => {
            await enableOsNotifications(flow);
            await watchGlossary(flow, folder);
            await editExternally(folder, "glossary.md", FIRST_GLOSSARY);
            const rows = await untilWatchNotifications(
              flow,
              1,
              "watch notification 대기",
            );
            firstId = rows[0].notification.id;
            await untilFailed(flow, firstId);
            await flow.click('[data-screen="things-to-confirm"]');
            await openNotificationsTab(flow);
            await flow.until(
              `document.querySelector("[data-notification='${firstId}'] [data-os-failed='show_failed']") !== null`,
              "연결된 동안 notification 줄이 보이지 않는다",
            );
            assertEquals(await flow.count("[data-stale]"), 0);
          },
        );

        await t.step(
          "shell/desktop#R7: core 연결이 끊기면 마지막 화면을 유지하고 최신 확인 못함과 확인 시각을 보이며 새 notification을 지어내지 않는다",
          async () => {
            signalPids([await corePid(flow.shell.pid)], "SIGKILL");
            await flow.until(
              `document.querySelector("[data-stale]") !== null`,
              "연결이 끊겼는데 최신 확인 못함 표시가 없다",
            );
            const stale = String(await flow.text("[data-stale]"));
            assert(stale.trim().length > 0, "확인 시각 안내가 비었다");
            assert(!showsInternalName(stale), stale);
            // 마지막 화면 그대로: 같은 화면, 같은 탭, 같은 notification 줄.
            assertEquals(await screenOf(flow), "things-to-confirm");
            assertEquals(
              await flow.count("[data-notification]"),
              1,
            );
            assert(
              (await flow.text(`[data-notification="${firstId}"]`))?.includes(
                FOCUS_TITLE,
              ),
            );
            // 끊긴 동안 읽음을 대신 처리하지 못한다.
            assertEquals(
              await flow.evaluate(
                `document.querySelector("[data-notification='${firstId}'] [data-mark-read]")?.hasAttribute("disabled")`,
              ),
              true,
            );
            await delay(2_000);
            assertEquals(await flow.count("[data-notification]"), 1);
          },
        );

        let secondId = "";
        await t.step(
          "shell/desktop#R7 platform/notifications#R4 platform/notifications#R11: 다시 시작하면 현재 기록으로 맞추고 놓친 진행을 한 줄씩 다시 알리지 않는다",
          async () => {
            // 끊긴 동안 일어난 변화. core가 없으니 이 변화는 다시 시작해야 보인다.
            await editExternally(folder, "glossary.md", SECOND_GLOSSARY);
            await flow.close();
            flow = await openFlowShell({
              home,
              start: "things-to-confirm",
              osNotifyFails: true,
            });
            const rows = await untilWatchNotifications(
              flow,
              2,
              "놓친 변화의 notification 대기",
            );
            secondId = rows.find((row) => row.notification.id !== firstId)
              ?.notification.id ?? "";
            assert(secondId);
            await openNotificationsTab(flow);
            // 두 사실 모두 개별 줄로 닿고 화면은 현재 기록 하나로 맞는다.
            await flow.until(
              `document.querySelectorAll("[data-notification]").length === 2`,
              "다시 시작한 화면이 두 notification을 보이지 않는다",
            );
            // 읽지 않은 notification은 chip 하나에 모인다. 줄마다 chip을 다시 띄우지 않는다.
            assertEquals(await flow.count("[data-notification-chip]"), 1);
            assertEquals(await runCount(flow), 0);
            assertEquals(await flow.count("[data-stale]"), 0);
          },
        );

        await t.step(
          "shell/desktop#R7 platform/notifications#R8: 다시 붙기 전에 있던 notification은 OS 표시를 다시 시도하지 않는다",
          async () => {
            // 다시 붙기 전에 이미 있던 첫 notification은 따라잡기 backlog라 지금 도착한
            // event가 아니다. 표시를 다시 시도했다면 실패 관측이 생겨 failed로 바뀐다.
            await delay(3_000);
            const first = await notificationOf(flow, firstId);
            assertEquals(first.delivery?.state, "unconfirmed");
            assertEquals(first.delivery?.reason, undefined);
            assertEquals(await runCount(flow), 0);
          },
        );
      } finally {
        try {
          await flow.close();
        } catch {
          // 이미 닫았거나 기동이 실패한 경우다.
        }
        await removeHome(home);
      }
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  },
});

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";
const APPROVAL = "apr_01arz3ndektsv4rrffq69g5faa";
const SLOT = "asg_01arz3ndektsv4rrffq69g5fav";
const QUESTION_PROMPT = "Which wording?";

/** 질문 하나를 만들고 곧 끝나는 model 판단 둘. */
const ASK_ONE = {
  steps: [
    {
      id: "ask",
      protocol: "messages" as const,
      reply: {
        text: "One decision is yours.",
        toolCalls: [{
          id: "toolu_1",
          name: "question.submit",
          arguments: JSON.stringify({
            prompt: QUESTION_PROMPT,
            reason: "the glossary has two possible meanings",
            options: [
              {
                key: "keep",
                label: "Keep the current wording",
                description: "Leave the glossary as it is.",
                evidence: [],
                adoption: null,
                action: null,
              },
              {
                key: "change",
                label: "Change the wording",
                description: "Rewrite the glossary entry.",
                evidence: [],
                adoption: null,
                action: null,
              },
            ],
            recommendation: null,
            expires_at: null,
          }),
        }],
        usage: { input: 20, output: 8 },
        stop: "tool_calls" as const,
      },
    },
    {
      id: "end",
      protocol: "messages" as const,
      reply: {
        text: "Tell me when you decide.",
        usage: { input: 40, output: 9 },
        stop: "end" as const,
      },
    },
  ],
};

type Created = { id: string; created_seq: string };

/**
 * 사람이 직접 낸 approval 요청 하나(Operator 붙이기). 허락·거절은 보호 확인 창의 몫이라 이
 * flow는 요청이 서는 데까지만 쓰고, 끝은 요청자의 취소로 만든다.
 */
async function createApproval(
  flow: FlowShell,
  document: string,
  draftVersion: string,
): Promise<Created> {
  const preset = await mustCall(flow, {
    kind: "command",
    resource: "presets",
    method: "create",
    body: commandBody({
      id: "pst_01arz3ndektsv4rrffq69g5fa1",
      definition: {
        kind: "operator",
        name: "catch-up operator",
        origin: "user",
        prompt: "ab".repeat(32),
        capability: { bundles: [], tools: [] },
        context: [{ kind: "project", target: PROJECT, section: null }],
        mcp: { servers: [], tools: [] },
        safe_tools: [],
        skills: [],
        model: null,
        organizing_model: null,
        instructions: [],
      },
      copied_from: null,
    }),
  });
  const value = {
    approval: APPROVAL,
    id: SLOT,
    bundle: {
      draft_version: draftVersion,
      assignment: null,
      expected_assignment_revision: null,
      preset: (preset.preset as { id: string }).id,
      preset_revision: 1,
      preset_definition:
        (preset.preset as { definition_hash: string }).definition_hash,
      scope: { kind: "project", id: PROJECT },
      outputs: [{ document, content: "watch changes" }],
      read_apps: [],
      read_commands: [],
      schedule: {
        first_at: new Date(Date.now() + 60_000).toISOString(),
        every_ms: 60_000,
      },
      reason: "Attached from the roles screen.",
    },
  };
  const base = {
    concern: "lophn-agent/assignments",
    command: "ApplyOperatorAssignment",
    caller: "user",
    targets: [SLOT],
    input: { kind: "inline", value },
    input_hash: await fingerprint(value),
    comparison: {},
  };
  const action = {
    ...base,
    binding_hash: await fingerprint({ ...base, binding_hash: "0" }),
  };
  const created = await mustCall(flow, {
    kind: "command",
    resource: "approvals",
    method: "create",
    body: commandBody({
      id: APPROVAL,
      requester: "user",
      run: null,
      reason: "Attached from the roles screen.",
      effect: {
        changes: "Attach or change the Operator exactly as shown.",
        external: null,
        reversible: true,
        reversibility: "You can withdraw it at any time.",
      },
      action,
      expires_at: null,
    }),
  });
  const request = created.request as { id: string; created_seq: string };
  return { id: request.id, created_seq: request.created_seq };
}

async function untilNotificationsOf(
  flow: FlowShell,
  events: readonly string[],
  what: string,
): Promise<Listed[]> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: Listed[] = [];
  for (;;) {
    last = await listNotifications(flow);
    const seen = last.map((row) => row.source_event).sort();
    if (JSON.stringify(seen) === JSON.stringify([...events].sort())) {
      return last;
    }
    assert(Date.now() < deadline, `${what}: ${JSON.stringify(seen)}`);
    await delay(250);
  }
}

Deno.test({
  name:
    "platform/notifications#R6 platform/notifications#R7 platform/approvals#R7 lophn-agent/questions#R9 lophn-agent/conversation#R11 flow catch-up-notifications: 끝난 question과 approval의 오래된 notification을 열면 당시 사실과 현재 결과만 보이고 되살리지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const provider = startFakeProvider({
      script: ASK_ONE,
      nowMs: () => Date.now(),
      instant: true,
    });
    let flow = await openFlowShell({ start: "lophn" });
    const home = flow.home;
    try {
      let approval: Created = { id: "", created_seq: "" };
      let questionId = "";
      let before = { runs: 0, sessions: 0 };

      const counts = async () => ({
        runs: await runCount(flow),
        sessions: ((await mustCall(flow, {
          kind: "read",
          resource: "sessions",
          method: "list",
          body: {},
        })).sessions as unknown[]).length,
      });
      const question = async () => {
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "questions",
          method: "list",
          body: {},
        });
        return (listed.questions as {
          id: string;
          status: string;
          answer: unknown;
          closed_reason: string | null;
          created_seq: string;
        }[]).find((row) => row.id === questionId);
      };
      const approvalNow = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "approvals",
          method: "get",
          body: { approval: approval.id },
        })) as { request: { status: string }; use: unknown };

      await t.step(
        "platform/notifications#R1 lophn-agent/questions#R3 platform/approvals#R3: 질문과 approval 요청이 각각 하나의 notification이 되고 지금 기다리는 결정으로 보인다",
        async () => {
          await registerTrackedProject(flow, { folder });
          await untilDocuments(flow, ["glossary"], "문서 관측 대기");
          const glossary = await documentTitled(flow, "glossary");
          approval = await createApproval(
            flow,
            glossary.id,
            glossary.latest_version,
          );
          await mustCall(flow, {
            kind: "command",
            resource: "providers",
            method: "register",
            body: commandBody({
              id: PROVIDER,
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
              endpoint: provider.url,
              protocol: "anthropic-messages",
            }),
          });
          const defaults = await mustCall(flow, {
            kind: "read",
            resource: "agent-model-defaults",
            method: "read",
            body: {},
          });
          const seq =
            (defaults.defaults as { settings_seq: string }).settings_seq;
          await mustCall(flow, {
            kind: "command",
            resource: "agent-model-defaults",
            method: "change",
            body: commandBody(
              {
                judgment: {
                  provider: PROVIDER,
                  credentials: [],
                  model_name: MODEL,
                  reasoning_level: "provider_default",
                  options: {},
                },
                organizing: null,
                settings_seq: seq,
              },
              { settings_seq: seq },
            ),
          });
          await flow.click("[data-dock-toggle]");
          await flow.until(
            `document.querySelector("[data-new-session]") !== null`,
            "새 세션 단추가 서지 않았다",
          );
          await flow.click("[data-new-session]");
          await flow.until(
            `document.querySelector("[data-composer-input]") !== null`,
            "입력칸이 서지 않았다",
          );
          await flow.type("[data-composer-input]", "Tidy the glossary.");
          await flow.click("[data-send]");
          await untilNotificationsOf(
            flow,
            ["ApprovalRequestCreated", "QuestionCreated"],
            "질문과 approval notification 대기",
          );
          const asked = await mustCall(flow, {
            kind: "read",
            resource: "questions",
            method: "list",
            body: { status: "pending" },
          });
          questionId = (asked.questions as { id: string }[])[0].id;
          assertEquals((await approvalNow()).request.status, "pending");
          assertEquals((await question())?.status, "pending");
        },
      );

      await t.step(
        "platform/approvals#R7 lophn-agent/questions#R9: 질문은 미루고 approval은 요청자가 취소해 둘 다 끝난다",
        async () => {
          await flow.until(
            `document.querySelector("[data-question-text='ready']") !== null`,
            "질문이 칸에 서지 않았다",
          );
          await flow.click("[data-later]");
          await flow.until(
            `document.querySelector("[data-question-strip]") === null`,
            "미룬 질문이 칸에 남아 있다",
          );
          const cancelled = await mustCall(flow, {
            kind: "command",
            resource: "approvals",
            method: "cancel",
            body: commandBody(
              {
                approval: approval.id,
                created_seq: approval.created_seq,
                closed_reason: null,
              },
              { created_seq: approval.created_seq },
            ),
          });
          assertEquals(
            (cancelled.request as { status: string }).status,
            "cancelled",
          );
          assertEquals((await question())?.status, "cancelled");
          // 끝난 뒤에도 notification은 둘 다 그대로다.
          assertEquals((await listNotifications(flow)).length, 2);
          before = await counts();
        },
      );

      const openOld = async (
        sourceEvent: string,
        id: string,
        status: string,
      ) => {
        const row = (await listNotifications(flow)).find((item) =>
          item.source_event === sourceEvent
        );
        assert(row, `${sourceEvent} notification이 없다`);
        await openNotificationsTab(flow);
        await flow.click(
          `[data-notification="${row.notification.id}"] button`,
        );
        await flow.until(
          `document.querySelector("[data-detail='${id}'] [data-request-id='${id}'][data-status='${status}']") !== null`,
          `끝난 ${sourceEvent}의 현재 결과가 보이지 않는다`,
        );
        // 결정으로 가는 통로는 없다: 선택지·미루기·취소·허락 검토.
        for (
          const control of [
            "[data-option]",
            "[data-later]",
            "[data-cancel-question]",
            "[data-send-answer]",
            "[data-review]",
          ]
        ) {
          assertEquals(
            await flow.count(`[data-detail='${id}'] ${control}`),
            0,
            `끝난 요청에 ${control}가 남았다`,
          );
        }
        return row;
      };

      await t.step(
        "platform/notifications#R6 platform/notifications#R7 lophn-agent/questions#R9 lophn-agent/conversation#R11: 끝난 질문의 notification을 열면 현재 결과만 보이고 다시 답할 수 없으며 run이나 세션이 늘지 않는다",
        async () => {
          await flow.click('[data-screen="things-to-confirm"]');
          await flow.until(
            `document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") === "things-to-confirm"`,
            "things-to-confirm으로 가지 않았다",
          );
          // 지금 기다리는 결정은 없다. 끝난 것은 지난 결과에 있다.
          await flow.until(
            `document.querySelector("[data-tab-panel='waiting'] [data-counts]") !== null`,
            "기다리는 결정 목록이 서지 않았다",
          );
          assertEquals(
            await flow.count(
              "[data-tab-panel='waiting'] ul:not([data-counts]) li",
            ),
            0,
          );
          await openOld("QuestionCreated", questionId, "cancelled");
          const after = await question();
          assertEquals(after?.status, "cancelled");
          assertEquals(after?.answer, null);
          assertEquals(await counts(), before);
          assertEquals((await listNotifications(flow)).length, 2);
        },
      );

      await t.step(
        "platform/notifications#R6 platform/notifications#R7 platform/approvals#R7: 끝난 approval의 notification을 열면 현재 결과만 보이고 허락이나 실행으로 이어지지 않는다",
        async () => {
          await openOld("ApprovalRequestCreated", approval.id, "cancelled");
          const got = await approvalNow();
          assertEquals(got.request.status, "cancelled");
          assertEquals(got.use, null);
          const operators = await mustCall(flow, {
            kind: "read",
            resource: "assignments",
            method: "list",
            body: { role: "operator" },
          });
          assertEquals((operators.assignments as unknown[]).length, 0);
          assertEquals(await counts(), before);
        },
      );

      await t.step(
        "platform/notifications#R4 platform/notifications#R7: 다시 시작해도 같은 notification을 열면 같은 현재 결과이고 되살아나지 않는다",
        async () => {
          await flow.close();
          flow = await openFlowShell({ home, start: "things-to-confirm" });
          assertEquals((await listNotifications(flow)).length, 2);
          assertEquals((await question())?.status, "cancelled");
          assertEquals((await approvalNow()).request.status, "cancelled");
          await openOld("QuestionCreated", questionId, "cancelled");
          await openOld("ApprovalRequestCreated", approval.id, "cancelled");
          assertEquals(await counts(), before);
        },
      );
    } finally {
      try {
        await flow.close();
      } catch {
        // 이미 닫았거나 기동이 실패한 경우다.
      }
      await removeHome(home);
      await provider.close();
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// ---- ticket 완료 보고와 실제 검사 결과 ----
// 완료 보고(ticket_completions)는 coding agent의 MCP 호출로만 생기고 그 credential은 OS keychain이
// 필요해 이 기동에서 만들 수 없다. 그래서 core를 끈 사이 ledger에 보고된 ticket 행을 심고(test-only
// seeding, apps/core/ticket-checker_test.ts와 같은 자리), 제품 core의 checker worker가 실제 Verification
// 행을 읽어 내는 TicketConfirmed·TicketCheckFailed만 notification이 되는지 본다.

const TICKET_APP = "app_01arz3ndektsv4rrffq69g5fav";
const CMD_HASH = "d".repeat(64);

type Reported = {
  ticket: string;
  seq: string;
  release: string;
  bundle: string;
};
const CONFIRMED: Reported = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa1",
  seq: "1",
  release: "rel_01arz3ndektsv4rrffq69g5fa1",
  bundle: "a1".repeat(32),
};
const FAILED: Reported = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa2",
  seq: "2",
  release: "rel_01arz3ndektsv4rrffq69g5fa2",
  bundle: "a2".repeat(32),
};
const WAITING: Reported = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa3",
  seq: "3",
  release: "rel_01arz3ndektsv4rrffq69g5fa3",
  bundle: "a3".repeat(32),
};

function withDb<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function seedReportedTicket(
  db: DatabaseSync,
  item: Reported,
  number: number,
): void {
  db.prepare(
    `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
       data_schema, data_changes, ticket_source, created_by, created_at, status,
       activation, failure, blueprint, declarations)
     values (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'machine:releaser',
       '2026-10-07T00:00:00.000Z', 'prepared', NULL, NULL, '{}', '[]')`,
  ).run(
    item.release,
    TICKET_APP,
    number,
    "c".repeat(40),
    item.bundle,
    "e".repeat(64),
  );
  db.prepare(
    `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems,
       state, readiness, needs, cancel_reason, completion_seq, revision)
     values (?, ?, 'implementation', 't', 'w', 'y', '[]', '[]', '[]', 'reported',
       'ready', '[]', NULL, ?, ?)`,
  ).run(item.ticket, TICKET_APP, item.seq, item.seq);
  const condition = db.prepare(
    `insert into ticket_conditions (ticket, position, kind, input, condition_hash)
     values (?, ?, ?, ?, ?)`,
  );
  condition.run(item.ticket, 0, "app_test", '{"kind":"app_test"}', CMD_HASH);
  condition.run(
    item.ticket,
    1,
    "test_command",
    JSON.stringify({
      kind: "test_command",
      executable: "deno",
      argv: ["task", "test"],
      cwd: ".",
      timeout_ms: 60000,
      expected_exit_code: 0,
    }),
    CMD_HASH,
  );
  db.prepare(
    `insert into ticket_completions (ticket, seq, claim_seq, release, summary_hash,
       outputs, fix_records, verifications)
     values (?, ?, ?, ?, ?, '[]', '[]', '[]')`,
  ).run(item.ticket, item.seq, item.seq, item.release, "f".repeat(64));
}

function seedVerification(
  db: DatabaseSync,
  input: {
    id: string;
    kind: "app_test" | "test_command";
    result: "pass" | "fail";
    bundle: string;
    ticket?: Reported;
  },
): void {
  db.prepare(
    `insert into verifications (id, request_principal, request_key, request_hash, kind, app,
       target_bundle_hash, target_release, problem, basis_seq, before_release, after_release,
       ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution,
       result, reason, observations, recorded_seq, verification_canonical)
     values (?, 'user-1', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, '{}', '{}',
       ?, 'ran', '[]', '1', '{}')`,
  ).run(
    input.id,
    `key-${input.id}`,
    "f".repeat(64),
    input.kind,
    TICKET_APP,
    input.bundle,
    input.ticket?.ticket ?? null,
    input.ticket === undefined ? null : 1,
    input.ticket === undefined ? null : CMD_HASH,
    input.ticket?.seq ?? null,
    input.result,
  );
}

function ticketState(home: string, ticket: string): string {
  return withDb(
    home,
    (db) =>
      (db.prepare("select state from tickets where id = ?").get(ticket) as {
        state: string;
      }).state,
  );
}

Deno.test({
  name:
    "platform/notifications#R1 platform/notifications#R2 platform/notifications#R6 coding-agent/tickets#R18 coding-agent/tickets#R21 shell/desktop#R9 flow catch-up-notifications: ticket 완료 보고와 실제 검사 결과를 섞지 않고 notification을 열어도 ticket 상태는 그대로다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    // 첫 기동은 ledger와 schema를 만든다. 그 위에 보고된 ticket을 심고 shell을 다시 띄운다.
    let flow = await openFlowShell({ start: "things-to-confirm" });
    const home = flow.home;
    try {
      await flow.close();
      withDb(home, (db) => {
        db.prepare(
          `insert into apps (id, slug, name, description, planning_version, source_path,
             active_release, run_enabled, revision, status)
           values (?, 'notes', 'Notes', 'notes app', NULL, NULL, NULL, 0, '3', 'active')`,
        ).run(TICKET_APP);
        seedReportedTicket(db, CONFIRMED, 1);
        seedReportedTicket(db, FAILED, 2);
        seedReportedTicket(db, WAITING, 3);
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa1",
          kind: "app_test",
          result: "pass",
          bundle: CONFIRMED.bundle,
        });
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa2",
          kind: "test_command",
          result: "pass",
          bundle: CONFIRMED.bundle,
          ticket: CONFIRMED,
        });
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa3",
          kind: "app_test",
          result: "fail",
          bundle: FAILED.bundle,
        });
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa4",
          kind: "test_command",
          result: "pass",
          bundle: FAILED.bundle,
          ticket: FAILED,
        });
        // WAITING: 다른 묶음의 통과만 있다. 이 묶음의 근거가 아니다.
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa5",
          kind: "app_test",
          result: "pass",
          bundle: CONFIRMED.bundle,
        });
      });
      flow = await openFlowShell({ home, start: "things-to-confirm" });

      let confirmedId = "";
      let failedId = "";
      await t.step(
        "platform/notifications#R1 platform/notifications#R2 coding-agent/tickets#R18: 실제 검사 결과가 난 ticket만 notification이 되고 보고만 된 ticket은 되지 않는다",
        async () => {
          const deadline = Date.now() + READY_TIMEOUT_MS;
          let rows: Listed[] = [];
          for (;;) {
            rows = await listNotifications(flow);
            if (rows.length >= 2) break;
            assert(
              Date.now() < deadline,
              `검사 결과 notification 대기: ${
                JSON.stringify(rows.map((row) => row.source_event))
              }`,
            );
            await delay(250);
          }
          // checker가 남은 ticket을 마저 보는 시간을 주고 더 늘지 않는지 본다.
          await delay(3_000);
          rows = await listNotifications(flow);
          assertEquals(rows.map((row) => row.source_event).sort(), [
            "TicketCheckFailed",
            "TicketConfirmed",
          ]);
          confirmedId = rows.find((row) =>
            row.source_event === "TicketConfirmed"
          )!
            .notification.id;
          failedId = rows.find((row) =>
            row.source_event === "TicketCheckFailed"
          )!
            .notification.id;
          assertEquals(ticketState(flow.home, CONFIRMED.ticket), "confirmed");
          assertEquals(ticketState(flow.home, FAILED.ticket), "check_failed");
          // 근거가 아직 없는 ticket은 확인되지도 실패하지도 않고 보고된 채다.
          assertEquals(ticketState(flow.home, WAITING.ticket), "reported");
        },
      );

      await t.step(
        "platform/notifications#R3 shell/desktop#R9 shell/wording#R2: 두 notification은 서로 다른 안내로 읽히고 안쪽 상태 이름을 내지 않는다",
        async () => {
          await flow.until(
            `document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") === "things-to-confirm"`,
            "things-to-confirm 화면이 아니다",
          );
          await openNotificationsTab(flow);
          await flow.until(
            `document.querySelector("[data-notification='${confirmedId}']") !== null && document.querySelector("[data-notification='${failedId}']") !== null`,
            "두 notification 줄이 보이지 않는다",
          );
          const confirmed = String(
            await flow.text(`[data-notification="${confirmedId}"]`),
          );
          const failed = String(
            await flow.text(`[data-notification="${failedId}"]`),
          );
          assert(confirmed.includes("A task is ready"), confirmed);
          assert(failed.includes("A task's check failed"), failed);
          assert(!confirmed.includes("check failed"), confirmed);
          assert(!failed.includes("is ready"), failed);
          for (const text of [confirmed, failed]) {
            assert(!showsInternalName(text), text);
            assert(
              !/check_failed|TicketConfirmed|TicketCheckFailed/.test(text),
            );
          }
          // 보고된 ticket이 결정을 기다리는 일은 아니다.
          assertEquals(
            await flow.count(
              "[data-tab-panel='notifications'] [data-notification] [data-document]",
            ),
            0,
          );
        },
      );

      await t.step(
        "platform/notifications#R6 coding-agent/tickets#R21: 열고 읽음 표시해도 ticket 상태와 기다리는 결정은 바뀌지 않는다",
        async () => {
          const before = {
            confirmed: ticketState(flow.home, CONFIRMED.ticket),
            failed: ticketState(flow.home, FAILED.ticket),
            waiting: ticketState(flow.home, WAITING.ticket),
          };
          await flow.click(`[data-notification="${confirmedId}"] button`);
          await flow.click(`[data-notification="${failedId}"] button`);
          await flow.click(
            `[data-notification="${failedId}"] [data-mark-read]`,
          );
          await flow.until(
            `document.querySelector("[data-notification='${failedId}']")?.hasAttribute("data-unread") === false`,
            "읽음 표시가 되지 않았다",
          );
          assert(
            (await notificationOf(flow, failedId)).notification.read_at !==
              null,
          );
          assert(
            (await notificationOf(flow, confirmedId)).notification.read_at ===
              null,
          );
          await delay(2_000);
          assertEquals(
            ticketState(flow.home, CONFIRMED.ticket),
            before.confirmed,
          );
          assertEquals(ticketState(flow.home, FAILED.ticket), before.failed);
          assertEquals(ticketState(flow.home, WAITING.ticket), before.waiting);
          assertEquals((await listNotifications(flow)).length, 2);
          assertEquals(await runCount(flow), 0);
          await flow.mouseClickText("[role=tab]", "Waiting");
          await flow.until(
            `document.querySelector("[data-tab-panel='waiting'] [data-counts]") !== null`,
            "기다리는 결정 목록이 서지 않았다",
          );
          assertEquals(
            await flow.count(
              "[data-tab-panel='waiting'] ul:not([data-counts]) li",
            ),
            0,
          );
        },
      );

      await t.step({
        name:
          "coding-agent/tickets#R21 problems/closing: ticket 확인은 문제 닫힘이 아니고 ProblemClosed는 따로 notification이 된다",
        ignore: true,
        fn: () => {
          // 이 shell 기동에서는 닫힌 문제를 만들 길이 없다. ProblemClosed는 problems.closing 반응기가
          // 실제 reproduction Verification과 machine credential의 record-report로 내고(apps/core/
          // ticket-checker_test.ts의 repair 장면), 그 credential은 OS keychain이 필요하다.
          // 닫힘 notification은 apps/core/notifications-triggers_test.ts가 core에서 본다.
        },
      });
    } finally {
      try {
        await flow.close();
      } catch {
        // 이미 닫았거나 기동이 실패한 경우다.
      }
      await removeHome(home);
    }
  },
});
