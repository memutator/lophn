// flow build-context: 실제 headless shell·core·documents worker를 임시 LOPHN_HOME으로 연다.
// 1~4의 Context Engineer model 경로는 제품 runtime child 기동이 없어 실행하지 않는다(T26).
// 기존 사람 command로 준비한 context에서 5의 화면·고정 section 읽기, 6~7의 실제 파일 관측·
// watch·notification·전후 판 읽기, section 소실과 항목 제거·보관 갈래를 확인한다.
// 8의 contexts revert 진입은 아직 없다(shell#T36). 미확인·단절·범위 갈래는 T27의 남은 E2E다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

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

async function openFocus(flow: FlowShell): Promise<void> {
  await flow.click('[data-screen="contexts"]');
  await flow.until(
    `document.querySelector('[data-focus="${CONTEXT}"]') !== null`,
    "Focus 목록이 오지 않았다",
  );
  await flow.click(`[data-focus="${CONTEXT}"]`);
  await flow.until(
    `document.querySelector('[data-focus-head="${CONTEXT}"]') !== null`,
    "Focus 상세가 오지 않았다",
  );
}

async function watch(flow: FlowShell) {
  return await mustCall(flow, {
    kind: "read",
    resource: "contexts",
    method: "watch",
    body: { context: CONTEXT },
  }) as unknown as {
    changes: {
      target: { document: string; section: string | null };
      change_kind: string;
      before_version: string | null;
      after_version: string;
      source_seq: string;
    }[];
    unverified: unknown[];
  };
}

async function untilChange(
  flow: FlowShell,
  document: string,
  version: string,
  kind: string,
) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const page = await watch(flow);
    const change = page.changes.find((row) =>
      row.target.document === document && row.after_version !== version &&
      row.change_kind === kind
    );
    if (change) return { page, change };
    assert(Date.now() < deadline, `watch 변화가 없다: ${JSON.stringify(page)}`);
    await delay(250);
  }
}

Deno.test({
  name:
    "documents/contexts#R4 documents/contexts#R10 platform/notifications#R3 flow build-context: 관점·고정 section → 파일 변화·notification → 전후 판·소실·보관",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, { folder });
      await untilDocuments(flow, ["glossary", "migration"], "문서 관측 대기");
      await untilSearch(
        flow,
        "용어",
        (page) => page.results.length > 0,
        "목차 반영 대기",
      );
      const glossary = await documentTitled(flow, "glossary");
      const migration = await documentTitled(flow, "migration");
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
        .find((row) => row.title === "용어")?.key;
      assert(section, `용어 section이 없다: ${JSON.stringify(outline)}`);
      const target = { kind: "document", document: glossary.id, section };
      // agent 단계를 흉내 내지 않는다. documents#contexts R5의 사람 직접 구성은 fixture 준비다.
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
            { target, perspective: "watch", reason: "뜻의 변화만 확인" },
          ],
        }),
      });

      await t.step(
        "documents/contexts#R1 documents/contexts#R4: 5 목적·관점·이유를 확인하고 고른 고정 section만 읽는다",
        async () => {
          await openFocus(flow);
          assertEquals(
            await flow.text("[data-focus-purpose]"),
            "자료에서 쓰는 말의 변화를 확인한다.",
          );
          for (const perspective of ["basis", "reference", "watch"]) {
            assertEquals(
              await flow.count(
                `[data-perspective="${perspective}"] [data-item]`,
              ),
              1,
            );
          }
          assertEquals(await flow.count("[data-item-reason]"), 0);
          await flow.click('[data-item="watch"] > button');
          assertEquals(
            await flow.text('[data-item="watch"] [data-item-reason]'),
            "뜻의 변화만 확인",
          );
          await flow.click('[data-item="watch"] [data-open-item]');
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("뜻이 고정된 말")`,
            "section 본문 대기",
          );
          assertEquals(
            (await flow.text("[data-body]"))!.includes("한 정본을 가지는"),
            false,
          );
        },
      );

      let afterVersion = "";
      await t.step(
        "documents/contexts#R10 documents/contexts#R12 platform/notifications#R3: 6 파일 변화는 전후 고정 판과 같은 key로 한 번 기록하고 notification을 만든다",
        async () => {
          await editExternally(
            folder,
            "glossary.md",
            "# 용어집\n\n## 문서\n\n문서 하나가 한 정본을 가지는 대상이다.\n\n## 용어\n\n용어는 사람이 정한 새로운 뜻이다.\n",
          );
          const { page, change } = await untilChange(
            flow,
            glossary.id,
            glossary.latest_version,
            "content_changed",
          );
          afterVersion = change.after_version;
          assertEquals(change.target.section, section);
          assertEquals(change.before_version, glossary.latest_version);
          assertEquals(
            page.changes.filter((row) =>
              row.after_version === afterVersion &&
              row.target.section === section
            ).length,
            1,
          );
          const deadline = Date.now() + READY_TIMEOUT_MS;
          for (;;) {
            const notifications = await mustCall(flow, {
              kind: "read",
              resource: "notifications",
              method: "list",
              body: {},
            });
            const rows = notifications.notifications as {
              source_event: string;
            }[];
            if (
              rows.some((row) =>
                row.source_event === "ContextWatchedItemChanged"
              )
            ) break;
            assert(
              Date.now() < deadline,
              `watch notification이 없다: ${JSON.stringify(notifications)}`,
            );
            await delay(250);
          }
        },
      );

      await t.step(
        "documents/outline-and-search#R21 documents/contexts#R10: 7 화면에서 watch 근거를 열어 전후의 같은 부분을 읽는다",
        async () => {
          await openFocus(flow);
          await flow.click('[data-item="watch"] > button');
          await flow.until(
            `document.querySelector('[data-watch-change="content_changed"]') !== null`,
            "확인된 변화 화면 대기",
          );
          await flow.click("[data-open-before]");
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("뜻이 고정된 말")`,
            "이전 고정 판 대기",
          );
          assertEquals(
            (await flow.text("[data-body]"))!.includes("새로운 뜻"),
            false,
          );
          await openFocus(flow);
          await flow.click('[data-item="watch"] > button');
          await flow.click("[data-open-after]");
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("새로운 뜻")`,
            "이후 고정 판 대기",
          );
          assertEquals(
            (await flow.text("[data-body]"))!.includes("한 정본을 가지는"),
            false,
          );
        },
      );

      await t.step(
        "documents/contexts#R9: section 소실은 옛 key를 유지하고 유사 본문으로 바꾸지 않는다",
        async () => {
          await editExternally(
            folder,
            "glossary.md",
            "# 용어집\n\n## 문서\n\n문서 하나가 한 정본을 가지는 대상이다.\n\n## 새말\n\n용어는 사람이 정한 새로운 뜻이다.\n",
          );
          const { change } = await untilChange(
            flow,
            glossary.id,
            afterVersion,
            "section_missing",
          );
          assertEquals(change.target.section, section);
          await openFocus(flow);
          await flow.click('[data-item="watch"] > button');
          await flow.until(
            `document.querySelector("[data-watch-missing]") !== null`,
            "section 소실 안내 대기",
          );
          const got = await mustCall(flow, {
            kind: "read",
            resource: "contexts",
            method: "get",
            body: { context: CONTEXT },
          });
          assertEquals(
            (got.context as { items: { target: unknown }[] }).items[2].target,
            target,
          );
          assertStringIncludes(
            (await flow.text('[data-item="watch"]'))!,
            section,
          );
        },
      );

      await t.step(
        "documents/contexts#R7: 항목 제거·보관은 원자료·용어를 바꾸지 않고 watch를 멈춘다",
        async () => {
          const current = await documentTitled(flow, "glossary");
          await mustCall(flow, {
            kind: "command",
            resource: "terms",
            method: "define",
            body: commandBody({
              id: "trm_01arz3ndektsv4rrffq69g5fav",
              context: CONTEXT,
              name: "용어",
              definition: "사람이 정한 말",
            }),
          });
          const got = await mustCall(flow, {
            kind: "read",
            resource: "contexts",
            method: "get",
            body: { context: CONTEXT },
          });
          await mustCall(flow, {
            kind: "command",
            resource: "contexts",
            method: "remove_item",
            body: commandBody({
              context: CONTEXT,
              target: {
                kind: "document",
                document: migration.id,
                section: null,
              },
            }, {
              base_revision: (got.context as { revision: string }).revision,
            }),
          });
          await flow.click('[data-screen="documents"]');
          await openFocus(flow);
          assertEquals(await flow.count('[data-item="reference"]'), 0);
          await flow.click('[data-archive-focus="archive"]');
          await flow.until(
            `document.querySelector("[data-focus-archived]") !== null`,
            "Focus 보관 대기",
          );
          assertEquals(
            (await documentTitled(flow, "glossary")).latest_version,
            current.latest_version,
          );
          assertEquals(
            (await documentTitled(flow, "migration")).latest_version,
            migration.latest_version,
          );
          const term = await mustCall(flow, {
            kind: "read",
            resource: "terms",
            method: "get",
            body: { term: "trm_01arz3ndektsv4rrffq69g5fav" },
          });
          assertEquals(
            (term.term as { definition: string }).definition,
            "사람이 정한 말",
          );
          const before = (await watch(flow)).changes;
          await editExternally(
            folder,
            "glossary.md",
            "# 용어집\n\n## 용어\n\n보관 중 새 내용이다.\n",
          );
          await untilSearch(
            flow,
            "보관 중 새 내용",
            (page) => page.results.some((row) => row.document === glossary.id),
            "보관 중 새 판 index 대기",
          );
          assertEquals((await watch(flow)).changes, before);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
