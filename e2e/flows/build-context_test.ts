// flow build-context: 실제 headless shell·core·documents worker를 임시 LOPHN_HOME으로 연다.
// 1은 아래 테스트가 contexts 화면과 Context Engineer 대화로 본다. 2는 그 다음 테스트가
// 목차·검색·section·본문 범위와 blueprint 읽기 command 조회를 본다. 3~4는 이 파일에 없다.
// 이 테스트는 기존 사람 command로 준비한 context에서 5의 화면·고정 section 읽기, 6~7의 실제 파일 관측·
// watch·notification·전후 판 읽기, section 소실과 항목 제거·보관 갈래를 확인한다.
// 8의 contexts revert 진입은 아직 없다(shell#T36). 미확인·단절·범위 갈래는 T27의 남은 E2E다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { sha256Hex } from "../../packages/base/mod.ts";
import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
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

// 1: contexts 화면에서 함께 볼 목적을 말하고, 기존 context의 목적을 고치려 한다.
// 목적·경계는 roles 화면의 Context Engineer 대화에서 정한다. contexts의 Ask는 lophn 도크만
// 열므로 그 역할의 context.create를 부르지 않는다. model은 fake provider script다.
// 작업 대상은 대화가 아니라 context와 자료다. 도크를 닫아도 context와 문서 화면이 남고,
// 문서 판은 바뀌지 않는다. 항목 선정은 2~3이라 여기서 넣지 않는다.
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fb1";
const MODEL = "claude-sonnet-4-5";
const TITLE = "Reading terms";
const PURPOSE = "자료에서 쓰는 말의 변화를 확인한다. 색인은 넣지 않는다.";
const EDITED = "같은 자료에서 말의 쓰임만 본다. 색인은 넣지 않는다.";
const ASK = `함께 볼 목적을 정한다. ${PURPOSE}`;
const REVISE = `기존 context의 목적을 고친다. ${EDITED}`;
const EMBEDDED = "[data-dock='embedded']";
const INPUT = `${EMBEDDED} [data-composer-input]`;
const SEND = `${EMBEDDED} [data-send]`;

function toolCall(id: string, name: string, args: unknown): SemanticReply {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { input: 24, output: 8 },
    stop: "tool_calls",
  };
}

function said(purpose: string): SemanticReply {
  return {
    text: purpose,
    usage: { input: 16, output: 6 },
    stop: "end",
  };
}

/** 요청 본문의 마지막 tool 결과 JSON. 자료 표식 안에 있다. */
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

function contextRef(body: string): { id: string; revision: string } {
  const json = lastToolJson(body);
  const content = json["content"] as Record<string, unknown> | undefined;
  const context = content?.["context"] as Record<string, unknown> | undefined;
  const id = context?.["id"];
  const revision = context?.["revision"];
  assert(
    typeof id === "string" && typeof revision === "string",
    `context 참조가 없다: ${JSON.stringify(json).slice(0, 500)}`,
  );
  return { id, revision };
}

type Fixture = {
  url: string;
  calls: () => number;
  body: (index: number) => string;
  close: () => Promise<void>;
};

/** context id·revision은 tool 결과에만 있으므로 script는 요청을 보고 다음 답을 정한다. */
function startScript(): Fixture {
  const bodies: string[] = [];
  const made = { id: "", revision: "" };
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      const index = bodies.length;
      bodies.push(text);
      let reply: SemanticReply;
      try {
        if (index === 0) {
          reply = toolCall("toolu_create", "context.create", {
            title: TITLE,
            purpose: PURPOSE,
          });
        } else if (index === 1) {
          made.id = contextRef(text).id;
          reply = said(PURPOSE);
        } else if (index === 2) {
          reply = toolCall("toolu_read", "context.read", {
            context: made.id,
          });
        } else if (index === 3) {
          made.revision = contextRef(text).revision;
          reply = toolCall("toolu_purpose", "context.set_purpose", {
            context: made.id,
            purpose: EDITED,
            base_revision: made.revision,
          });
        } else if (index === 4) {
          reply = said(EDITED);
        } else {
          return Response.json({ error: "exhausted" }, { status: 500 });
        }
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
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
    calls: () => bodies.length,
    body: (index) => bodies[index] ?? "",
    close: () => server.shutdown(),
  };
}

async function untilCalls(provider: Fixture, count: number, what: string) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (provider.calls() >= count) return;
    assert(
      Date.now() < deadline,
      `${what}: call ${provider.calls()} ${
        provider.body(provider.calls() - 1).slice(-500)
      }`,
    );
    await delay(250);
  }
}

async function untilEngineerDone(
  flow: FlowShell,
  provider: Fixture,
  what: string,
) {
  try {
    await flow.until(
      `document.querySelector("${EMBEDDED} [data-work-status]")?.getAttribute("data-work-status") === "done"`,
      what,
      180_000,
    );
  } catch (error) {
    const dock = String(
      await flow.evaluate(
        `document.querySelector(${
          JSON.stringify(EMBEDDED)
        })?.innerText ?? null`,
      ),
    ).slice(0, 600);
    throw new Error(
      `${
        (error as Error).message
      } | calls=${provider.calls()} dock=${dock} last=${
        provider.body(provider.calls() - 1).slice(-400)
      }`,
    );
  }
}

async function openEngineer(flow: FlowShell): Promise<void> {
  await flow.click('[data-screen="roles"]');
  await flow.until(
    `[...document.querySelectorAll("[data-role]")].some((el) => el.textContent?.includes("Context Engineer"))`,
    "Context Engineer 담당이 없다",
  );
  const marked = await flow.evaluate(`(() => {
    const row = [...document.querySelectorAll("[data-role]")].find((el) =>
      el.textContent?.includes("Context Engineer")
    );
    if (!row) return false;
    row.setAttribute("data-flow-ce", "");
    return true;
  })()`);
  assertEquals(marked, true, "Context Engineer 행을 표시하지 못했다");
  await flow.click("[data-flow-ce]");
  await flow.until(
    `document.querySelector("[data-role-detail]") !== null`,
    "역할 상세가 없다",
  );
  await flow.mouseClickText("[role=tab]", "Conversation");
  await flow.until(
    `document.querySelector("${EMBEDDED} [data-new-session]") !== null`,
    "Context Engineer 대화가 서지 않았다",
  );
  if (await flow.count(INPUT) === 0) {
    await flow.click(`${EMBEDDED} [data-new-session]`);
  }
  await flow.until(
    `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
    "입력칸이 없다",
  );
}

async function sendToEngineer(flow: FlowShell, text: string): Promise<void> {
  await openEngineer(flow);
  await flow.type(INPUT, text);
  await flow.click(SEND);
}

async function shownPurpose(flow: FlowShell): Promise<string> {
  await flow.click('[data-screen="documents"]');
  await flow.click('[data-screen="contexts"]');
  await flow.until(
    `document.querySelector("[data-focus]") !== null`,
    "Focus 목록이 없다",
  );
  await flow.click("[data-focus]");
  await flow.until(
    `document.querySelector("[data-focus-purpose]") !== null`,
    "Focus 상세가 없다",
  );
  return (await flow.text("[data-focus-purpose]")) ?? "";
}

Deno.test({
  name:
    "documents/contexts#R1 documents/contexts#R5 lophn-agent/roles/context-engineer#R1 shell/desktop#R1 flow build-context: 목적을 말하고 경계를 정하면 context에 남고 대화를 닫아도 자료가 남는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const provider = startScript();
    let flow: FlowShell | undefined;
    try {
      flow = await openFlowShell({ start: "lophn" });
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
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
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
      await registerTrackedProject(flow, { folder });
      await untilDocuments(flow, ["glossary", "migration"], "문서 관측 대기");
      const glossary = await documentTitled(flow, "glossary");
      const migration = await documentTitled(flow, "migration");

      await flow.click('[data-screen="contexts"]');
      await flow.until(
        `document.querySelector("[data-focus-list]")?.textContent.includes("No focus yet")`,
        "빈 contexts 화면이 없다",
      );

      await sendToEngineer(flow, ASK);
      await untilCalls(provider, 2, "목적 생성");
      await untilEngineerDone(flow, provider, "목적 생성이 끝나지 않았다");
      assertStringIncludes(
        (await flow.text(EMBEDDED)) ?? "",
        PURPOSE,
      );
      assertEquals(await shownPurpose(flow), PURPOSE);

      await sendToEngineer(flow, REVISE);
      await untilCalls(provider, 5, "목적 수정");
      await untilEngineerDone(flow, provider, "목적 수정이 끝나지 않았다");
      assertStringIncludes(
        (await flow.text(EMBEDDED)) ?? "",
        EDITED,
      );
      assertEquals(await shownPurpose(flow), EDITED);
      const listed = await mustCall(flow, {
        kind: "read",
        resource: "contexts",
        method: "list",
        body: {},
      });
      const rows = listed.contexts as {
        purpose: string;
        items: unknown[];
      }[];
      assertEquals(
        rows.filter((row) => row.purpose === EDITED).length,
        1,
      );
      assertEquals(rows.find((row) => row.purpose === EDITED)?.items.length, 0);
      assertEquals(
        (await documentTitled(flow, "glossary")).latest_version,
        glossary.latest_version,
      );
      assertEquals(
        (await documentTitled(flow, "migration")).latest_version,
        migration.latest_version,
      );

      await flow.click("[data-ask-focus]");
      await flow.until(
        `document.querySelector("[data-close-dock]") !== null`,
        "대화 도크가 열리지 않았다",
      );
      await flow.click("[data-close-dock]");
      await flow.until(
        `document.querySelector("[data-close-dock]") === null`,
        "대화 도크가 닫히지 않았다",
      );
      assertEquals(await flow.text("[data-focus-purpose]"), EDITED);
      await flow.click('[data-screen="documents"]');
      await flow.until(
        `document.querySelector("[data-screen-body='documents']") !== null`,
        "문서 화면이 없다",
      );
      assertEquals(await shownPurpose(flow), EDITED);
    } finally {
      await flow?.close();
      await provider.close();
      if (flow !== undefined) await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// 2: Context Engineer가 목차·검색으로 이번 목적의 section과 그 본문 범위만 읽는다.
// 앱 자료 후보는 blueprint의 command 이름·설명·입력·효과를 app.commands로 조회하고,
// 앱 command는 실행하지 않는다. 앱은 실행을 켜지 않은 release 행이라 자식이 뜨지 않는다.
// 검색은 대화 화면에 나오지 않는다. model은 fake provider script다.
const NOTES_APP = "app_01arz3ndektsv4rrffq69g5fb2";
const NOTES_RELEASE = "rel_01arz3ndektsv4rrffq69g5fb2";
const NOTES_VERIFICATION = "vrf_01arz3ndektsv4rrffq69g5fb2";
const OTHER_BODY = "한 정본을 가지는";
const SECTION_BODY = "뜻이 고정된 말";
const LOOKUP =
  "이번 목적에 필요한 용어 section만 읽어 달라. 앱은 읽기 command 계약만 본다.";
const LOOKUP_REPLY = "용어 section만 읽었다.";
const NOTES_BLUEPRINT = {
  name: "Notes",
  description: "Reads notes for one purpose.",
  screens: [],
  commands: [
    {
      key: "list_notes",
      label: "List notes",
      description: "Read the note titles for this purpose.",
      effect: "read",
      confirm: false,
      input: {
        type: "object",
        description: "How many notes to list.",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of notes.",
          },
        },
        additionalProperties: false,
      },
      revert: { supported: false },
    },
    {
      key: "save_note",
      label: "Save note",
      description: "Write a note outside this purpose.",
      effect: "write",
      confirm: false,
      input: null,
      revert: { supported: false },
    },
  ],
  automatic_tasks: [],
  permissions: [],
  problem_codes: [],
  documents: [],
  agent_context: [],
  app_connections: [],
  sdk_dependencies: [],
};

function seedNotesApp(
  home: string,
  blueprintJson: string,
  blueprintHash: string,
): void {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 8000");
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'notes', 'Notes', 'Reads notes for one purpose.', NULL, NULL, ?, 0, '1', 'active')`,
    ).run(NOTES_APP, NOTES_RELEASE);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, 0, '[]', NULL, 'machine', '2026-10-01T00:00:00.000Z', 'active', NULL, NULL, ?, ?)`,
    ).run(
      NOTES_RELEASE,
      NOTES_APP,
      "a".repeat(40),
      "b".repeat(64),
      blueprintHash,
      blueprintJson,
      JSON.stringify({
        permissions: [],
        app_connections: [],
        commands: ["list_notes", "save_note"],
        automations: [],
        problem_codes: [],
        documents: [],
      }),
    );
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(NOTES_RELEASE, NOTES_VERIFICATION);
  } finally {
    db.close();
  }
}

type LookupFixture = Fixture & {
  failure: () => string;
  document: () => string;
  version: () => string;
  done: () => boolean;
  /** tool 결과가 들어 있는 요청 번호. 검색이 index 따라잡기 중이면 번호가 밀린다. */
  result: (step: "outline" | "section" | "range" | "commands") => number;
  callsNamed: () => readonly string[];
};

function toolContent(body: string): Record<string, unknown> {
  const json = lastToolJson(body);
  assertEquals(
    json["status"],
    "success",
    `tool 실패: ${JSON.stringify(json).slice(0, 500)}`,
  );
  const content = json["content"];
  assert(
    content !== null && typeof content === "object",
    `tool 본문이 없다: ${JSON.stringify(json).slice(0, 400)}`,
  );
  return content as Record<string, unknown>;
}

function offeredTools(body: string): string[] {
  const request = JSON.parse(body) as { tools?: { name?: string }[] };
  return (request.tools ?? []).map((tool) => String(tool.name ?? ""));
}

type LookupPhase =
  | "search"
  | "list"
  | "outline"
  | "section"
  | "range"
  | "apps"
  | "commands"
  | "done";

type FixedDoc = { document: string; version: string };

/** 검색·목차·section·범위·앱 command 조회. id는 tool 결과에만 있다.
 * 대화가 ledger를 앞으로 밀면 검색은 lagging으로 빈 결과를 준다. 그때는 같은 검색을
 * 몇 번만 다시 하고, 그래도 비면 document.list와 목차로 용어 section을 찾는다. */
function startLookupScript(): LookupFixture {
  const bodies: string[] = [];
  const named: string[] = [];
  const queue: FixedDoc[] = [];
  const found = {
    document: "",
    version: "",
    failure: "",
    phase: "search" as LookupPhase,
    searches: 0,
  };
  const at = { outline: -1, section: -1, range: -1, commands: -1 };
  const search = (): SemanticReply => {
    found.searches += 1;
    named.push("document.search");
    return toolCall(`toolu_search_${found.searches}`, "document.search", {
      query: "용어",
    });
  };
  const outlineNext = (): SemanticReply => {
    const next = queue.shift();
    assert(next !== undefined, "용어 section이 있는 문서가 없다");
    found.document = next.document;
    found.version = next.version;
    found.phase = "outline";
    named.push("document.outline");
    return toolCall(`toolu_outline_${named.length}`, "document.outline", {
      reference: {
        document: next.document,
        version: next.version,
        section: null,
      },
    });
  };
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      const index = bodies.length;
      bodies.push(text);
      let reply: SemanticReply;
      try {
        if (found.phase === "search" && index === 0) {
          reply = search();
        } else if (found.phase === "search") {
          const content = toolContent(text);
          const coverage = content["coverage"] as {
            lagging?: boolean;
            rebuilding?: boolean;
          } | undefined;
          const waiting = coverage?.lagging === true ||
            coverage?.rebuilding === true;
          const results = (content["results"] ?? []) as {
            document?: string;
            version?: string;
            title?: string;
            snippet?: string;
          }[];
          const hit = results.find((row) =>
            `${row.title ?? ""} ${row.snippet ?? ""}`.includes("용어")
          );
          if (hit?.document !== undefined && hit.version !== undefined) {
            queue.push({ document: hit.document, version: hit.version });
            reply = outlineNext();
          } else if (waiting && found.searches < 3) {
            await delay(1000);
            reply = search();
          } else {
            found.phase = "list";
            named.push("document.list");
            reply = toolCall("toolu_list", "document.list", {});
          }
        } else if (found.phase === "list") {
          const documents = toolContent(text)["documents"] as Record<
            string,
            unknown
          >[];
          assert(
            Array.isArray(documents),
            JSON.stringify(toolContent(text)).slice(0, 500),
          );
          for (const row of documents) {
            const nested = row["document"];
            const doc = nested !== null && typeof nested === "object"
              ? nested as Record<string, unknown>
              : row;
            const id = doc["id"] ?? doc["document"];
            const latest = doc["latest_version"] ?? row["latest_version"];
            const version = typeof latest === "string"
              ? latest
              : (latest as { id?: string } | null)?.id;
            if (typeof id === "string" && typeof version === "string") {
              queue.push({ document: id, version });
            }
          }
          assert(queue.length > 0, JSON.stringify(documents).slice(0, 500));
          reply = outlineNext();
        } else if (found.phase === "outline") {
          const entries = toolContent(text)["entries"] as {
            key?: string;
            title?: string;
          }[];
          const section = entries.find((row) => row.title === "용어")?.key;
          if (typeof section !== "string") {
            reply = outlineNext();
          } else {
            at.outline = index;
            found.phase = "section";
            named.push("document.read_section");
            reply = toolCall("toolu_section", "document.read_section", {
              reference: {
                document: found.document,
                version: found.version,
                section: null,
              },
              section,
            });
          }
        } else if (found.phase === "section") {
          at.section = index;
          const ranges = toolContent(text)["ranges"] as {
            start_line?: number;
            end_line?: number;
          }[];
          const range = ranges[0];
          assert(
            typeof range?.start_line === "number" &&
              typeof range.end_line === "number",
            JSON.stringify(ranges),
          );
          found.phase = "range";
          named.push("document.read_range");
          reply = toolCall("toolu_range", "document.read_range", {
            reference: {
              document: found.document,
              version: found.version,
              section: null,
            },
            ranges: [{
              start_line: range.start_line,
              end_line: range.end_line,
            }],
          });
        } else if (found.phase === "range") {
          at.range = index;
          toolContent(text);
          found.phase = "apps";
          named.push("app.list");
          reply = toolCall("toolu_apps", "app.list", {});
        } else if (found.phase === "apps") {
          const apps = toolContent(text)["apps"] as {
            id?: string;
            slug?: string;
          }[];
          const notes = apps.find((row) => row.slug === "notes");
          assert(notes?.id === NOTES_APP, JSON.stringify(apps).slice(0, 500));
          found.phase = "commands";
          named.push("app.commands");
          reply = toolCall("toolu_commands", "app.commands", { app: notes.id });
        } else if (found.phase === "commands") {
          at.commands = index;
          const commands = toolContent(text)["commands"] as {
            key?: string;
            effect?: string;
          }[];
          assert(
            commands.some((row) =>
              row.key === "list_notes" && row.effect === "read"
            ),
            JSON.stringify(commands).slice(0, 500),
          );
          found.phase = "done";
          reply = said(LOOKUP_REPLY);
        } else {
          return Response.json({ error: "exhausted" }, { status: 500 });
        }
      } catch (error) {
        found.failure = `call ${index}: ${
          error instanceof Error ? error.message : String(error)
        }`;
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
    calls: () => bodies.length,
    body: (index) => bodies[index] ?? "",
    close: () => server.shutdown(),
    failure: () => found.failure,
    document: () => found.document,
    version: () => found.version,
    done: () => found.phase === "done",
    result: (step) => at[step],
    callsNamed: () => named,
  };
}

async function untilLookup(provider: LookupFixture) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    assert(provider.failure() === "", provider.failure());
    if (provider.done()) return;
    assert(
      Date.now() < deadline,
      `조회 call ${provider.calls()} ${
        provider.body(provider.calls() - 1).slice(-500)
      }`,
    );
    await delay(250);
  }
}

Deno.test({
  name:
    "lophn-agent/roles/context-engineer#R2 lophn-agent/roles/context-engineer#R3 lophn-agent/roles/context-engineer#R4 lophn-agent/roles/common#R1 lophn-agent/roles/common#R3 lophn-agent/roles/common#R11 apps/blueprint#R4 apps/blueprint#R20 flow build-context: 목차·검색에서 필요한 section과 본문 범위만 읽고 앱 읽기 command 계약만 조회한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-context-read-" });
    await Deno.chmod(home, 0o700);
    const bootstrap = await openFlowShell({ home });
    await bootstrap.close();
    const blueprintJson = JSON.stringify(NOTES_BLUEPRINT);
    seedNotesApp(home, blueprintJson, await sha256Hex(blueprintJson));
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const provider = startLookupScript();
    let flow: FlowShell | undefined;
    try {
      flow = await openFlowShell({ home, start: "lophn" });
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
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
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

      await sendToEngineer(flow, LOOKUP);
      await untilLookup(provider);
      await untilEngineerDone(flow, provider, "자료 조회가 끝나지 않았다");
      const named = provider.callsNamed();
      assert(named[0] === "document.search", named.join(","));
      assert(
        named.every((name, index) =>
          index <= named.lastIndexOf("document.search")
            ? name === "document.search"
            : true
        ),
        named.join(","),
      );
      const afterSearch = named.slice(named.lastIndexOf("document.search") + 1);
      assertEquals(afterSearch.slice(-4), [
        "document.read_section",
        "document.read_range",
        "app.list",
        "app.commands",
      ]);
      assert(
        afterSearch.slice(0, -4).every((name) =>
          name === "document.list" || name === "document.outline"
        ),
        afterSearch.join(","),
      );
      assert(
        afterSearch.includes("document.outline"),
        afterSearch.join(","),
      );
      assertEquals(provider.document(), glossary.id);
      assertEquals(provider.version(), glossary.latest_version);

      const tools = offeredTools(provider.body(0));
      for (
        const name of [
          "document.search",
          "document.outline",
          "document.read_section",
          "document.read_range",
          "app.commands",
        ]
      ) {
        assert(tools.includes(name), `${name}이 제공 목록에 없다`);
      }
      for (const name of tools) {
        assert(
          !/web|browser|shell|http|fetch/i.test(name),
          `범위 밖 tool: ${name}`,
        );
        assert(name !== "list_notes" && name !== "save_note", name);
      }

      const outline = JSON.stringify(
        toolContent(provider.body(provider.result("outline"))),
      );
      assertStringIncludes(outline, "용어");
      assertEquals(outline.includes(OTHER_BODY), false);
      assertEquals(outline.includes(SECTION_BODY), false);
      assertEquals(outline.includes(folder), false);
      const section = toolContent(provider.body(provider.result("section")));
      assertEquals(section["version"], glossary.latest_version);
      assertStringIncludes(String(section["text"]), SECTION_BODY);
      assertEquals(String(section["text"]).includes(OTHER_BODY), false);
      const range = toolContent(provider.body(provider.result("range")));
      assertEquals(range["version"], glossary.latest_version);
      assertStringIncludes(String(range["text"]), SECTION_BODY);
      assertEquals(String(range["text"]).includes(OTHER_BODY), false);
      const commands = toolContent(
        provider.body(provider.result("commands")),
      )["commands"] as {
        key: string;
        description: string;
        effect: string;
        input: { type?: string } | null;
      }[];
      const readCommand = commands.find((row) => row.key === "list_notes");
      assert(readCommand !== undefined, JSON.stringify(commands));
      assertEquals(readCommand.effect, "read");
      assertEquals(
        readCommand.description,
        "Read the note titles for this purpose.",
      );
      assertEquals(readCommand.input?.type, "object");
      const commandJson = JSON.stringify(commands);
      assertEquals(commandJson.includes("source_path"), false);
      assertEquals(commandJson.includes(folder), false);
      for (let bodyIndex = 1; bodyIndex < provider.calls(); bodyIndex += 1) {
        assertEquals(provider.body(bodyIndex).includes(folder), false);
      }

      const shown = (await flow.text(EMBEDDED)) ?? "";
      assertStringIncludes(shown, LOOKUP_REPLY);
      assertEquals(shown.includes(OTHER_BODY), false);
      assertEquals(shown.includes("document.search"), false);
      assertEquals(shown.includes("document.outline"), false);
      assertEquals(shown.includes("list_notes"), false);
      await flow.click('[data-screen="documents"]');
      await flow.until(
        `document.querySelector("[data-search-input]") !== null`,
        "문서 검색칸이 없다",
      );
      assertEquals(
        await flow.evaluate(
          `document.querySelector("[data-search-input]").value`,
        ),
        "",
      );
      assertEquals(await flow.count("[data-hits] [data-hit]"), 0);

      assertEquals(
        (await documentTitled(flow, "glossary")).latest_version,
        glossary.latest_version,
      );
      assertEquals(
        (await documentTitled(flow, "migration")).latest_version,
        migration.latest_version,
      );
      const invocations = await mustCall(flow, {
        kind: "read",
        resource: "invocations",
        method: "list",
        body: { app: NOTES_APP },
      });
      assertEquals(invocations.invocations, []);
    } finally {
      await flow?.close();
      await provider.close();
      await removeHome(home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
