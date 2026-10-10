// platform operations slice flow E2E: catch-up-notifications(docs/flows/catch-up-notifications.md).
// 실제 shell(headless)·core·worker를 임시 LOPHN_HOME으로 띄운다. OS notification은 사람이
// settings에서 켠 뒤에만 가고, headless 표시는 LOPHN_SHELL_OS_NOTIFY=fail로 실패한다.
// 계기는 사람이 직접 만든 context의 watch 변화(ContextWatchedItemChanged)다.
//
// 이 파일이 단정하지 않는 갈래:
// - 끝난 question·approval의 오래된 notification, ticket 검사와 문제 닫힘. 이 준비로는
//   그 결정을 만들지 않는다.
// - core가 살아 있는 채 event socket만 끊겼다가 같은 core에 다시 붙는 경우. harness가 socket만
//   끊지 못한다. core를 죽이면 shell main에는 core를 다시 띄우거나 구독을 다시 잇는 길이
//   없어(`reconnect`를 부르는 곳이 없다) 앱을 다시 시작해야 붙는다. 그 경우만 아래 test가 본다.
// - 이 test는 core를 다시 시작한 뒤 실패 이유를 확인하지 않는다. 실패 관측은 프로세스
//   메모리라 재시작 뒤에는 성공으로 채우지 않을 뿐이다. 창만 닫았다 다시 연 뒤의 다음
//   조회는 아래 맨 끝의 test가 본다.
import { assert, assertEquals } from "@std/assert";

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
