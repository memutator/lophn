// platform operations slice flow E2E: catch-up-notifications(docs/flows/catch-up-notifications.md).
// 실제 shell(headless)·core·worker를 임시 LOPHN_HOME으로 띄운다. OS notification은 사람이
// settings에서 켠 뒤에만 가고, headless 표시는 LOPHN_SHELL_OS_NOTIFY=fail로 실패한다.
// 계기는 사람이 직접 만든 context의 watch 변화(ContextWatchedItemChanged)다.
//
// 이 파일이 단정하지 않는 갈래:
// - 끝난 question·approval의 오래된 notification, ticket 검사와 문제 닫힘. 이 준비로는
//   그 결정을 만들지 않는다.
// - 연결이 끊긴 뒤 놓친 진행을 재생하지 않음. harness가 socket만 끊지 못한다.
// - notification 줄의 발생 시각·원래 문서 링크. 이 계기 줄은 결정 화면으로 열리지 않는다.
// - 창을 닫은 뒤의 실패 이유 문구. 실패 관측은 프로세스 메모리라 재시작 뒤 성공으로
//   채우지 않을 뿐, 같은 실행의 다음 조회에서만 이유를 확인한다.
import { assert, assertEquals } from "@std/assert";

import {
  copyFixture,
  editExternally,
} from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  mustCall,
  openFlowShell,
  registerTrackedProject,
  removeHome,
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
