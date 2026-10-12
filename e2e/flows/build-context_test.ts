// flow build-context: 실제 headless shell·core·documents worker를 임시 LOPHN_HOME으로 연다.
// 1은 아래 테스트가 contexts 화면과 Context Engineer 대화로 본다. 2는 그 다음 테스트가
// 목차·검색·section·본문 범위와 blueprint 읽기 command 조회를 본다. 3은 그 다음 테스트가
// 기준·참고·watch 제안과 사람 화면의 항목·읽기 가능 여부를 본다. 4는 마지막 테스트가
// 정할 수 없는 경계만 묻고, 사람이 정한 목적·범위만 구성과 보고로 남기는지 본다.
// 이 테스트는 기존 사람 command로 준비한 context에서 5의 화면·고정 section 읽기, 6~7의 실제 파일 관측·
// watch·notification·전후 판 읽기, section 소실과 항목 제거·보관 갈래를 확인한다.
// 마지막 테스트는 5의 agent 입력·권한 검사다. 초기 입력은 관점별 목차이고 본문은 요청한 section만이다.
// 미확인·단절·범위 갈래는 T27의 남은 E2E다.
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

// 3: conversation에서 Context Engineer가 책임 근거는 기준, 배경 자료는 참고,
// 변화만 따라갈 자료는 watch로 제안한다. 같은 문서 section도 context마다 관점과 이유가 다르다.
// 사람은 목적·지금 필요한 항목·읽을 수 있는지를 먼저 보고, 선택 이유·읽은 고정 근거·부족한 자료는
// 펼쳐 본다. 설계 보고는 요청 범위 문서에 목적·범위·용어·경계로 남고, 읽은 고정 판과 부족한 자료,
// 저장의 접수·판 확정·파일 반영을 섞지 않는다. model은 fake provider script다.
const TITLE_A = "Reading terms";
const TITLE_B = "Background terms";
const PURPOSE_A = "자료에서 쓰는 말의 책임 근거와 변화를 나눈다.";
const PURPOSE_B = "같은 용어 자료를 배경으로만 본다.";
const BASIS_REASON = "목적에 대한 책임 근거";
const GAP_REASON = "아직 읽을 수 없는 배경";
const WATCH_REASON = "변화만 따라갈 자료";
const REF_REASON = "다른 목적에서는 배경 자료";
const MISSING_SECTION = "없는-절";
const UNDECIDED_TERM = "색인";
const REPORT_TITLE = "컨텍스트 설계 보고";
const REPORT_TERM_LIMIT = 30;
const PROPOSE =
  "함께 볼 자료의 관점을 정해 달라. 책임 근거, 배경, 변화만 따라갈 자료를 나누고 설계 보고를 남겨 달라.";
const PROPOSAL =
  "책임 근거는 기준, 배경 자료는 참고, 변화만 따라갈 자료는 watch로 둔다. 용어 section은 읽은 고정 판의 근거다. 없는 section과 읽지 않은 판은 부족한 자료이고 확인된 근거가 아니다. 보고 저장은 접수와 판 확정이고 파일 반영은 아니다.";
const GAP_NOTICE =
  "This section isn't in the latest version. Pick the part to use again.";

type ProposalPhase =
  | "search"
  | "list"
  | "outline"
  | "section"
  | "docs"
  | "create-a"
  | "create-b"
  | "save"
  | "done";

type ListedDoc = { id: string; title: string; version: string };

type ScopeLine = {
  target: {
    kind: "document";
    document: string;
    section: string | null;
  };
  perspective: "basis" | "reference" | "watch";
  reason: string;
};

type DesignReport = {
  context: string;
  purpose: string;
  scope: ScopeLine[];
  terms: { confirmed: string[]; undecided: string[] };
  boundaries: string[];
};

type ProposalFixture = LookupFixture & {
  migration: () => string;
  migrationVersion: () => string;
  section: () => string;
  contextA: () => string;
  contextB: () => string;
  /** document.create 결과가 들어 있는 요청 번호. */
  saved: () => number;
};

function listedDocs(content: Record<string, unknown>): ListedDoc[] {
  const rows = content["documents"];
  assert(Array.isArray(rows), JSON.stringify(content).slice(0, 800));
  const out: ListedDoc[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const nested = record["document"];
    const doc = nested !== null && typeof nested === "object"
      ? nested as Record<string, unknown>
      : record;
    const id = doc["id"] ?? doc["document"];
    const title = doc["title"];
    const latest = record["latest_version"] ?? doc["latest_version"];
    const version = typeof latest === "string"
      ? latest
      : latest !== null && typeof latest === "object"
      ? (latest as { id?: string }).id
      : undefined;
    if (
      typeof id === "string" && typeof title === "string" &&
      typeof version === "string"
    ) {
      out.push({ id, title, version });
    }
  }
  return out;
}

function createdContext(
  content: Record<string, unknown>,
): { id: string } {
  const context = content["context"];
  const id = context !== null && typeof context === "object"
    ? (context as { id?: unknown }).id
    : undefined;
  assert(typeof id === "string", JSON.stringify(content).slice(0, 500));
  return { id };
}

function docTarget(
  document: string,
  section: string | null,
): ScopeLine["target"] {
  return { kind: "document", document, section };
}

function designReport(
  context: string,
  purpose: string,
  scope: ScopeLine[],
  boundaries: string[],
): DesignReport {
  return {
    context,
    purpose,
    scope,
    terms: { confirmed: [], undecided: [UNDECIDED_TERM] },
    boundaries,
  };
}

/** 검색·목차로 용어 section만 읽고, 두 context에 관점을 다르게 넣은 뒤 설계 보고를 저장한다.
 * migration 본문은 읽지 않는다. 저장 근거에 그 판을 실어도 결과는 읽지 않음으로 남는다. */
function startProposalScript(): ProposalFixture {
  const bodies: string[] = [];
  const named: string[] = [];
  const queue: FixedDoc[] = [];
  const found = {
    document: "",
    version: "",
    section: "",
    migration: "",
    migrationVersion: "",
    contextA: "",
    contextB: "",
    failure: "",
    phase: "search" as ProposalPhase,
    searches: 0,
  };
  const at = { outline: -1, section: -1, range: -1, commands: -1, save: -1 };
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
          for (const row of listedDocs(toolContent(text))) {
            queue.push({ document: row.id, version: row.version });
          }
          assert(queue.length > 0, "문서 목록이 비었다");
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
            found.section = section;
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
          const content = toolContent(text);
          const readText = String(content["text"] ?? "");
          assert(
            readText.includes(SECTION_BODY),
            `읽은 section이 용어 본문이 아니다: ${readText.slice(0, 200)}`,
          );
          assertEquals(readText.includes(OTHER_BODY), false);
          const version = content["version"];
          assert(
            typeof version === "string",
            JSON.stringify(content).slice(0, 300),
          );
          found.version = version;
          found.phase = "docs";
          named.push("document.list");
          reply = toolCall("toolu_docs", "document.list", {});
        } else if (found.phase === "docs") {
          const docs = listedDocs(toolContent(text));
          const migration = docs.find((row) => row.title === "migration");
          assert(migration !== undefined, JSON.stringify(docs));
          assert(
            migration.id !== found.document,
            "migration이 용어 문서와 같다",
          );
          found.migration = migration.id;
          found.migrationVersion = migration.version;
          assert(found.section !== MISSING_SECTION, found.section);
          const basis = docTarget(found.document, found.section);
          const gap = docTarget(found.document, MISSING_SECTION);
          const watch = docTarget(found.migration, null);
          found.phase = "create-a";
          named.push("context.create");
          reply = toolCall("toolu_context_a", "context.create", {
            title: TITLE_A,
            purpose: PURPOSE_A,
            items: [
              { target: basis, perspective: "basis", reason: BASIS_REASON },
              { target: gap, perspective: "reference", reason: GAP_REASON },
              { target: watch, perspective: "watch", reason: WATCH_REASON },
            ],
          });
        } else if (found.phase === "create-a") {
          found.contextA = createdContext(toolContent(text)).id;
          const basis = docTarget(found.document, found.section);
          found.phase = "create-b";
          named.push("context.create");
          reply = toolCall("toolu_context_b", "context.create", {
            title: TITLE_B,
            purpose: PURPOSE_B,
            items: [
              {
                target: basis,
                perspective: "reference",
                reason: REF_REASON,
              },
            ],
          });
        } else if (found.phase === "create-b") {
          found.contextB = createdContext(toolContent(text)).id;
          assert(found.contextA !== found.contextB, "두 context id가 같다");
          const basis = docTarget(found.document, found.section);
          const gap = docTarget(found.document, MISSING_SECTION);
          const watch = docTarget(found.migration, null);
          const reports = [
            designReport(found.contextA, PURPOSE_A, [
              { target: basis, perspective: "basis", reason: BASIS_REASON },
              { target: gap, perspective: "reference", reason: GAP_REASON },
              { target: watch, perspective: "watch", reason: WATCH_REASON },
            ], ["앱 command 실행과 원본 이동은 맡지 않는다"]),
            designReport(found.contextB, PURPOSE_B, [
              { target: basis, perspective: "reference", reason: REF_REASON },
            ], ["이 목적에서는 책임 근거와 watch를 맡지 않는다"]),
          ];
          found.phase = "save";
          named.push("document.create");
          reply = toolCall("toolu_report", "document.create", {
            title: REPORT_TITLE,
            place: null,
            name: null,
            text: JSON.stringify({ reports }),
            media_type: "text/markdown",
            evidence: {
              relied_on: [
                { document: found.document, version: found.version },
                {
                  document: found.migration,
                  version: found.migrationVersion,
                },
              ],
              missing: [MISSING_SECTION],
            },
          });
        } else if (found.phase === "save") {
          at.save = index;
          const saved = toolContent(text);
          assertEquals(saved["accepted"], true);
          assertEquals(saved["version_confirmed"], true);
          assertEquals(saved["file_reflection"], "not_applicable");
          const evidence = saved["evidence"] as {
            all_read?: boolean;
            read?: { document?: string; version?: string }[];
            not_read?: { document?: string }[];
            missing?: string[];
          };
          assertEquals(evidence.all_read, false);
          assert(
            evidence.read?.some((row) =>
              row.document === found.document && row.version === found.version
            ),
            JSON.stringify(evidence),
          );
          assert(
            evidence.not_read?.some((row) => row.document === found.migration),
            JSON.stringify(evidence),
          );
          assertEquals(evidence.missing, [MISSING_SECTION]);
          found.phase = "done";
          reply = said(PROPOSAL);
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
    migration: () => found.migration,
    migrationVersion: () => found.migrationVersion,
    section: () => found.section,
    contextA: () => found.contextA,
    contextB: () => found.contextB,
    saved: () => at.save,
  };
}

async function openFocusId(flow: FlowShell, id: string): Promise<void> {
  await flow.click('[data-screen="contexts"]');
  await flow.until(
    `document.querySelector('[data-focus="${id}"]') !== null`,
    "Focus 목록이 없다",
  );
  await flow.click(`[data-focus="${id}"]`);
  await flow.until(
    `document.querySelector('[data-focus-head="${id}"]') !== null`,
    "Focus 상세가 없다",
  );
}

async function markRow(
  flow: FlowShell,
  perspective: string,
  includes: string,
): Promise<void> {
  const selector = `[data-perspective="${perspective}"] [data-item]`;
  const marked = await flow.evaluate(`(() => {
    for (const old of document.querySelectorAll("[data-flow-row]")) {
      old.removeAttribute("data-flow-row");
    }
    const row = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((el) =>
        (el.querySelector("button")?.textContent ?? "").includes(${
    JSON.stringify(includes)
  })
      );
    if (!row) return false;
    row.setAttribute("data-flow-row", "");
    return true;
  })()`);
  assertEquals(marked, true, `항목이 없다: ${perspective} ${includes}`);
}

type OutlineEntry = {
  perspective: string;
  reason: string;
  title: string;
  readable: boolean;
  version: string | null;
  section_status: string | null;
  target: { kind: string; document?: string; section?: string | null };
};

function outlineOf(page: Record<string, unknown>): {
  purpose: string;
  entries: OutlineEntry[];
  perspectives: Record<"basis" | "reference" | "watch", OutlineEntry[]>;
  glossary: { name?: string; definition?: string | null }[];
  candidates: { name?: string; definition?: string | null }[];
} {
  const perspectives = page["perspectives"] as Record<
    "basis" | "reference" | "watch",
    OutlineEntry[]
  >;
  return {
    purpose: String(page["purpose"] ?? ""),
    entries: page["entries"] as OutlineEntry[],
    perspectives,
    glossary: page["glossary"] as { name?: string }[],
    candidates: page["candidates"] as { name?: string }[],
  };
}

Deno.test({
  name:
    "lophn-agent/roles/context-engineer#R6 lophn-agent/roles/context-engineer#R7 lophn-agent/roles/common#R10 documents/contexts#R1 documents/outline-and-search#R4 flow build-context 3: 기준·참고·watch를 제안하고 사람은 항목과 읽기 가능 여부를 먼저 본다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const provider = startProposalScript();
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
      await untilSearch(
        flow,
        "용어",
        (page) => page.results.length > 0,
        "목차 반영 대기",
      );
      const glossary = await documentTitled(flow, "glossary");
      const migration = await documentTitled(flow, "migration");

      await sendToEngineer(flow, PROPOSE);
      await untilLookup(provider);
      await untilEngineerDone(flow, provider, "관점 제안이 끝나지 않았다");

      const named = provider.callsNamed();
      const readAt = named.lastIndexOf("document.read_section");
      assert(readAt > 0, named.join(","));
      assertEquals(named[0], "document.search");
      assert(
        named.slice(0, readAt).every((name) =>
          name === "document.search" || name === "document.list" ||
          name === "document.outline"
        ),
        named.join(","),
      );
      assert(
        named.slice(0, readAt).includes("document.outline"),
        named.join(","),
      );
      assertEquals(named.slice(readAt), [
        "document.read_section",
        "document.list",
        "context.create",
        "context.create",
        "document.create",
      ]);
      assertEquals(provider.document(), glossary.id);
      assertEquals(provider.version(), glossary.latest_version);
      assertEquals(provider.migration(), migration.id);
      assertEquals(provider.migrationVersion(), migration.latest_version);
      const tools = offeredTools(provider.body(0));
      assert(tools.includes("context.create"), tools.join(","));
      assert(tools.includes("document.create"), tools.join(","));
      assertEquals(tools.includes("term.define"), false);

      const sectionRead = toolContent(
        provider.body(provider.result("section")),
      );
      assertEquals(sectionRead["version"], glossary.latest_version);
      assertStringIncludes(String(sectionRead["text"]), SECTION_BODY);
      assertEquals(String(sectionRead["text"]).includes(OTHER_BODY), false);
      const saved = toolContent(provider.body(provider.saved()));
      assertEquals(saved["accepted"], true);
      assertEquals(saved["version_confirmed"], true);
      assertEquals(saved["file_reflection"], "not_applicable");
      const evidence = saved["evidence"] as {
        all_read: boolean;
        read: { document: string; version: string }[];
        not_read: { document: string }[];
        missing: string[];
      };
      assertEquals(evidence.all_read, false);
      assertEquals(
        evidence.read.map((row) => ({
          document: row.document,
          version: row.version,
        })),
        [{
          document: glossary.id,
          version: glossary.latest_version,
        }],
      );
      assertEquals(
        evidence.not_read.map((row) => row.document),
        [migration.id],
      );
      assertEquals(evidence.missing, [MISSING_SECTION]);

      const shown = (await flow.text(EMBEDDED)) ?? "";
      assertStringIncludes(shown, PROPOSAL);
      assertStringIncludes(shown, "기준");
      assertStringIncludes(shown, "참고");
      assertStringIncludes(shown, "watch");
      assertEquals(shown.includes(OTHER_BODY), false);
      assertEquals(shown.includes("데이터베이스마이그레이션계획서"), false);
      assertEquals(shown.includes("document.search"), false);
      assertEquals(shown.includes("document.create"), false);
      assertEquals(shown.includes("context.create"), false);
      assertEquals(shown.includes(folder), false);

      const contextA = provider.contextA();
      const contextB = provider.contextB();
      const section = provider.section();
      const storedA = await mustCall(flow, {
        kind: "read",
        resource: "contexts",
        method: "get",
        body: { context: contextA },
      });
      const storedB = await mustCall(flow, {
        kind: "read",
        resource: "contexts",
        method: "get",
        body: { context: contextB },
      });
      const itemsA = (storedA.context as {
        purpose: string;
        items: {
          perspective: string;
          reason: string;
          target: { document: string; section: string | null };
        }[];
      }).items;
      const itemsB = (storedB.context as {
        purpose: string;
        items: {
          perspective: string;
          reason: string;
          target: { document: string; section: string | null };
        }[];
      }).items;
      assertEquals(
        (storedA.context as { purpose: string }).purpose,
        PURPOSE_A,
      );
      assertEquals(
        (storedB.context as { purpose: string }).purpose,
        PURPOSE_B,
      );
      const basisItem = itemsA.find((item) => item.target.section === section);
      const otherItem = itemsB.find((item) => item.target.section === section);
      assert(basisItem !== undefined && otherItem !== undefined);
      assertEquals(basisItem.target.document, glossary.id);
      assertEquals(otherItem.target.document, glossary.id);
      assertEquals(basisItem.perspective, "basis");
      assertEquals(otherItem.perspective, "reference");
      assertEquals(basisItem.reason, BASIS_REASON);
      assertEquals(otherItem.reason, REF_REASON);
      assert(basisItem.reason !== otherItem.reason);

      const pageA = outlineOf(
        await mustCall(flow, {
          kind: "worker",
          resource: "outline",
          method: "context",
          body: { context: contextA },
        }),
      );
      const pageB = outlineOf(
        await mustCall(flow, {
          kind: "worker",
          resource: "outline",
          method: "context",
          body: { context: contextB },
        }),
      );
      assertEquals(pageA.purpose, PURPOSE_A);
      assertEquals(
        pageA.entries.map((entry) => entry.perspective),
        ["basis", "reference", "watch"],
      );
      assertEquals(pageA.perspectives.basis.length, 1);
      assertEquals(pageA.perspectives.reference.length, 1);
      assertEquals(pageA.perspectives.watch.length, 1);
      const basisEntry = pageA.perspectives.basis[0];
      const gapEntry = pageA.perspectives.reference[0];
      const watchEntry = pageA.perspectives.watch[0];
      assertEquals(basisEntry.readable, true);
      assertEquals(basisEntry.version, glossary.latest_version);
      assertEquals(basisEntry.section_status, "found");
      assertEquals(basisEntry.target.section, section);
      assertEquals(basisEntry.reason, BASIS_REASON);
      assertEquals(gapEntry.readable, false);
      assertEquals(gapEntry.section_status, "missing");
      assertEquals(gapEntry.target.section, MISSING_SECTION);
      assertEquals(gapEntry.reason, GAP_REASON);
      assertEquals(watchEntry.readable, true);
      assertEquals(watchEntry.version, migration.latest_version);
      assertEquals(watchEntry.section_status, "whole");
      assertEquals(watchEntry.target.document, migration.id);
      assertEquals(watchEntry.target.section, null);
      assertEquals(watchEntry.reason, WATCH_REASON);
      assertEquals(pageB.perspectives.basis, []);
      assertEquals(pageB.perspectives.watch, []);
      assertEquals(pageB.perspectives.reference.length, 1);
      assertEquals(
        pageB.perspectives.reference[0].target.document,
        glossary.id,
      );
      assertEquals(pageB.perspectives.reference[0].target.section, section);
      assertEquals(pageB.perspectives.reference[0].perspective, "reference");
      assertEquals(pageB.perspectives.reference[0].reason, REF_REASON);
      assertEquals(
        pageB.perspectives.reference[0].version,
        glossary.latest_version,
      );
      assertEquals(pageA.glossary, []);
      assertEquals(pageA.candidates, []);
      assertEquals(pageB.glossary, []);
      assertEquals(pageB.candidates, []);
      for (const name of pageA.candidates.map((term) => term.name)) {
        assertEquals(
          pageA.glossary.some((term) => term.name === name),
          false,
          name,
        );
      }

      const reportDoc = await documentTitled(flow, REPORT_TITLE);
      assertEquals(reportDoc.name, null);
      const reportRead = await mustCall(flow, {
        kind: "worker",
        resource: "documents",
        method: "read",
        body: {
          reference: {
            document: reportDoc.id,
            version: reportDoc.latest_version,
            section: null,
          },
        },
      });
      assertEquals(reportRead["version"], saved["version"]);
      const reports = (JSON.parse(String(reportRead["text"])) as {
        reports: DesignReport[];
      }).reports;
      assertEquals(reports.length, 2);
      for (const report of reports) {
        assert(report.purpose.trim().length > 0);
        assert(report.scope.length > 0);
        assert(report.boundaries.length > 0);
        assert(report.terms.confirmed.length <= REPORT_TERM_LIMIT);
        for (const name of report.terms.undecided) {
          assertEquals(report.terms.confirmed.includes(name), false, name);
        }
        for (const line of report.scope) {
          assertEquals(line.reason.includes("\n"), false);
          assert(line.reason.trim().length > 0);
          assertEquals(line.target.kind, "document");
        }
      }
      assertEquals(reports[0].context, contextA);
      assertEquals(reports[0].purpose, PURPOSE_A);
      assertEquals(
        reports[0].scope.map((line) => line.perspective),
        ["basis", "reference", "watch"],
      );
      assertEquals(reports[0].terms.confirmed, []);
      assertEquals(reports[0].terms.undecided, [UNDECIDED_TERM]);
      assertEquals(reports[1].context, contextB);
      assertEquals(reports[1].scope[0].perspective, "reference");
      assertEquals(reports[1].scope[0].target.section, section);
      assertEquals(reports[1].scope[0].reason, REF_REASON);

      await openFocusId(flow, contextA);
      assertEquals(await flow.text("[data-focus-purpose]"), PURPOSE_A);
      assertEquals(
        JSON.parse(String(
          await flow.evaluate(
            `JSON.stringify([...document.querySelectorAll("[data-perspective]")].map((el) => el.getAttribute("data-perspective")))`,
          ),
        )),
        ["basis", "reference", "watch"],
      );
      assertEquals(
        JSON.parse(String(
          await flow.evaluate(
            `JSON.stringify([...document.querySelectorAll("[data-perspective] h2")].map((el) => el.textContent))`,
          ),
        )),
        ["Baseline1", "Reference1", "Follow changes1"],
      );
      const materials = (await flow.text("[data-materials]")) ?? "";
      assertStringIncludes(materials, "glossary");
      assertStringIncludes(materials, "migration");
      assertStringIncludes(materials, "What's missing");
      assertEquals(materials.includes(BASIS_REASON), false);
      assertEquals(materials.includes(GAP_REASON), false);
      assertEquals(materials.includes(WATCH_REASON), false);
      assertEquals(materials.includes(GAP_NOTICE), false);
      assertEquals(materials.includes("Nothing here yet."), false);
      assertEquals(await flow.count("[data-item-reason]"), 0);
      assertEquals(await flow.count("[data-item-gaps]"), 0);
      assertEquals(await flow.count("[data-item-body]"), 0);

      await markRow(flow, "reference", MISSING_SECTION);
      assertEquals(
        await flow.text("[data-flow-row] [data-item-state]"),
        "What's missing",
      );
      assertEquals(
        await flow.evaluate(
          `document.querySelector("[data-flow-row] [data-item-state]")?.getAttribute("data-item-state")`,
        ),
        "gaps",
      );
      await flow.click("[data-flow-row] > button");
      assertEquals(
        await flow.text("[data-flow-row] [data-gap]"),
        GAP_NOTICE,
      );
      assertEquals(
        await flow.evaluate(
          `document.querySelector("[data-flow-row] [data-gap]")?.getAttribute("data-gap")`,
        ),
        "section-missing",
      );
      assertEquals(await flow.count("[data-flow-row] [data-open-item]"), 0);

      await markRow(flow, "watch", "migration");
      assertEquals(
        await flow.evaluate(
          `document.querySelector("[data-flow-row] [data-item-state]")?.getAttribute("data-item-state")`,
        ),
        "quiet",
      );
      await flow.click("[data-flow-row] > button");
      assertEquals(
        await flow.text("[data-flow-row] [data-item-reason]"),
        WATCH_REASON,
      );

      await markRow(flow, "basis", section);
      assertEquals(await flow.count("[data-flow-row] [data-item-state]"), 0);
      await flow.click("[data-flow-row] > button");
      assertEquals(
        await flow.text("[data-flow-row] [data-item-reason]"),
        BASIS_REASON,
      );
      assertEquals(await flow.count("[data-flow-row] [data-open-item]"), 1);

      await openFocusId(flow, contextB);
      assertEquals(await flow.text("[data-focus-purpose]"), PURPOSE_B);
      assertEquals(
        await flow.text('[data-perspective="basis"] p'),
        "Nothing here yet.",
      );
      assertEquals(
        await flow.text('[data-perspective="watch"] p'),
        "Nothing here yet.",
      );
      const referenceText =
        (await flow.text('[data-perspective="reference"]')) ?? "";
      assertStringIncludes(referenceText, "glossary");
      assertStringIncludes(referenceText, section);
      assertEquals(referenceText.includes(BASIS_REASON), false);
      assertEquals(referenceText.includes("What's missing"), false);
      await markRow(flow, "reference", section);
      await flow.click("[data-flow-row] > button");
      assertEquals(
        await flow.text("[data-flow-row] [data-item-reason]"),
        REF_REASON,
      );

      await openFocusId(flow, contextA);
      await markRow(flow, "basis", section);
      await flow.click("[data-flow-row] > button");
      await flow.click("[data-flow-row] [data-open-item]");
      const reader = `[data-reader="${glossary.id}"] [data-body]`;
      await flow.until(
        `document.querySelector(${
          JSON.stringify(reader)
        })?.textContent.includes(${JSON.stringify(SECTION_BODY)})`,
        "읽은 고정 section이 없다",
      );
      const body = (await flow.text(reader)) ?? "";
      assertStringIncludes(body, SECTION_BODY);
      assertEquals(body.includes(OTHER_BODY), false);
      assertEquals(body.includes("데이터베이스마이그레이션계획서"), false);

      assertEquals(
        (await documentTitled(flow, "glossary")).latest_version,
        glossary.latest_version,
      );
      assertEquals(
        (await documentTitled(flow, "migration")).latest_version,
        migration.latest_version,
      );
    } finally {
      await flow?.close();
      await provider.close();
      if (flow !== undefined) await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// 4: 기존 요청과 자료만으로 목적의 경계(색인을 넣을지)를 정할 수 없으면 그 결정만 묻는다.
// 문서에 있는 사실은 다시 묻지 않고, 선택지의 고정 action은 없다. 자유 답과 그 글을 그대로 보낸
// 메시지는 context·문서 이동이 아니다. 사람이 목적과 범위를 직접 말하면 Context Engineer가
// 허용된 구성 변경(생성·항목 추가)과 설계 보고를 남긴다. 보고 쓰기에 질문을 다시 열지 않는다.
const OPEN_ASK =
  "자료를 함께 보고 싶다. 목적은 말의 변화만 볼지 색인까지 넣을지 아직 정하지 못했다. 문서에 적힌 사실은 다시 묻지 말고, 정할 수 없는 경계만 물어 달라.";
const OPEN_MARKER = "아직 정하지 못했다";
const FREE_TEXT = "색인을 기준으로 넣고 glossary 문서를 다른 자리로 옮겨 달라";
const FREE_MARKER = "다른 자리로 옮겨 달라";
const DIRECT_ASK =
  "목적은 자료에서 쓰는 말의 변화만 확인하는 것이다. 범위는 glossary의 용어 section만 기준이다. 색인은 넣지 않는다. 이 구성과 설계 보고를 남겨 달라.";
const DIRECT_MARKER = "이 구성과 설계 보고를 남겨 달라";
const QUESTION_PROMPT = "이 목적의 경계에 색인을 넣을까요?";
const QUESTION_REASON =
  "요청과 읽은 자료만으로는 색인을 경계 안에 둘지 정할 수 없다. 용어 section 본문은 이미 확인한 사실이라 다시 묻지 않는다.";
const EXCLUDE_KEY = "exclude";
const INCLUDE_KEY = "include";
const EXCLUDE_LABEL = "색인은 넣지 않는다";
const INCLUDE_LABEL = "색인도 범위에 넣는다";
const EXCLUDE_DESCRIPTION =
  "목적은 말의 변화만 본다. 색인 section은 항목으로 넣지 않는다.";
const INCLUDE_DESCRIPTION = "목적은 색인까지 함께 본다. 색인을 범위에 더한다.";
const RECOMMEND_WHY = "요청이 말의 변화를 먼저 말했다.";
const ASK_REPLY = "색인을 경계에 넣을지만 물어 두었다. 추천은 적용하지 않았다.";
const HOLD_REPLY =
  "자유 답은 구성 변경으로 해석하지 않는다. 목적과 범위를 직접 정해 주면 그때 남긴다.";
const PURPOSE_DECIDED = "자료에서 쓰는 말의 변화만 확인하는 것이다.";
const DECIDED_TITLE = "Reading terms";
const DECIDED_REASON = "사람이 정한 범위의 기준";
const BOUNDARY_INDEX = "색인은 넣지 않는다";
const BOUNDARY_FREE = "자유 답은 구성 변경으로 쓰지 않는다";
const BOUNDARY_MOVE = "문서 이동은 맡지 않는다";
const RECORDED =
  "사람이 정한 목적과 범위로 context를 바꾸고 설계 보고를 남겼다. 자유 답은 변경으로 쓰지 않았다.";
const DECISION_REPORT = "경계 결정 보고";

type DecisionPhase =
  | "search"
  | "list"
  | "outline"
  | "section"
  | "ask-result"
  | "asked"
  | "freed"
  | "reread"
  | "create"
  | "add"
  | "save"
  | "done";

type DecisionFixture = Fixture & {
  failure: () => string;
  phase: () => DecisionPhase;
  callsNamed: () => readonly string[];
  context: () => string;
  section: () => string;
  saved: () => number;
};

function latestIntent(body: string): "open" | "free" | "decide" | "none" {
  const marks = [
    ["decide", body.lastIndexOf(DIRECT_MARKER)],
    ["free", body.lastIndexOf(FREE_MARKER)],
    ["open", body.lastIndexOf(OPEN_MARKER)],
  ] as const;
  let best: "open" | "free" | "decide" | "none" = "none";
  let at = -1;
  for (const [name, index] of marks) {
    if (index > at) {
      at = index;
      best = name;
    }
  }
  return best;
}

function createdRevision(content: Record<string, unknown>): string {
  const context = content["context"];
  const revision = context !== null && typeof context === "object"
    ? (context as { revision?: unknown }).revision
    : undefined;
  assert(typeof revision === "string", JSON.stringify(content).slice(0, 500));
  return revision;
}

/** 자료를 읽어 경계 하나만 묻고, 자유 답에는 쓰지 않으며, 직접 말한 목적·범위만 남긴다. */
function startDecisionScript(): DecisionFixture {
  const bodies: string[] = [];
  const named: string[] = [];
  const queue: FixedDoc[] = [];
  const found = {
    document: "",
    version: "",
    section: "",
    context: "",
    revision: "",
    failure: "",
    phase: "search" as DecisionPhase,
    searches: 0,
  };
  const at = { save: -1 };
  const search = (): SemanticReply => {
    found.searches += 1;
    named.push("document.search");
    return toolCall(
      `toolu_decide_search_${found.searches}`,
      "document.search",
      {
        query: "용어",
      },
    );
  };
  const outlineNext = (): SemanticReply => {
    const next = queue.shift();
    assert(next !== undefined, "용어 section이 있는 문서가 없다");
    found.document = next.document;
    found.version = next.version;
    found.phase = "outline";
    named.push("document.outline");
    return toolCall(
      `toolu_decide_outline_${named.length}`,
      "document.outline",
      {
        reference: {
          document: next.document,
          version: next.version,
          section: null,
        },
      },
    );
  };
  const readSection = (): SemanticReply => {
    named.push("document.read_section");
    return toolCall("toolu_decide_section", "document.read_section", {
      reference: {
        document: found.document,
        version: found.version,
        section: null,
      },
      section: found.section,
    });
  };
  const ask = (): SemanticReply => {
    const evidence = [{
      document: found.document,
      version: found.version,
      section: found.section,
    }];
    named.push("question.submit");
    found.phase = "ask-result";
    return toolCall("toolu_decide_ask", "question.submit", {
      prompt: QUESTION_PROMPT,
      reason: QUESTION_REASON,
      options: [
        {
          key: EXCLUDE_KEY,
          label: EXCLUDE_LABEL,
          description: EXCLUDE_DESCRIPTION,
          evidence,
          adoption: null,
          action: null,
        },
        {
          key: INCLUDE_KEY,
          label: INCLUDE_LABEL,
          description: INCLUDE_DESCRIPTION,
          evidence,
          adoption: null,
          action: null,
        },
      ],
      recommendation: {
        option_key: EXCLUDE_KEY,
        explanation: RECOMMEND_WHY,
      },
      expires_at: null,
    });
  };
  const hold = (): SemanticReply => {
    found.phase = "freed";
    return said(HOLD_REPLY);
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
            reply = toolCall("toolu_decide_list", "document.list", {});
          }
        } else if (found.phase === "list") {
          for (const row of listedDocs(toolContent(text))) {
            queue.push({ document: row.id, version: row.version });
          }
          assert(queue.length > 0, "문서 목록이 비었다");
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
            found.section = section;
            found.phase = "section";
            reply = readSection();
          }
        } else if (found.phase === "section") {
          const content = toolContent(text);
          const readText = String(content["text"] ?? "");
          assert(
            readText.includes(SECTION_BODY),
            `읽은 section이 용어 본문이 아니다: ${readText.slice(0, 200)}`,
          );
          assertEquals(readText.includes(OTHER_BODY), false);
          const version = content["version"];
          assert(
            typeof version === "string",
            JSON.stringify(content).slice(0, 300),
          );
          found.version = version;
          reply = ask();
        } else if (found.phase === "ask-result") {
          toolContent(text);
          found.phase = "asked";
          reply = said(ASK_REPLY);
        } else if (found.phase === "asked" || found.phase === "freed") {
          const intent = latestIntent(text);
          if (intent === "free") {
            reply = hold();
          } else if (intent === "decide") {
            found.phase = "reread";
            reply = readSection();
          } else {
            throw new Error(`예상 밖 요청이다: ${intent}`);
          }
        } else if (found.phase === "reread") {
          const content = toolContent(text);
          assert(
            String(content["text"] ?? "").includes(SECTION_BODY),
            "다시 읽은 section이 용어 본문이 아니다",
          );
          const version = content["version"];
          assert(
            typeof version === "string",
            JSON.stringify(content).slice(0, 300),
          );
          found.version = version;
          found.phase = "create";
          named.push("context.create");
          reply = toolCall("toolu_decide_create", "context.create", {
            title: DECIDED_TITLE,
            purpose: PURPOSE_DECIDED,
          });
        } else if (found.phase === "create") {
          const content = toolContent(text);
          found.context = createdContext(content).id;
          found.revision = createdRevision(content);
          found.phase = "add";
          named.push("context.add_item");
          reply = toolCall("toolu_decide_add", "context.add_item", {
            context: found.context,
            base_revision: found.revision,
            item: {
              target: docTarget(found.document, found.section),
              perspective: "basis",
              reason: DECIDED_REASON,
            },
          });
        } else if (found.phase === "add") {
          const added = toolContent(text);
          assertEquals(added["accepted"], true);
          assertEquals(added["confirmed"], true);
          found.phase = "save";
          named.push("document.create");
          reply = toolCall("toolu_decide_report", "document.create", {
            title: DECISION_REPORT,
            place: null,
            name: null,
            text: JSON.stringify({
              reports: [
                designReport(found.context, PURPOSE_DECIDED, [{
                  target: docTarget(found.document, found.section),
                  perspective: "basis",
                  reason: DECIDED_REASON,
                }], [BOUNDARY_INDEX, BOUNDARY_FREE, BOUNDARY_MOVE]),
              ],
            }),
            media_type: "text/markdown",
            evidence: {
              relied_on: [{
                document: found.document,
                version: found.version,
              }],
              missing: [],
            },
          });
        } else if (found.phase === "save") {
          at.save = index;
          const saved = toolContent(text);
          assertEquals(saved["accepted"], true);
          assertEquals(saved["version_confirmed"], true);
          assertEquals(saved["file_reflection"], "not_applicable");
          const evidence = saved["evidence"] as { all_read?: boolean };
          assertEquals(evidence.all_read, true);
          found.phase = "done";
          reply = said(RECORDED);
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
    phase: () => found.phase,
    callsNamed: () => named,
    context: () => found.context,
    section: () => found.section,
    saved: () => at.save,
  };
}

async function untilDecision(
  provider: DecisionFixture,
  phase: DecisionPhase,
  what: string,
) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    assert(provider.failure() === "", provider.failure());
    if (provider.phase() === phase) return;
    assert(
      Date.now() < deadline,
      `${what}: phase ${provider.phase()} call ${provider.calls()} ${
        provider.body(provider.calls() - 1).slice(-500)
      }`,
    );
    await delay(250);
  }
}

type AskedQuestion = {
  id: string;
  status: string;
  answer: { kind?: string } | null;
  applied: boolean;
  options: {
    key: string;
    action: unknown;
    evidence: { document: string; version: string; section: string | null }[];
  }[];
  recommendation: { option_key: string | null } | null;
};

function questionsOf(flow: FlowShell): Promise<AskedQuestion[]> {
  return mustCall(flow, {
    kind: "read",
    resource: "questions",
    method: "list",
    body: {},
  }).then((listed) => listed.questions as AskedQuestion[]);
}

function contextCount(flow: FlowShell): Promise<number> {
  return mustCall(flow, {
    kind: "read",
    resource: "contexts",
    method: "list",
    body: {},
  }).then((listed) => (listed.contexts as unknown[]).length);
}

function documentPlace(flow: FlowShell, document: string): Promise<unknown> {
  return mustCall(flow, {
    kind: "read",
    resource: "documents",
    method: "get",
    body: { document },
  }).then((read) => (read.document as { place: unknown }).place);
}

Deno.test({
  name:
    "lophn-agent/roles/context-engineer#R5 lophn-agent/roles/context-engineer#R10 documents/contexts#R5 lophn-agent/questions#R1 lophn-agent/questions#R15 flow build-context 4: 정할 수 없는 경계만 묻고 사람이 정한 목적·범위만 남기며 자유 답은 변경으로 쓰지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const provider = startDecisionScript();
    let flow: FlowShell | undefined;
    try {
      flow = await openFlowShell({ start: "lophn" });
      const shell = flow;
      await mustCall(shell, {
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
      const defaults = await mustCall(shell, {
        kind: "read",
        resource: "agent-model-defaults",
        method: "read",
        body: {},
      });
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
      await mustCall(shell, {
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
      await registerTrackedProject(shell, { folder });
      await untilDocuments(shell, ["glossary", "migration"], "문서 관측 대기");
      await untilSearch(
        shell,
        "용어",
        (page) => page.results.length > 0,
        "목차 반영 대기",
      );
      const glossary = await documentTitled(shell, "glossary");
      const migration = await documentTitled(shell, "migration");
      const placeBefore = await documentPlace(shell, glossary.id);
      assertEquals(await contextCount(shell), 0);

      await t.step(
        "lophn-agent/questions#R1 lophn-agent/roles/context-engineer#R10: 자료로 정할 수 없는 경계만 근거와 함께 묻고 추천은 적용하지 않는다",
        async () => {
          await sendToEngineer(shell, OPEN_ASK);
          // 질문을 낸 run은 답을 기다린다. model은 답으로 이어진 뒤에 다시 불린다.
          await untilDecision(provider, "ask-result", "경계 질문");
          const askBy = Date.now() + 60_000;
          while ((await questionsOf(shell)).length === 0) {
            assert(Date.now() < askBy, "경계 질문이 만들어지지 않았다");
            await delay(250);
          }
          const named = provider.callsNamed();
          const askedAt = named.indexOf("question.submit");
          assert(askedAt > 0, named.join(","));
          assertEquals(named[0], "document.search");
          assert(
            named.slice(0, askedAt).every((name) =>
              name === "document.search" || name === "document.list" ||
              name === "document.outline" || name === "document.read_section"
            ),
            named.join(","),
          );
          assert(named.includes("document.outline"), named.join(","));
          assert(named.includes("document.read_section"), named.join(","));
          assertEquals(
            named.filter((name) => name === "question.submit").length,
            1,
          );
          assertEquals(named.includes("context.create"), false);
          assertEquals(named.includes("document.create"), false);
          const tools = offeredTools(provider.body(0));
          assert(tools.includes("question.submit"), tools.join(","));
          assert(tools.includes("context.create"), tools.join(","));
          assert(tools.includes("context.add_item"), tools.join(","));
          assert(tools.includes("document.create"), tools.join(","));
          assertEquals(tools.includes("term.define"), false);
          const shown = (await shell.text(EMBEDDED)) ?? "";
          assertEquals(shown.includes(SECTION_BODY), false);
          assertEquals(shown.includes("document.search"), false);
          await shell.until(
            `document.querySelector(${
              JSON.stringify(`${EMBEDDED} [data-question-text='ready']`)
            })?.textContent === ${JSON.stringify(QUESTION_PROMPT)}`,
            "경계 질문이 칸에 서지 않았다",
            120_000,
          );
          assertEquals(
            await shell.text(`${EMBEDDED} [data-question-reason]`),
            QUESTION_REASON,
          );
          assertEquals(
            await shell.text(
              `${EMBEDDED} [data-option='${EXCLUDE_KEY}'] [data-option-description]`,
            ),
            EXCLUDE_DESCRIPTION,
          );
          assertEquals(
            await shell.text(
              `${EMBEDDED} [data-option='${INCLUDE_KEY}'] [data-option-description]`,
            ),
            INCLUDE_DESCRIPTION,
          );
          assertEquals(await shell.count(`${EMBEDDED} [data-recommended]`), 1);
          assertStringIncludes(
            (await shell.text(`${EMBEDDED} [data-recommendation]`)) ?? "",
            RECOMMEND_WHY,
          );
          const questions = await questionsOf(shell);
          assertEquals(questions.length, 1);
          const question = questions[0];
          assert(question !== undefined);
          assertEquals(question.status, "pending");
          assertEquals(question.answer, null);
          assertEquals(question.applied, false);
          assertEquals(
            question.options.map((option) => option.key),
            [EXCLUDE_KEY, INCLUDE_KEY],
          );
          for (const option of question.options) {
            assertEquals(option.action, null);
            assertEquals(option.evidence, [{
              document: glossary.id,
              version: glossary.latest_version,
              section: provider.section(),
            }]);
          }
          assertEquals(question.recommendation?.option_key, EXCLUDE_KEY);
          const text = await mustCall(shell, {
            kind: "read",
            resource: "questions",
            method: "text",
            body: { question: question.id },
          });
          assertEquals(text["prompt"], QUESTION_PROMPT);
          assertEquals(text["reason"], QUESTION_REASON);
          assertEquals(String(text["prompt"]).includes(SECTION_BODY), false);
          assertEquals(text["answer_text"], null);
          assertEquals(text["recommendation"], {
            option_key: EXCLUDE_KEY,
            explanation: RECOMMEND_WHY,
          });
          assertEquals(await contextCount(shell), 0);
          assertEquals(await documentPlace(shell, glossary.id), placeBefore);
          assertEquals(
            (await documentTitled(shell, "glossary")).latest_version,
            glossary.latest_version,
          );
          assertEquals(
            (await documentTitled(shell, "migration")).latest_version,
            migration.latest_version,
          );
        },
      );

      await t.step(
        "lophn-agent/questions#R15 lophn-agent/roles/context-engineer#R10: 자유 답과 그 글의 메시지는 정확한 변경이 아니고 관련 구성은 보류다",
        async () => {
          const own = `${EMBEDDED} [data-own-answer]`;
          const sendAnswer = `${EMBEDDED} [data-send-answer]`;
          await shell.type(own, FREE_TEXT);
          await shell.until(
            `(() => { const button = document.querySelector(${
              JSON.stringify(sendAnswer)
            }); return button !== null && button.disabled === false; })()`,
            "자유 답을 보낼 수 없다",
          );
          await shell.click(sendAnswer);
          // 질문을 기다리는 run이 있으므로 자유 답은 해당 질문의 답으로 접수된다.
          const answerBy = Date.now() + 30_000;
          while ((await questionsOf(shell))[0]?.status !== "answered") {
            assert(Date.now() < answerBy, "자유 답이 접수되지 않았다");
            await delay(250);
          }
          await sendToEngineer(shell, FREE_TEXT);
          await untilDecision(provider, "freed", "자유 답 보류");
          await shell.until(
            `document.querySelector(${
              JSON.stringify(EMBEDDED)
            })?.innerText.includes(${JSON.stringify(HOLD_REPLY)})`,
            "자유 답을 거절하는 말이 없다",
            180_000,
          );
          const named = provider.callsNamed();
          assertEquals(named.includes("context.create"), false);
          assertEquals(named.includes("context.add_item"), false);
          assertEquals(named.includes("document.create"), false);
          assertEquals(
            named.filter((name) => name === "question.submit").length,
            1,
          );
          const questions = await questionsOf(shell);
          assertEquals(questions.length, 1);
          const question = questions[0];
          assert(question !== undefined);
          if (question.status === "answered") {
            assertEquals(question.answer?.kind, "text");
            assertEquals(question.applied, false);
          } else {
            assertEquals(question.status, "pending");
            assertEquals(question.answer, null);
          }
          assertEquals(await contextCount(shell), 0);
          assertEquals(await documentPlace(shell, glossary.id), placeBefore);
          assertEquals(
            (await documentTitled(shell, "glossary")).latest_version,
            glossary.latest_version,
          );
          assertEquals(
            (await documentTitled(shell, "migration")).latest_version,
            migration.latest_version,
          );
        },
      );

      await t.step(
        "lophn-agent/roles/context-engineer#R5 documents/contexts#R5 lophn-agent/questions#R15: 사람이 정한 목적·범위만 개별 구성 변경과 설계 보고로 남긴다",
        async () => {
          await sendToEngineer(shell, DIRECT_ASK);
          await untilDecision(provider, "done", "구성 기록");
          await shell.until(
            `document.querySelector(${
              JSON.stringify(EMBEDDED)
            })?.innerText.includes(${JSON.stringify(RECORDED)})`,
            "구성 기록이 대화에 없다",
            180_000,
          );
          const named = provider.callsNamed();
          assertEquals(
            named.filter((name) => name === "context.create").length,
            1,
          );
          assertEquals(
            named.filter((name) => name === "context.add_item").length,
            1,
          );
          assertEquals(
            named.filter((name) => name === "document.create").length,
            1,
          );
          assertEquals(
            named.filter((name) => name === "question.submit").length,
            1,
          );
          assertEquals(named.includes("term.define"), false);
          const saved = toolContent(provider.body(provider.saved()));
          assertEquals(saved["accepted"], true);
          assertEquals(saved["file_reflection"], "not_applicable");
          const evidence = saved["evidence"] as {
            all_read: boolean;
            read: { document: string; version: string }[];
          };
          assertEquals(evidence.all_read, true);
          assertEquals(evidence.read, [{
            document: glossary.id,
            version: glossary.latest_version,
          }]);
          const approvals = await mustCall(shell, {
            kind: "read",
            resource: "approvals",
            method: "list",
            body: {},
          });
          assertEquals(approvals["requests"], []);
          const questions = await questionsOf(shell);
          assertEquals(questions.length, 1);
          assertEquals(questions[0]?.applied, false);
          const context = provider.context();
          const section = provider.section();
          const stored = await mustCall(shell, {
            kind: "read",
            resource: "contexts",
            method: "get",
            body: { context },
          });
          const record = stored.context as {
            purpose: string;
            items: {
              perspective: string;
              reason: string;
              target: {
                kind: string;
                document: string;
                section: string | null;
              };
            }[];
          };
          assertEquals(record.purpose, PURPOSE_DECIDED);
          assertEquals(record.items.length, 1);
          assertEquals(record.items[0]?.perspective, "basis");
          assertEquals(record.items[0]?.reason, DECIDED_REASON);
          assertEquals(record.items[0]?.target, {
            kind: "document",
            document: glossary.id,
            section,
          });
          const reportDoc = await documentTitled(shell, DECISION_REPORT);
          assertEquals(reportDoc.name, null);
          const reportRead = await mustCall(shell, {
            kind: "worker",
            resource: "documents",
            method: "read",
            body: {
              reference: {
                document: reportDoc.id,
                version: reportDoc.latest_version,
                section: null,
              },
            },
          });
          const reports = (JSON.parse(String(reportRead["text"])) as {
            reports: DesignReport[];
          }).reports;
          assertEquals(reports.length, 1);
          const report = reports[0];
          assert(report !== undefined);
          assertEquals(report.context, context);
          assertEquals(report.purpose, PURPOSE_DECIDED);
          assertEquals(report.scope, [{
            target: {
              kind: "document",
              document: glossary.id,
              section,
            },
            perspective: "basis",
            reason: DECIDED_REASON,
          }]);
          assertEquals(report.terms.confirmed, []);
          assertEquals(report.terms.undecided, [UNDECIDED_TERM]);
          assertEquals(report.terms.confirmed.includes(UNDECIDED_TERM), false);
          assertEquals(report.boundaries, [
            BOUNDARY_INDEX,
            BOUNDARY_FREE,
            BOUNDARY_MOVE,
          ]);
          await openFocusId(shell, context);
          assertEquals(
            await shell.text("[data-focus-purpose]"),
            PURPOSE_DECIDED,
          );
          assertEquals(
            await shell.count('[data-perspective="basis"] [data-item]'),
            1,
          );
          assertEquals(
            await shell.count('[data-perspective="reference"] [data-item]'),
            0,
          );
          assertEquals(
            await shell.count('[data-perspective="watch"] [data-item]'),
            0,
          );
          await markRow(shell, "basis", section);
          await shell.click("[data-flow-row] > button");
          assertEquals(
            await shell.text("[data-flow-row] [data-item-reason]"),
            DECIDED_REASON,
          );
          assertEquals(await documentPlace(shell, glossary.id), placeBefore);
          assertEquals(
            (await documentTitled(shell, "glossary")).latest_version,
            glossary.latest_version,
          );
          assertEquals(
            (await documentTitled(shell, "migration")).latest_version,
            migration.latest_version,
          );
        },
      );
    } finally {
      await flow?.close();
      await provider.close();
      if (flow !== undefined) await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
