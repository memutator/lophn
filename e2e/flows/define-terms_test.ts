// flow define-terms: 실제 headless shell·core·documents worker를 임시 LOPHN_HOME으로 연다.
// 1의 context 선택과 3·6의 사람 직접 정의 화면, 미루기·전제 변경·같은 이름·보관 갈래를 본다.
// 그 테스트의 후보는 사람 command의 고정 본문 근거로 준비한다. 2는 다음 테스트가 본다.
// 3은 고정 action 없는 질문만 본다. 4는 마지막 테스트가 고정한 term.define 선택지를
// 확인 창 없이 사람의 결정으로 접수한다. 접수된 결정의 machine 적용까지 본다.
// 5의 변경 기록·목록 구별은 마지막 테스트가 본다. 5는 같은 term.define 명령을
// 사람 직접 정의 경로로 부른 결과를 본다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import {
  copyFixture,
  editExternally,
} from "../../fixtures/projects/scenarios.ts";
import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
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
  untilSectionStatus,
} from "../flow-support.ts";

const FOCUS = "ctx_01arz3ndektsv4rrffq69g5fav";
const OTHER = "ctx_01arz3ndektsv4rrffq69g5fb0";
const CANDIDATE = "trm_01arz3ndektsv4rrffq69g5fav";

async function meanings(flow: FlowShell, context = FOCUS): Promise<void> {
  await flow.click('[data-screen="documents"]');
  await flow.click('[data-screen="contexts"]');
  await flow.until(
    `document.querySelector('[data-focus="${context}"]') !== null`,
    "Focus 목록 대기",
  );
  await flow.click(`[data-focus="${context}"]`);
  await flow.until(
    `document.querySelector('[data-focus-head="${context}"]') !== null`,
    "Focus 상세 대기",
  );
  await flow.mouseClickText("[role=tab]", "Meanings");
  await flow.until(
    `document.querySelector("[data-meanings]") !== null`,
    "Meanings 대기",
  );
}

async function term(flow: FlowShell) {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "terms",
    method: "get",
    body: { term: CANDIDATE },
  });
  return got.term as {
    name: string;
    definition: string | null;
    revision: string;
    evidence: unknown[];
  };
}

Deno.test({
  name:
    "documents/terms#R2 documents/terms#R3 documents/terms#R4 flow define-terms: context 선택 → 후보·미루기 → 사람 뜻 → 전제 변경·다른 context·보관",
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
        "본문 반영 대기",
      );
      const glossary = await documentTitled(flow, "glossary");
      for (
        const [id, title, purpose] of [[
          FOCUS,
          "Reading terms",
          "읽을 때 쓰는 뜻",
        ], [OTHER, "Writing terms", "쓸 때 쓰는 뜻"]]
      ) {
        await mustCall(flow, {
          kind: "command",
          resource: "contexts",
          method: "create",
          body: commandBody({
            id,
            title,
            purpose,
            items: [{
              target: {
                kind: "document",
                document: glossary.id,
                section: null,
              },
              perspective: "basis",
              reason: "말의 본문 근거",
            }],
          }),
        });
      }
      const evidence = [{
        document: glossary.id,
        version: glossary.latest_version,
        section: null,
        start_line: 11,
        end_line: 11,
      }];
      await mustCall(flow, {
        kind: "command",
        resource: "terms",
        method: "propose",
        body: commandBody({
          id: CANDIDATE,
          context: FOCUS,
          name: "용어",
          evidence,
        }),
      });
      await mustCall(flow, {
        kind: "command",
        resource: "terms",
        method: "define",
        body: commandBody({
          id: "trm_01arz3ndektsv4rrffq69g5fb0",
          context: OTHER,
          name: "용어",
          definition: "글을 쓸 때 정한 별도 뜻",
        }),
      });

      await t.step(
        "documents/terms#R1 documents/terms#R3 documents/terms#R4: 1·3 선택한 목적에서 후보와 정의를 구별하고 다른 context의 뜻을 가져오지 않는다",
        async () => {
          await meanings(flow);
          assertEquals(
            await flow.text("[data-focus-purpose]"),
            "읽을 때 쓰는 뜻",
          );
          assertEquals(await flow.count("[data-definitions] [data-term]"), 0);
          assertEquals(
            await flow.count("[data-candidates] [data-candidate]"),
            1,
          );
          assertEquals(
            await flow.count(`[data-evidence-row="${glossary.id}"]`),
            1,
          );
          await flow.click(`[data-evidence-row="${glossary.id}"]`);
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("뜻이 고정된 말")`,
            "출현 고정 판 본문 대기",
          );
          assertEquals((await term(flow)).evidence, evidence);
        },
      );

      await t.step(
        "documents/terms#R2: 3 미루기는 후보를 정의하지 않고 뜻 칸은 사람 입력 전 비어 있다",
        async () => {
          await meanings(flow);
          await flow.click("[data-later]");
          assertEquals(await flow.count("[data-deferred]"), 1);
          assertEquals((await term(flow)).definition, null);
          await flow.click("[data-decide]");
          assertEquals(
            await flow.evaluate(
              'document.querySelector("[data-meaning-definition]").value',
            ),
            "",
          );
          assertEquals(
            await flow.evaluate(
              'document.querySelector("[data-save-meaning]").disabled',
            ),
            true,
          );
        },
      );

      await t.step(
        "documents/terms#R2 documents/terms#R4: 6 사람이 직접 쓴 뜻이 실제 정의로 반영되고 고정 근거가 남는다",
        async () => {
          await flow.type("[data-meaning-definition]", "사람이 뜻을 정한 말");
          await flow.click("[data-save-meaning]");
          await flow.until(
            `document.querySelector("[data-definition]")?.textContent === "사람이 뜻을 정한 말"`,
            "사람 정의 반영 대기",
          );
          assertEquals(
            await flow.count("[data-candidates] [data-candidate]"),
            0,
          );
          const defined = await term(flow);
          assertEquals(defined.definition, "사람이 뜻을 정한 말");
          assertEquals(defined.evidence, evidence);
          await meanings(flow, OTHER);
          assertEquals(
            await flow.text("[data-definition]"),
            "글을 쓸 때 정한 별도 뜻",
          );
          assertEquals((await term(flow)).definition, "사람이 뜻을 정한 말");
        },
      );

      await t.step(
        "documents/terms#R2: 전제가 바뀌면 옛 화면의 수정은 conflict이며 최신 사람 정의를 덮지 않는다",
        async () => {
          await meanings(flow);
          await flow.click("[data-change-meaning]");
          const before = await term(flow);
          await mustCall(flow, {
            kind: "command",
            resource: "terms",
            method: "update",
            body: commandBody({
              term: CANDIDATE,
              definition: "다른 창에서 정한 뜻",
            }, { base_revision: before.revision }),
          });
          await flow.type("[data-meaning-definition]", "낡은 화면의 뜻");
          await flow.click("[data-save-meaning]");
          await flow.until(
            `document.querySelector("[data-meaning-changed]") !== null`,
            "충돌 안내 대기",
          );
          assertEquals((await term(flow)).definition, "다른 창에서 정한 뜻");
          await flow.until(
            `document.querySelector("[data-definition]")?.textContent === "다른 창에서 정한 뜻"`,
            "최신 뜻 다시 읽기 대기",
          );
        },
      );

      await t.step(
        "documents/terms#R5: context·용어를 보관해도 사람 정의·출현 근거를 지우지 않는다",
        async () => {
          await flow.click('[data-archive-focus="archive"]');
          await flow.until(
            `document.querySelector("[data-focus-archived]") !== null`,
            "context 보관 대기",
          );
          const before = await term(flow);
          await mustCall(flow, {
            kind: "command",
            resource: "terms",
            method: "archive",
            body: commandBody({ term: CANDIDATE }, {
              base_revision: before.revision,
            }),
          });
          const archived = await term(flow);
          assertEquals(archived.definition, before.definition);
          assertEquals(archived.evidence, evidence);
          const got = await mustCall(flow, {
            kind: "read",
            resource: "documents",
            method: "get",
            body: { document: glossary.id },
          });
          assertEquals((got.document as { status: string }).status, "active");
          assertEquals(
            (await documentTitled(flow, "glossary")).latest_version,
            glossary.latest_version,
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// 2: Context Engineer가 context 목차에서 시작해 필요한 section 본문만 읽는다.
// 같은 context의 서로 다른 문서 3개 이상에 그대로 있는 미등록 말만 후보다.
// 근거는 그 고정 판의 section·줄 범위이고 후보당 최대 5개다. 뜻은 정하지 않는다.
// 2개 문서·등록된 말·본문을 읽지 않은 말은 후보가 아니다. 이 단계는 사람 화면에 보이지 않는다.
// model은 fake provider script다.
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fb6";
const MODEL = "claude-sonnet-4-5";
const LARGE = "ctx_01arz3ndektsv4rrffq69g5fb6";
const SMALL = "ctx_01arz3ndektsv4rrffq69g5fb7";
const DEFINED = "trm_01arz3ndektsv4rrffq69g5fb6";
const LARGE_PURPOSE = "같은 자료에서 그대로 쓰인 말을 본다";
const SMALL_PURPOSE = "자료가 두 개인 묶음";
const WORD = "정산주기";
const PAIR = "임시표";
const REGISTERED = "용어";
const THIN = "짧은묶음";
const ASIDE = "배경 문장만";
const ASK =
  "같은 context의 자료에서 아직 등록되지 않은 말을 이름과 근거만 남겨 달라.";
const DONE_TEXT = "읽기를 마쳤다.";
const EMBEDDED = "[data-dock='embedded']";
const INPUT = `${EMBEDDED} [data-composer-input]`;
const SEND = `${EMBEDDED} [data-send]`;
const TITLES = [
  "알파",
  "베타",
  "감마",
  "델타",
  "엡실론",
  "제타",
  "짧은가",
  "짧은나",
] as const;

function source(title: string, line: string): string {
  return `# ${title}\n\n${ASIDE} 있다. 여기 말은 본문으로 읽지 않는다.\n\n## 쓰임\n\n${line}\n`;
}

function note(title: string, line: string): [string, string] {
  return [`${title}.md`, source(title, line)];
}

const GATHER_FILES: readonly [string, string][] = [
  note(
    "알파",
    `${WORD}라는 말이 그대로 있다. ${REGISTERED}도 본문에 있다. ${PAIR}는 두 곳에만 있다.`,
  ),
  note(
    "베타",
    `${WORD}라는 말이 그대로 있다. ${REGISTERED}도 본문에 있다. ${PAIR}는 두 곳에만 있다.`,
  ),
  note("감마", `${WORD}라는 말이 그대로 있다. ${REGISTERED}도 본문에 있다.`),
  note("델타", `${WORD}라는 말이 그대로 있다.`),
  note("엡실론", `${WORD}라는 말이 그대로 있다.`),
  note("제타", `${WORD}라는 말이 그대로 있다.`),
  ["짧은가.md", `# 짧은가\n\n${THIN}이라는 말이 두 문서에만 있다.\n`],
  ["짧은나.md", `# 짧은나\n\n${THIN}이라는 말이 두 문서에만 있다.\n`],
];

const ALPHA_NEXT = source("알파", "새 판의 다른 문장이다.");

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
  if (json["complete"] === false) {
    throw new Error(`결과가 잘렸다: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return content as Record<string, unknown>;
}

function offeredTools(body: string): string[] {
  const request = JSON.parse(body) as { tools?: { name?: string }[] };
  return (request.tools ?? []).map((tool) => String(tool.name ?? ""));
}

type Doc = {
  document: string;
  version: string;
  title: string;
  section: string;
};

type Evidence = {
  document: string;
  version: string;
  section: string;
  start_line: number;
  end_line: number;
};

type Hit = Doc & {
  start_line: number;
  end_line: number;
  latest: string;
  pair: boolean;
  registered: boolean;
};

type GatherPhase =
  | "list"
  | "small"
  | "large"
  | "terms"
  | "outline"
  | "section"
  | "propose"
  | "done";

type GatherFixture = {
  url: string;
  calls: () => number;
  body: (index: number) => string;
  close: () => Promise<void>;
  failure: () => string;
  holding: () => boolean;
  release: () => void;
  done: () => boolean;
  callsNamed: () => readonly string[];
  readDocuments: () => readonly string[];
  smallDocuments: () => readonly string[];
  evidence: () => Evidence[];
  leftOut: () => string;
  alpha: () => { document: string; version: string; section: string };
  pairCount: () => number;
  registeredSeen: () => number;
};

function startGatherScript(): GatherFixture {
  const bodies: string[] = [];
  const named: string[] = [];
  const readDocuments: string[] = [];
  const retries = new Map<string, number>();
  const found = {
    phase: "list" as GatherPhase,
    failure: "",
    holding: false,
    largeId: "",
    smallDocuments: [] as string[],
    registered: [] as string[],
    docs: [] as Doc[],
    outlineAt: 0,
    sectionAt: 0,
    hits: [] as Hit[],
    pairCount: 0,
    registeredSeen: 0,
    evidence: [] as Evidence[],
    leftOut: "",
  };
  let resolveHold = (): void => {};
  const hold = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("새 판을 기다리다 끊겼다")),
      120_000,
    );
    resolveHold = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  // 아무도 풀지 않아도 프로세스를 붙잡지 않는다. 실패는 handler가 받는다.
  hold.catch(() => {});

  const issue = (id: string, name: string, args: unknown): SemanticReply => {
    named.push(name);
    return toolCall(id, name, args);
  };
  const outlineCall = (): SemanticReply => {
    const doc = found.docs[found.outlineAt];
    assert(doc !== undefined, "목차 문서가 없다");
    readDocuments.push(doc.document);
    const attempt = retries.get(`o:${doc.document}`) ?? 0;
    return issue(
      `toolu_outline_${found.outlineAt}_${attempt}`,
      "document.outline",
      {
        reference: {
          document: doc.document,
          version: doc.version,
          section: null,
        },
      },
    );
  };
  const sectionCall = (): SemanticReply => {
    const doc = found.docs[found.sectionAt];
    assert(doc !== undefined && doc.section !== "", "section 문서가 없다");
    readDocuments.push(doc.document);
    const attempt = retries.get(`s:${doc.document}`) ?? 0;
    return issue(
      `toolu_section_${found.sectionAt}_${attempt}`,
      "document.read_section",
      {
        reference: {
          document: doc.document,
          version: doc.version,
          section: null,
        },
        section: doc.section,
      },
    );
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
        if (index === 0) {
          reply = issue("toolu_list", "context.list", {});
        } else if (found.phase === "list") {
          const contexts = toolContent(text)["contexts"] as {
            id?: string;
            purpose?: string;
          }[];
          const large = contexts.find((row) => row.purpose === LARGE_PURPOSE);
          const small = contexts.find((row) => row.purpose === SMALL_PURPOSE);
          assert(
            typeof large?.id === "string" && typeof small?.id === "string",
            JSON.stringify(contexts).slice(0, 500),
          );
          found.largeId = large.id;
          found.phase = "small";
          reply = issue("toolu_small", "context.items", { context: small.id });
        } else if (found.phase === "small") {
          const entries = toolContent(text)["entries"] as {
            kind?: string;
            target?: { document?: string };
          }[];
          assert(
            entries.length < 3,
            `작은 묶음이 후보 조건을 넘긴다: ${entries.length}`,
          );
          found.smallDocuments = entries.map((entry) => {
            const id = entry.target?.document;
            assert(typeof id === "string", JSON.stringify(entry).slice(0, 300));
            return id;
          });
          found.phase = "large";
          reply = issue("toolu_large", "context.items", {
            context: found.largeId,
          });
        } else if (found.phase === "large") {
          const entries = toolContent(text)["entries"] as {
            kind?: string;
            title?: string;
            version?: string | null;
            target?: { document?: string };
          }[];
          assert(entries.length >= 3, `자료가 3개 미만이다: ${entries.length}`);
          const docs: Doc[] = [];
          for (const entry of entries) {
            if (entry.kind !== "document") continue;
            const id = entry.target?.document;
            assert(
              typeof id === "string" && typeof entry.version === "string" &&
                typeof entry.title === "string" && entry.title !== "",
              JSON.stringify(entry).slice(0, 300),
            );
            docs.push({
              document: id,
              version: entry.version,
              title: entry.title,
              section: "",
            });
          }
          assert(docs.length >= 6, JSON.stringify(docs).slice(0, 500));
          assert(
            docs.some((doc) => doc.title === "알파"),
            "알파가 목차에 없다",
          );
          assert(
            docs.some((doc) => doc.title === "제타"),
            "제타가 목차에 없다",
          );
          found.docs = docs;
          found.phase = "terms";
          reply = issue("toolu_terms", "context.terms", {
            context: found.largeId,
          });
        } else if (found.phase === "terms") {
          const definitions = toolContent(text)["definitions"] as {
            name?: string;
          }[];
          found.registered = definitions.map((term) => String(term.name ?? ""));
          assert(
            found.registered.includes(REGISTERED),
            JSON.stringify(definitions).slice(0, 400),
          );
          found.phase = "outline";
          reply = outlineCall();
        } else if (found.phase === "outline") {
          const doc = found.docs[found.outlineAt];
          assert(doc !== undefined, "목차 차례가 없다");
          const content = toolContent(text);
          assertEquals(content["version"], doc.version, doc.title);
          const raw = JSON.stringify(content);
          assertEquals(raw.includes(WORD), false, "목차에 본문이 있다");
          assertEquals(
            raw.includes(ASIDE),
            false,
            "목차에 다른 section 본문이 있다",
          );
          const entries = content["entries"] as {
            key?: string;
            title?: string;
          }[];
          const section = entries.find((entry) => entry.title === "쓰임");
          const ready = content["section_status"] === "whole" &&
            typeof section?.key === "string";
          const attempt = retries.get(`o:${doc.document}`) ?? 0;
          if (!ready && attempt < 8) {
            retries.set(`o:${doc.document}`, attempt + 1);
            await delay(1000);
            reply = outlineCall();
          } else {
            const key = section?.key;
            assert(
              ready && typeof key === "string",
              `목차가 준비되지 않았다: ${doc.title} ${raw.slice(0, 300)}`,
            );
            doc.section = key;
            found.outlineAt += 1;
            if (found.outlineAt < found.docs.length) {
              reply = outlineCall();
            } else {
              found.holding = true;
              try {
                await hold;
              } finally {
                found.holding = false;
              }
              found.phase = "section";
              reply = sectionCall();
            }
          }
        } else if (found.phase === "section") {
          const doc = found.docs[found.sectionAt];
          assert(doc !== undefined, "본문 차례가 없다");
          const content = toolContent(text);
          const version = String(content["version"] ?? "");
          const latest = String(content["latest_version"] ?? "");
          const body = typeof content["text"] === "string"
            ? content["text"]
            : "";
          assertEquals(version, doc.version, `${doc.title} 판이 바뀌었다`);
          assertEquals(
            body.includes(ASIDE),
            false,
            `${doc.title}가 다른 section을 읽었다`,
          );
          const fresh = doc.title !== "알파" || latest !== version;
          const attempt = retries.get(`s:${doc.document}`) ?? 0;
          if ((!body.includes(WORD) || !fresh) && attempt < 8) {
            retries.set(`s:${doc.document}`, attempt + 1);
            await delay(1000);
            reply = sectionCall();
          } else {
            assert(
              body.includes(WORD) && fresh,
              `${doc.title} 고정 판 본문이 없다: latest=${latest} ${
                body.slice(0, 80)
              }`,
            );
            const ranges = content["ranges"] as {
              start_line?: number;
              end_line?: number;
            }[];
            const start = Math.min(
              ...ranges.map((range) => range.start_line ?? 0),
            );
            const end = Math.max(...ranges.map((range) => range.end_line ?? 0));
            assert(
              ranges.length > 0 && start >= 1 && end >= start,
              JSON.stringify(ranges),
            );
            found.hits.push({
              ...doc,
              start_line: start,
              end_line: end,
              latest,
              pair: body.includes(PAIR),
              registered: body.includes(REGISTERED),
            });
            found.sectionAt += 1;
            if (found.sectionAt < found.docs.length) {
              reply = sectionCall();
            } else {
              assertEquals(found.hits.length, found.docs.length);
              const kept = found.hits.filter((hit) => hit.title !== "제타");
              const left = found.hits.find((hit) => hit.title === "제타");
              assert(left !== undefined, "제타 출현이 없다");
              assertEquals(kept.length, 5);
              found.pairCount = found.hits.filter((hit) => hit.pair).length;
              found.registeredSeen = found.hits.filter((hit) =>
                hit.registered
              ).length;
              assertEquals(found.pairCount, 2);
              assert(found.registeredSeen >= 3, String(found.registeredSeen));
              assertEquals(found.registered.includes(PAIR), false);
              assertEquals(found.registered.includes(WORD), false);
              found.leftOut = left.document;
              found.evidence = kept.map((hit) => ({
                document: hit.document,
                version: hit.version,
                section: hit.section,
                start_line: hit.start_line,
                end_line: hit.end_line,
              }));
              found.phase = "propose";
              reply = issue("toolu_propose", "term.propose_candidate", {
                context: found.largeId,
                name: WORD,
                evidence: found.evidence,
              });
            }
          }
        } else if (found.phase === "propose") {
          const term = toolContent(text)["term"] as {
            name?: string;
            definition?: string | null;
            evidence?: unknown[];
          };
          assertEquals(term.name, WORD);
          assertEquals(term.definition, null);
          assertEquals(term.evidence?.length, 5);
          found.phase = "done";
          reply = said(DONE_TEXT);
        } else {
          return Response.json({ error: "exhausted" }, { status: 500 });
        }
      } catch (error) {
        found.failure = `call ${index}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        found.holding = false;
        resolveHold();
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
    holding: () => found.holding,
    release: () => resolveHold(),
    done: () => found.phase === "done",
    callsNamed: () => named,
    readDocuments: () => readDocuments,
    smallDocuments: () => found.smallDocuments,
    evidence: () => found.evidence,
    leftOut: () => found.leftOut,
    alpha: () => {
      const doc = found.docs.find((item) => item.title === "알파");
      assert(doc !== undefined, "알파를 못 찾는다");
      return {
        document: doc.document,
        version: doc.version,
        section: doc.section,
      };
    },
    pairCount: () => found.pairCount,
    registeredSeen: () => found.registeredSeen,
  };
}

async function untilGather(
  provider: GatherFixture,
  ready: () => boolean,
  what: string,
) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    assert(provider.failure() === "", provider.failure());
    if (ready()) return;
    assert(
      Date.now() < deadline,
      `${what}: call ${provider.calls()} ${
        provider.body(provider.calls() - 1).slice(-500)
      }`,
    );
    await delay(250);
  }
}

async function untilEngineerDone(flow: FlowShell, provider: GatherFixture) {
  try {
    await flow.until(
      `document.querySelector("${EMBEDDED} [data-work-status]")?.getAttribute("data-work-status") === "done"`,
      "후보 수집이 끝나지 않았다",
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
      } | failure=${provider.failure()} calls=${provider.calls()} dock=${dock} last=${
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

async function untilLatest(
  flow: FlowShell,
  title: string,
  version: string,
): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS + 60_000;
  for (;;) {
    const current = await documentTitled(flow, title);
    if (current.latest_version !== version) return current.latest_version;
    assert(Date.now() < deadline, `새 판이 없다: ${current.latest_version}`);
    await delay(250);
  }
}

async function readFixed(
  flow: FlowShell,
  document: string,
  version: string,
  section: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: Record<string, unknown> = {};
  for (;;) {
    last = await mustCall(flow, {
      kind: "worker",
      resource: "documents",
      method: "read",
      body: {
        reference: { document, version, section: null },
        section,
      },
    });
    if (
      typeof last["text"] === "string" && last["section_status"] === "found"
    ) {
      return last;
    }
    assert(
      Date.now() < deadline,
      `고정 판 본문이 없다: ${JSON.stringify(last).slice(0, 300)}`,
    );
    await delay(250);
  }
}

Deno.test({
  name:
    "lophn-agent/roles/context-engineer#R3 lophn-agent/roles/context-engineer#R8 documents/outline-and-search#R8 documents/terms#R1 documents/terms#R2 flow define-terms: 목차에서 필요한 본문만 읽고 3개 이상 문서의 미등록 말만 후보로 남긴다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    for (const [name, body] of GATHER_FILES) {
      await Deno.writeTextFile(`${folder}/${name}`, body);
    }
    const provider = startGatherScript();
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
      await untilDocuments(flow, TITLES, "문서 관측 대기");
      for (const title of TITLES.slice(0, 6)) {
        const document = await documentTitled(flow, title);
        await untilSectionStatus(
          flow,
          document.id,
          "whole",
          `${title} 추출 대기`,
        );
      }
      const versions = new Map<string, string>();
      const byTitle = new Map<string, { id: string; version: string }>();
      for (const title of TITLES) {
        const document = await documentTitled(flow, title);
        versions.set(title, document.latest_version);
        byTitle.set(title, {
          id: document.id,
          version: document.latest_version,
        });
      }
      const items = (titles: readonly string[]) =>
        titles.map((title) => ({
          target: {
            kind: "document" as const,
            document: byTitle.get(title)!.id,
            section: null,
          },
          perspective: "basis" as const,
          reason: "말의 본문 근거",
        }));
      await mustCall(flow, {
        kind: "command",
        resource: "contexts",
        method: "create",
        body: commandBody({
          id: LARGE,
          title: "Gathered words",
          purpose: LARGE_PURPOSE,
          items: items(TITLES.slice(0, 6)),
        }),
      });
      await mustCall(flow, {
        kind: "command",
        resource: "contexts",
        method: "create",
        body: commandBody({
          id: SMALL,
          title: "Thin words",
          purpose: SMALL_PURPOSE,
          items: items(TITLES.slice(6)),
        }),
      });
      await mustCall(flow, {
        kind: "command",
        resource: "terms",
        method: "define",
        body: commandBody({
          id: DEFINED,
          context: LARGE,
          name: REGISTERED,
          definition: "사람이 이미 정한 말",
        }),
      });

      await sendToEngineer(flow, ASK);
      await untilGather(provider, () => provider.holding(), "목차 대기");
      const pinned = provider.alpha();
      assertEquals(pinned.version, versions.get("알파"));
      await editExternally(folder, "알파.md", ALPHA_NEXT);
      const latest = await untilLatest(flow, "알파", pinned.version);
      provider.release();
      await untilGather(provider, () => provider.done(), "후보 수집");
      await untilEngineerDone(flow, provider);

      const named = provider.callsNamed();
      assertEquals(named[0], "context.list");
      const firstOutline = named.indexOf("document.outline");
      const firstSection = named.indexOf("document.read_section");
      assert(firstOutline > named.indexOf("context.items"));
      assert(firstOutline > named.indexOf("context.terms"));
      assert(firstSection > firstOutline);
      assertEquals(named.at(-1), "term.propose_candidate");
      assert(
        named.slice(firstOutline, firstSection).every((name) =>
          name === "document.outline"
        ),
        named.join(","),
      );
      assert(
        named.slice(firstSection, -1).every((name) =>
          name === "document.read_section"
        ),
        named.join(","),
      );
      for (
        const name of [
          "document.read_version",
          "document.read_range",
          "document.save_version",
          "document.create",
          "term.define",
          "term.update_candidate",
          "term.submit_definition_answer",
        ]
      ) {
        assertEquals(named.includes(name), false, name);
      }
      const tools = offeredTools(provider.body(0));
      assert(tools.includes("term.propose_candidate"));
      assert(tools.includes("document.outline"));
      assert(tools.includes("document.read_section"));
      assertEquals(tools.includes("term.define"), false);
      const smallIds = provider.smallDocuments();
      assertEquals(smallIds.length, 2);
      for (const id of smallIds) {
        assertEquals(provider.readDocuments().includes(id), false, id);
      }

      assertEquals(provider.pairCount(), 2);
      assert(provider.registeredSeen() >= 3);
      const evidence = provider.evidence();
      assertEquals(evidence.length, 5);
      assertEquals(new Set(evidence.map((item) => item.document)).size, 5);
      assertEquals(
        evidence.some((item) => item.document === provider.leftOut()),
        false,
      );
      const alphaEvidence = evidence.find((item) =>
        item.document === pinned.document
      );
      assert(alphaEvidence !== undefined, JSON.stringify(evidence));
      assertEquals(alphaEvidence.version, pinned.version);
      assertEquals(alphaEvidence.version === latest, false);
      assertEquals(alphaEvidence.section, pinned.section);
      assert(alphaEvidence.start_line >= 1);
      assert(alphaEvidence.end_line >= alphaEvidence.start_line);

      const listed = await mustCall(flow, {
        kind: "read",
        resource: "terms",
        method: "list",
        body: { context: LARGE },
      });
      const definitions = listed.definitions as {
        name: string;
        definition: string | null;
      }[];
      const candidates = listed.candidates as {
        name: string;
        definition: string | null;
        evidence: {
          document: string;
          version: string;
          section: string | null;
          start_line: number | null;
          end_line: number | null;
        }[];
      }[];
      assertEquals(definitions.map((term) => term.name), [REGISTERED]);
      assertEquals(definitions[0].definition, "사람이 이미 정한 말");
      assertEquals(candidates.map((term) => term.name), [WORD]);
      assertEquals(candidates[0].definition, null);
      assertEquals(candidates[0].evidence, evidence);
      const thin = await mustCall(flow, {
        kind: "read",
        resource: "terms",
        method: "list",
        body: { context: SMALL },
      });
      assertEquals(thin.definitions, []);
      assertEquals(thin.candidates, []);

      const outline = await mustCall(flow, {
        kind: "worker",
        resource: "outline",
        method: "document",
        body: {
          reference: {
            document: pinned.document,
            version: pinned.version,
            section: null,
          },
        },
      });
      assertEquals(outline.version, pinned.version);
      assertEquals(outline.latest_version, latest);
      const oldBody = await readFixed(
        flow,
        pinned.document,
        pinned.version,
        pinned.section,
      );
      assertEquals(oldBody["version"], pinned.version);
      assertEquals(oldBody["latest_version"], latest);
      assertStringIncludes(String(oldBody["text"]), WORD);
      assertEquals(
        String(oldBody["text"]).includes("새 판의 다른 문장"),
        false,
      );
      const newBody = await readFixed(
        flow,
        pinned.document,
        latest,
        pinned.section,
      );
      assertStringIncludes(String(newBody["text"]), "새 판의 다른 문장");
      assertEquals(String(newBody["text"]).includes(WORD), false);

      for (const title of TITLES) {
        const version = (await documentTitled(flow, title)).latest_version;
        assertEquals(
          version,
          title === "알파" ? latest : versions.get(title),
          title,
        );
      }
      const shown = (await flow.text(EMBEDDED)) ?? "";
      assertStringIncludes(shown, DONE_TEXT);
      for (
        const hidden of [
          WORD,
          PAIR,
          THIN,
          ASIDE,
          "document.outline",
          "document.read_section",
          "term.propose_candidate",
          "term.define",
          "새 판의 다른 문장",
        ]
      ) {
        assertEquals(shown.includes(hidden), false, hidden);
      }
      assertEquals(await flow.count("[data-meaning-definition]"), 0);
      assertEquals(await flow.count("[data-candidates]"), 0);
    } finally {
      await flow?.close();
      await provider.close();
      if (flow !== undefined) await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// 3: contexts 화면은 이미 정한 뜻과 후보를 나누어 보인다. conversation에서는 결정을
// 필요로 하는 말 하나만, 고정 판 근거·미정 선택·추천 이유와 함께 묻는다. 고르기만
// 하거나 일반 메시지로 긍정한 것은 답이 아니고 정의도 아니다. 이름·뜻을 자유 답으로
// 명시하거나 미루면 그 질문만 닫히고, 후보 정의는 그대로다. 선택지에 고정 action이
// 없으므로 machine 적용(4)과 변경 기록(5)은 여기서 하지 않는다.
const ASK_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fb8";
const KNOWN_TERM = "trm_01arz3ndektsv4rrffq69g5fb8";
const OPEN_TERM = "trm_01arz3ndektsv4rrffq69g5fb9";
const LATER_TERM = "trm_01arz3ndektsv4rrffq69g5fba";
const KNOWN_NAME = "용어";
const KNOWN_MEANING = "사람이 이미 정한 말";
const OPEN_NAME = "정산주기";
const LATER_NAME = "임시표";
const ASK_PURPOSE = "뜻을 정할 때 쓰는 자료";
const ASK_TITLE = "결정알파";
const SECTION_TITLE = "쓰임";
const ASK_MARKER = "이미 정한 뜻은 다시 묻지";
const YES_MARKER = "추천한 대로";
const SECOND_MARKER = "그 말만 물어 달라";
const ASK_TEXT =
  "아직 정하지 않은 말만 물어 달라. 이미 정한 뜻은 다시 묻지 말라.";
const YES_TEXT = "응, 추천한 대로 뜻을 정해 줘.";
const SECOND_TEXT = "임시표는 내가 이름과 뜻을 적겠다. 그 말만 물어 달라.";
const FIRST_PROMPT = "정산주기에 어떤 이름을 쓸까요?";
const SECOND_PROMPT = "임시표에 쓸 이름과 뜻을 정해 주세요";
const RECOMMEND_WHY = "고정 판에 그대로 있는 이름이다.";
const SECOND_WHY = "본문에 그대로 있는 이름이다.";
const YES_REPLY = "일반 메시지는 정의가 아니다. 추천도 적용하지 않았다.";
const NOTED_REPLY =
  "적은 이름과 뜻은 질문의 답으로만 남겼다. 정의로 적용하지 않았다.";
const OWN_ANSWER = "이름은 임시표, 뜻은 잠시 적어 두는 표";
const NO_ANSWER = "If you don't answer, nothing is chosen for you.";
const CHOICES = [
  [
    "keep",
    "정산주기라는 이름을 유지한다",
    "본문에 있는 이름을 유지한다. 뜻은 아직 없다.",
  ],
  ["rename", "다른 이름을 쓴다", "본문과 다른 이름을 쓴다. 뜻은 아직 없다."],
  ["narrow", "더 좁은 뜻으로 둔다", "쓰는 범위를 좁혀 둔다. 뜻은 아직 없다."],
  ["widen", "더 넓은 뜻으로 둔다", "쓰는 범위를 넓혀 둔다. 뜻은 아직 없다."],
  ["split", "두 말로 나누어 둔다", "한 말을 나누어 둔다. 뜻은 아직 없다."],
  ["note", "근거만 남겨 둔다", "출현 근거만 둔다. 뜻은 아직 없다."],
  ["hold", "이번엔 정하지 않는다", "결정을 미뤄 둔다. 뜻은 아직 없다."],
] as const;

function reasonFor(
  name: string,
  start: number,
  end: number,
  rest: string,
): string {
  return `${name}는 고정 판의 쓰임 section ${start}-${end}줄에 그대로 있다. ${rest}`;
}

type AskPhase =
  | "list"
  | "terms"
  | "outline"
  | "section"
  | "ask-result"
  | "submitted"
  | "asked"
  | "yesed"
  | "second-terms"
  | "second-hold"
  | "done";

type Ground = {
  document: string;
  version: string;
  section: string;
  start_line: number;
  end_line: number;
};

type TermSeen = {
  name?: string;
  definition?: string | null;
  evidence?: {
    document?: string;
    version?: string;
    section?: string | null;
    start_line?: number | null;
    end_line?: number | null;
  }[];
};

type AskFixture = {
  url: string;
  calls: () => number;
  body: (index: number) => string;
  close: () => Promise<void>;
  failure: () => string;
  phase: () => AskPhase;
  callsNamed: () => readonly string[];
  ground: () => Ground;
  firstReason: () => string;
  secondReason: () => string;
};

function latestAsk(body: string): "ask" | "yes" | "second" | "none" {
  const marks = [
    ["second", body.lastIndexOf(SECOND_MARKER)],
    ["yes", body.lastIndexOf(YES_MARKER)],
    ["ask", body.lastIndexOf(ASK_MARKER)],
  ] as const;
  let best: "ask" | "yes" | "second" | "none" = "none";
  let at = -1;
  for (const [name, index] of marks) {
    if (index > at) {
      at = index;
      best = name;
    }
  }
  return best;
}

function startAskScript(): AskFixture {
  const bodies: string[] = [];
  const named: string[] = [];
  const retries = new Map<string, number>();
  const found = {
    phase: "list" as AskPhase,
    failure: "",
    context: "",
    ground: null as Ground | null,
    firstReason: "",
    secondReason: "",
  };

  const issue = (id: string, name: string, args: unknown): SemanticReply => {
    named.push(name);
    return toolCall(id, name, args);
  };
  const termsCall = (id: string): SemanticReply =>
    issue(id, "context.terms", { context: found.context });
  const askFirst = (): SemanticReply => {
    const ground = found.ground;
    assert(ground !== null, "근거가 없다");
    const evidence = [{
      document: ground.document,
      version: ground.version,
      section: ground.section,
    }];
    found.firstReason = reasonFor(
      OPEN_NAME,
      ground.start_line,
      ground.end_line,
      "이미 정한 용어의 뜻은 다시 묻지 않는다.",
    );
    found.phase = "submitted";
    return issue("toolu_ask_first", "question.submit", {
      prompt: FIRST_PROMPT,
      reason: found.firstReason,
      options: CHOICES.map(([key, label, description]) => ({
        key,
        label,
        description,
        evidence,
        adoption: null,
        action: null,
      })),
      recommendation: { option_key: "keep", explanation: RECOMMEND_WHY },
      expires_at: null,
    });
  };
  const askSecond = (): SemanticReply => {
    const ground = found.ground;
    assert(ground !== null, "근거가 없다");
    found.secondReason = reasonFor(
      LATER_NAME,
      ground.start_line,
      ground.end_line,
      "정산주기와 이미 정한 용어는 이 질문에 넣지 않는다.",
    );
    found.phase = "second-hold";
    return issue("toolu_ask_second", "question.submit", {
      prompt: SECOND_PROMPT,
      reason: found.secondReason,
      options: [
        {
          key: "keep",
          label: "임시표라는 이름을 유지한다",
          description: "본문에 있는 이름을 유지하고 뜻은 사람이 적는다.",
          evidence: [{
            document: ground.document,
            version: ground.version,
            section: ground.section,
          }],
          adoption: null,
          action: null,
        },
        {
          key: "rename",
          label: "다른 이름을 쓴다",
          description: "본문과 다른 이름을 사람이 적는다.",
          evidence: [{
            document: ground.document,
            version: ground.version,
            section: ground.section,
          }],
          adoption: null,
          action: null,
        },
      ],
      recommendation: { option_key: "keep", explanation: SECOND_WHY },
      expires_at: null,
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
      bodies.push(text);
      let reply: SemanticReply;
      try {
        if (found.phase === "list") {
          reply = issue("toolu_ask_list", "context.list", {});
          found.phase = "terms";
        } else if (found.phase === "terms") {
          const contexts = toolContent(text)["contexts"] as {
            id?: string;
            purpose?: string;
          }[];
          const context = contexts.find((row) => row.purpose === ASK_PURPOSE);
          assert(
            context?.id === ASK_CONTEXT,
            JSON.stringify(contexts).slice(0, 400),
          );
          found.context = context.id;
          reply = termsCall("toolu_ask_terms");
          found.phase = "outline";
        } else if (found.phase === "outline") {
          const content = toolContent(text);
          const definitions = content["definitions"] as TermSeen[];
          const candidates = content["candidates"] as TermSeen[];
          const known = definitions.find((term) => term.name === KNOWN_NAME);
          const open = candidates.find((term) => term.name === OPEN_NAME);
          const later = candidates.find((term) => term.name === LATER_NAME);
          assertEquals(known?.definition, KNOWN_MEANING);
          assertEquals(open?.definition, null);
          assertEquals(later?.definition, null);
          assertEquals(
            definitions.some((term) => term.name === OPEN_NAME),
            false,
          );
          const evidence = open?.evidence?.[0];
          assert(
            typeof evidence?.document === "string" &&
              typeof evidence.version === "string" &&
              typeof evidence.section === "string" &&
              typeof evidence.start_line === "number" &&
              typeof evidence.end_line === "number",
            JSON.stringify(open).slice(0, 400),
          );
          found.ground = {
            document: evidence.document,
            version: evidence.version,
            section: evidence.section,
            start_line: evidence.start_line,
            end_line: evidence.end_line,
          };
          reply = issue("toolu_ask_outline", "document.outline", {
            reference: {
              document: evidence.document,
              version: evidence.version,
              section: null,
            },
          });
          found.phase = "section";
        } else if (found.phase === "section") {
          const ground = found.ground;
          assert(ground !== null, "근거가 없다");
          const content = toolContent(text);
          assertEquals(content["version"], ground.version);
          const raw = JSON.stringify(content);
          assertEquals(raw.includes(OPEN_NAME), false, "목차에 본문이 있다");
          assertEquals(
            raw.includes(ASIDE),
            false,
            "목차에 다른 section이 있다",
          );
          const entries = content["entries"] as {
            key?: string;
            title?: string;
          }[];
          const section = entries.find((entry) =>
            entry.title === SECTION_TITLE
          );
          const ready = content["section_status"] === "whole" &&
            section?.key === ground.section;
          const attempt = retries.get("outline") ?? 0;
          if (!ready && attempt < 8) {
            retries.set("outline", attempt + 1);
            await delay(1000);
            reply = issue(
              `toolu_ask_outline_${attempt}`,
              "document.outline",
              {
                reference: {
                  document: ground.document,
                  version: ground.version,
                  section: null,
                },
              },
            );
          } else {
            assert(ready, `목차가 준비되지 않았다: ${raw.slice(0, 300)}`);
            reply = issue("toolu_ask_section", "document.read_section", {
              reference: {
                document: ground.document,
                version: ground.version,
                section: null,
              },
              section: ground.section,
            });
            found.phase = "ask-result";
          }
        } else if (found.phase === "ask-result") {
          const ground = found.ground;
          assert(ground !== null, "근거가 없다");
          const content = toolContent(text);
          const body = typeof content["text"] === "string"
            ? content["text"]
            : "";
          const ranges = content["ranges"] as {
            start_line?: number;
            end_line?: number;
          }[];
          const start = ranges.length === 0
            ? 0
            : Math.min(...ranges.map((range) => range.start_line ?? 0));
          const end = ranges.length === 0
            ? 0
            : Math.max(...ranges.map((range) => range.end_line ?? 0));
          const fresh = content["version"] === ground.version &&
            body.includes(OPEN_NAME) && body.includes(LATER_NAME) &&
            !body.includes(ASIDE) && start === ground.start_line &&
            end === ground.end_line;
          const attempt = retries.get("section") ?? 0;
          if (!fresh && attempt < 8) {
            retries.set("section", attempt + 1);
            await delay(1000);
            reply = issue(
              `toolu_ask_section_${attempt}`,
              "document.read_section",
              {
                reference: {
                  document: ground.document,
                  version: ground.version,
                  section: null,
                },
                section: ground.section,
              },
            );
          } else {
            assert(fresh, `고정 판 본문이 없다: ${body.slice(0, 160)}`);
            reply = askFirst();
          }
        } else if (found.phase === "submitted") {
          // 질문을 낸 run은 답을 기다린다. 질문이 미뤄지면 그 run은 model을 다시 부르지 않고
          // 기다리던 일반 긍정이 새 run으로 이어진다.
          assertEquals(latestAsk(text), "yes", "일반 긍정이 아니다");
          found.phase = "yesed";
          reply = said(YES_REPLY);
        } else if (found.phase === "asked") {
          assertEquals(latestAsk(text), "yes", "일반 긍정이 아니다");
          found.phase = "yesed";
          reply = said(YES_REPLY);
        } else if (found.phase === "yesed") {
          assertEquals(latestAsk(text), "second", "둘째 질문이 아니다");
          reply = termsCall("toolu_ask_terms_again");
          found.phase = "second-terms";
        } else if (found.phase === "second-terms") {
          const content = toolContent(text);
          const definitions = content["definitions"] as TermSeen[];
          const candidates = content["candidates"] as TermSeen[];
          assertEquals(
            definitions.find((term) => term.name === KNOWN_NAME)?.definition,
            KNOWN_MEANING,
          );
          assertEquals(
            candidates.find((term) => term.name === OPEN_NAME)?.definition,
            null,
          );
          assertEquals(
            candidates.find((term) => term.name === LATER_NAME)?.definition,
            null,
          );
          assertEquals(
            definitions.some((term) =>
              term.name === OPEN_NAME || term.name === LATER_NAME
            ),
            false,
          );
          reply = askSecond();
        } else if (found.phase === "second-hold") {
          // 사람의 답으로 같은 run이 이어진 호출이다.
          toolContent(text);
          found.phase = "done";
          reply = said(NOTED_REPLY);
        } else {
          throw new Error(`예상하지 않은 단계: ${found.phase}`);
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
    calls: () => bodies.length,
    body: (index) => bodies[index] ?? "",
    close: () => server.shutdown(),
    failure: () => found.failure,
    phase: () => found.phase,
    callsNamed: () => named,
    ground: () => {
      assert(found.ground !== null, "근거가 없다");
      return found.ground;
    },
    firstReason: () => found.firstReason,
    secondReason: () => found.secondReason,
  };
}

async function untilAsk(
  provider: AskFixture,
  ready: () => boolean,
  what: string,
) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    assert(provider.failure() === "", provider.failure());
    if (ready()) return;
    assert(
      Date.now() < deadline,
      `${what}: phase ${provider.phase()} call ${provider.calls()} ${
        provider.body(provider.calls() - 1).slice(-500)
      }`,
    );
    await delay(250);
  }
}

async function untilAskDone(
  flow: FlowShell,
  provider: AskFixture,
  what: string,
) {
  try {
    await flow.until(
      `document.querySelector("${EMBEDDED} [data-work-status]")?.getAttribute("data-work-status") === "done"`,
      what,
      180_000,
    );
  } catch (error) {
    throw new Error(
      `${
        (error as Error).message
      } | failure=${provider.failure()} phase=${provider.phase()} calls=${provider.calls()} last=${
        provider.body(provider.calls() - 1).slice(-400)
      }`,
    );
  }
}

async function registerAskProvider(flow: FlowShell, url: string) {
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
      endpoint: url,
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
}

type AskedQuestion = {
  id: string;
  status: string;
  answer: { kind?: string; option_key?: string | null } | null;
  applied: boolean;
  closed_reason: string | null;
  created_seq: string;
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
  }).then((listed) =>
    (listed.questions as AskedQuestion[]).slice().sort((left, right) =>
      BigInt(left.created_seq) < BigInt(right.created_seq) ? -1 : 1
    )
  );
}

async function definitionOf(flow: FlowShell, term: string): Promise<unknown> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "terms",
    method: "get",
    body: { term },
  });
  return (got.term as { definition: string | null }).definition;
}

async function openAskMeanings(flow: FlowShell): Promise<void> {
  await flow.click('[data-screen="documents"]');
  await flow.click('[data-screen="contexts"]');
  await flow.until(
    `document.querySelector('[data-focus="${ASK_CONTEXT}"]') !== null`,
    "Focus 목록 대기",
  );
  await flow.click(`[data-focus="${ASK_CONTEXT}"]`);
  await flow.until(
    `document.querySelector('[data-focus-head="${ASK_CONTEXT}"]') !== null`,
    "Focus 상세 대기",
  );
  await flow.mouseClickText("[role=tab]", "Meanings");
  await flow.until(
    `document.querySelector("[data-meanings]") !== null`,
    "Meanings 대기",
  );
}

Deno.test({
  name:
    "documents/terms#R4 lophn-agent/roles/context-engineer#R10 lophn-agent/questions#R1 lophn-agent/questions#R3 lophn-agent/questions#R4 lophn-agent/questions#R6 flow define-terms 3: 정한 뜻과 후보를 구별하고 대화에서 근거·미정 선택·추천을 본 뒤 이름·뜻을 명시해 답하거나 미룬다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    await Deno.writeTextFile(
      `${folder}/${ASK_TITLE}.md`,
      `# ${ASK_TITLE}\n\n${ASIDE} 있다. 여기 말은 본문으로 읽지 않는다.\n\n## ${SECTION_TITLE}\n\n${OPEN_NAME}라는 말이 그대로 있다. ${LATER_NAME}도 여기에 있다.\n`,
    );
    const provider = startAskScript();
    let flow: FlowShell | undefined;
    try {
      flow = await openFlowShell({ start: "lophn" });
      const shell = flow;
      await registerAskProvider(shell, provider.url);
      await registerTrackedProject(shell, { folder });
      await untilDocuments(shell, [ASK_TITLE], "문서 관측 대기");
      const alpha = await documentTitled(shell, ASK_TITLE);
      await untilSectionStatus(
        shell,
        alpha.id,
        "whole",
        `${ASK_TITLE} 추출 대기`,
      );
      const preparedAt = Date.now() + READY_TIMEOUT_MS;
      let sectionKey = "";
      let version = alpha.latest_version;
      for (;;) {
        const current = await documentTitled(shell, ASK_TITLE);
        const outline = await mustCall(shell, {
          kind: "worker",
          resource: "outline",
          method: "document",
          body: {
            reference: {
              document: alpha.id,
              version: current.latest_version,
              section: null,
            },
          },
        });
        const section = (outline.entries as { key?: string; title?: string }[])
          .find((entry) => entry.title === SECTION_TITLE);
        if (
          outline.section_status === "whole" &&
          typeof section?.key === "string"
        ) {
          sectionKey = section.key;
          version = current.latest_version;
          break;
        }
        assert(
          Date.now() < preparedAt,
          `목차에 쓰임이 없다: ${
            JSON.stringify(outline.entries).slice(0, 300)
          }`,
        );
        await delay(250);
      }
      let start = 0;
      let end = 0;
      for (;;) {
        const read = await readFixed(shell, alpha.id, version, sectionKey);
        const body = String(read["text"] ?? "");
        const ranges = read["ranges"] as {
          start_line?: number;
          end_line?: number;
        }[];
        if (
          body.includes(OPEN_NAME) && body.includes(LATER_NAME) &&
          !body.includes(ASIDE) && ranges.length > 0
        ) {
          start = Math.min(...ranges.map((range) => range.start_line ?? 0));
          end = Math.max(...ranges.map((range) => range.end_line ?? 0));
          break;
        }
        assert(
          Date.now() < preparedAt,
          `고정 판 본문이 없다: ${body.slice(0, 160)} ${
            JSON.stringify(ranges)
          }`,
        );
        await delay(250);
      }
      assert(start >= 1 && end >= start, `${start}-${end}`);
      const evidence = {
        document: alpha.id,
        version,
        section: sectionKey,
        start_line: start,
        end_line: end,
      };
      await mustCall(shell, {
        kind: "command",
        resource: "contexts",
        method: "create",
        body: commandBody({
          id: ASK_CONTEXT,
          title: "Terms to decide",
          purpose: ASK_PURPOSE,
          items: [{
            target: {
              kind: "document",
              document: alpha.id,
              section: null,
            },
            perspective: "basis",
            reason: "말의 본문 근거",
          }],
        }),
      });
      await mustCall(shell, {
        kind: "command",
        resource: "terms",
        method: "define",
        body: commandBody({
          id: KNOWN_TERM,
          context: ASK_CONTEXT,
          name: KNOWN_NAME,
          definition: KNOWN_MEANING,
        }),
      });
      for (
        const [id, name] of [[OPEN_TERM, OPEN_NAME], [
          LATER_TERM,
          LATER_NAME,
        ]] as const
      ) {
        await mustCall(shell, {
          kind: "command",
          resource: "terms",
          method: "propose",
          body: commandBody({
            id,
            context: ASK_CONTEXT,
            name,
            evidence: [evidence],
          }),
        });
      }

      const ready = `${EMBEDDED} [data-question-text='ready']`;
      const sendAnswer = `${EMBEDDED} [data-send-answer]`;
      const untilQuestion = async (index: number) => {
        const until = Date.now() + 60_000;
        while ((await questionsOf(shell))[index] === undefined) {
          assert(Date.now() < until, `질문 ${index}이 만들어지지 않았다`);
          await delay(250);
        }
      };
      const untilPrompt = async (prompt: string) => {
        try {
          await shell.until(
            `document.querySelector(${
              JSON.stringify(ready)
            })?.textContent === ${JSON.stringify(prompt)}`,
            `질문이 칸에 서지 않았다: ${prompt}`,
            120_000,
          );
        } catch (error) {
          const dock = String(
            await shell.evaluate(
              `document.querySelector(${
                JSON.stringify(EMBEDDED)
              })?.innerText ?? null`,
            ),
          ).slice(0, 500);
          throw new Error(
            `${
              (error as Error).message
            } | failure=${provider.failure()} phase=${provider.phase()} dock=${dock}`,
          );
        }
      };

      await t.step(
        "documents/terms#R4: 3 contexts 화면에서 이미 정한 뜻과 후보를 구별해서 본다",
        async () => {
          await openAskMeanings(shell);
          assertEquals(
            await shell.count("[data-definitions] [data-term]"),
            1,
          );
          assertEquals(
            await shell.count("[data-candidates] [data-candidate]"),
            2,
          );
          const defined = (await shell.text("[data-definitions]")) ?? "";
          assertStringIncludes(defined, KNOWN_NAME);
          assertStringIncludes(defined, KNOWN_MEANING);
          assertEquals(defined.includes(OPEN_NAME), false);
          assertEquals(defined.includes(LATER_NAME), false);
          const candidates = (await shell.text("[data-candidates]")) ?? "";
          assertStringIncludes(candidates, OPEN_NAME);
          assertStringIncludes(candidates, LATER_NAME);
          assertStringIncludes(candidates, "Lines");
          assertEquals(candidates.includes(KNOWN_MEANING), false);
          assertEquals(
            await shell.count("[data-candidates] [data-evidence-row]"),
            2,
          );
          assertEquals(
            await shell.count("[data-definitions] [data-evidence-row]"),
            0,
          );
          await shell.click(`[data-evidence-row="${alpha.id}"]`);
          await shell.until(
            `document.querySelector("[data-body]")?.textContent.includes(${
              JSON.stringify(`${OPEN_NAME}라는 말이 그대로 있다`)
            })`,
            "출현 고정 판 본문 대기",
          );
          const listed = await mustCall(shell, {
            kind: "read",
            resource: "terms",
            method: "list",
            body: { context: ASK_CONTEXT },
          });
          const definitions = listed.definitions as { name: string }[];
          const undecided = listed.candidates as {
            name: string;
            definition: string | null;
          }[];
          assertEquals(definitions.map((term) => term.name), [KNOWN_NAME]);
          assertEquals(
            undecided.map((term) => term.name).sort(),
            [LATER_NAME, OPEN_NAME].sort(),
          );
          assertEquals(
            undecided.every((term) => term.definition === null),
            true,
          );
        },
      );

      await t.step(
        "lophn-agent/questions#R1 lophn-agent/questions#R3 lophn-agent/questions#R4 lophn-agent/roles/context-engineer#R10: 3 말 하나의 근거·미정 선택·추천만 묻고 고르기만으로는 답이 아니다",
        async () => {
          await sendToEngineer(shell, ASK_TEXT);
          await untilAsk(
            provider,
            () => provider.phase() === "submitted",
            "첫 질문",
          );
          await untilQuestion(0);
          const named = provider.callsNamed();
          assertEquals(named[0], "context.list");
          assert(
            named.indexOf("context.terms") < named.indexOf("document.outline"),
          );
          assert(
            named.indexOf("document.outline") <
              named.indexOf("document.read_section"),
          );
          assertEquals(named.at(-1), "question.submit");
          assertEquals(
            named.filter((name) => name === "question.submit").length,
            1,
          );
          assertEquals(named.includes("term.define"), false);
          const tools = offeredTools(provider.body(0));
          assert(tools.includes("question.submit"));
          assert(tools.includes("context.terms"));
          assertEquals(tools.includes("term.define"), false);
          const ground = provider.ground();
          assertEquals(ground, evidence);
          await untilPrompt(FIRST_PROMPT);
          assertEquals(
            await shell.text(`${EMBEDDED} [data-question-reason]`),
            provider.firstReason(),
          );
          assertEquals(await shell.count(`${EMBEDDED} [data-option]`), 7);
          for (const [key, label, description] of CHOICES) {
            const option = `${EMBEDDED} [data-option='${key}']`;
            assertEquals(
              await shell.text(`${option} [data-option-description]`),
              description,
            );
            assertStringIncludes((await shell.text(option)) ?? "", label);
          }
          assertEquals(await shell.count(`${EMBEDDED} [data-recommended]`), 1);
          assertEquals(
            await shell.count(
              `${EMBEDDED} [data-option='keep'] [data-recommended]`,
            ),
            1,
          );
          assertStringIncludes(
            (await shell.text(`${EMBEDDED} [data-recommendation]`)) ?? "",
            RECOMMEND_WHY,
          );
          assertStringIncludes(
            (await shell.text(`${EMBEDDED} [data-question-strip]`)) ?? "",
            NO_ANSWER,
          );
          assertEquals(await shell.count(`${EMBEDDED} [data-expires]`), 0);
          assertEquals(await shell.count(`${EMBEDDED} [data-opens-review]`), 0);
          assertEquals(await shell.count(`${EMBEDDED} [data-own-answer]`), 1);
          assertEquals(
            await shell.evaluate(
              `document.querySelector(${
                JSON.stringify(sendAnswer)
              })?.hasAttribute("disabled") ?? true`,
            ),
            true,
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
            CHOICES.map(([key]) => key),
          );
          for (const option of question.options) {
            assertEquals(option.action, null);
            assertEquals(option.evidence, [{
              document: evidence.document,
              version: evidence.version,
              section: evidence.section,
            }]);
          }
          assertEquals(question.recommendation?.option_key, "keep");
          const text = await mustCall(shell, {
            kind: "read",
            resource: "questions",
            method: "text",
            body: { question: question.id },
          });
          assertEquals(text["prompt"], FIRST_PROMPT);
          assertEquals(text["reason"], provider.firstReason());
          assertEquals(text["answer_text"], null);
          assertEquals(
            (text["prompt"] as string).includes(LATER_NAME),
            false,
          );
          await shell.click(`${EMBEDDED} [data-option='keep']`);
          await shell.until(
            `document.querySelector(${
              JSON.stringify(`${EMBEDDED} [data-option='keep']`)
            })?.getAttribute("aria-checked") === "true"`,
            "선택지가 골라지지 않았다",
          );
          await delay(1_000);
          const picked = (await questionsOf(shell))[0];
          assertEquals(picked?.status, "pending");
          assertEquals(picked?.answer, null);
          assertEquals(picked?.applied, false);
          assertEquals(await definitionOf(shell, OPEN_TERM), null);
          assertEquals(await definitionOf(shell, KNOWN_TERM), KNOWN_MEANING);
          const shown = (await shell.text(EMBEDDED)) ?? "";
          assertEquals(shown.includes("document.outline"), false);
          assertEquals(shown.includes("question.submit"), false);
        },
      );

      await t.step(
        "lophn-agent/questions#R6 lophn-agent/roles/context-engineer#R10: 3 일반 긍정은 답도 정의도 아니다",
        async () => {
          // 질문을 기다리는 run은 일반 메시지로 풀리지 않는다. 메시지는 다음 접수로 남는다.
          await sendToEngineer(shell, YES_TEXT);
          await delay(2_000);
          assertEquals(provider.phase(), "submitted");
          const questions = await questionsOf(shell);
          assertEquals(questions.length, 1);
          assertEquals(questions[0]?.status, "pending");
          assertEquals(questions[0]?.answer, null);
          assertEquals(questions[0]?.applied, false);
          assertEquals(await definitionOf(shell, OPEN_TERM), null);
          assertEquals(await definitionOf(shell, LATER_TERM), null);
          assertEquals(provider.callsNamed().includes("term.define"), false);
          assertEquals(
            provider.callsNamed().filter((name) => name === "question.submit")
              .length,
            1,
          );
        },
      );

      await t.step(
        "lophn-agent/roles/context-engineer#R10 lophn-agent/questions#R6: 3 미루기는 답 없음이고 후보를 정의하지 않는다",
        async () => {
          const before = (await questionsOf(shell))[0];
          assert(before !== undefined);
          await shell.click(`${EMBEDDED} [data-later]`);
          const deadline = Date.now() + 60_000;
          let deferred: AskedQuestion | undefined;
          for (;;) {
            deferred = (await questionsOf(shell))[0];
            if (deferred?.status === "cancelled") break;
            assert(
              Date.now() < deadline,
              `미루기가 접수되지 않았다: ${JSON.stringify(deferred ?? null)}`,
            );
            await delay(250);
          }
          assertEquals(deferred?.id, before.id);
          assertEquals(deferred?.closed_reason, "deferred");
          assertEquals(deferred?.answer, null);
          assertEquals(deferred?.applied, false);
          assertEquals(await definitionOf(shell, OPEN_TERM), null);
          await shell.until(
            `document.querySelector(${
              JSON.stringify(`${EMBEDDED} [data-question-strip]`)
            }) === null`,
            "미룬 질문이 칸에 남아 있다",
          );
          // 질문이 답 없음으로 끝나면 기다리던 일반 긍정이 새 run으로 이어진다.
          // 답 없음으로 끝난 run 뒤의 요청은 사람이 계속하라고 확인해야 시작한다(run-loop R6).
          // 기다리던 일반 긍정이 그 요청이다.
          const confirmBy = Date.now() + 60_000;
          for (;;) {
            const listed = await mustCall(shell, {
              kind: "read",
              resource: "runs",
              method: "list",
              body: {},
            });
            const runs = listed["runs"] as {
              id: string;
              state: string;
              start_after: string | null;
              accepted_seq: string;
              state_seq: string;
            }[];
            const queued = runs.find((run) => run.state === "accepted");
            const before = runs.find((run) => run.id === queued?.start_after);
            if (
              queued !== undefined && before !== undefined &&
              before.state === "finished"
            ) {
              await mustCall(shell, {
                kind: "command",
                resource: "runs",
                method: "confirm-next",
                body: commandBody({ run: queued.id, predecessor: before.id }, {
                  accepted_seq: queued.accepted_seq,
                  predecessor_state_seq: before.state_seq,
                }),
              });
              break;
            }
            assert(Date.now() < confirmBy, "기다리던 요청이 접수되지 않았다");
            await delay(250);
          }
          await untilAsk(
            provider,
            () => provider.phase() === "yesed",
            "일반 긍정",
          );
          await untilAskDone(shell, provider, "일반 긍정이 끝나지 않았다");
          assertStringIncludes((await shell.text(EMBEDDED)) ?? "", YES_REPLY);
          assertEquals(await definitionOf(shell, OPEN_TERM), null);
        },
      );

      await t.step(
        "lophn-agent/questions#R1 lophn-agent/questions#R3 lophn-agent/questions#R6: 3 이름·뜻을 명시한 자유 답은 질문의 답일 뿐 정의가 아니다",
        async () => {
          await sendToEngineer(shell, SECOND_TEXT);
          await untilAsk(
            provider,
            () => provider.phase() === "second-hold",
            "둘째 질문",
          );
          await untilQuestion(1);
          await untilPrompt(SECOND_PROMPT);
          assertEquals(
            await shell.text(`${EMBEDDED} [data-question-reason]`),
            provider.secondReason(),
          );
          assertEquals(
            await shell.text(
              `${EMBEDDED} [data-option='keep'] [data-option-description]`,
            ),
            "본문에 있는 이름을 유지하고 뜻은 사람이 적는다.",
          );
          assertEquals(
            await shell.text(
              `${EMBEDDED} [data-option='rename'] [data-option-description]`,
            ),
            "본문과 다른 이름을 사람이 적는다.",
          );
          assertStringIncludes(
            (await shell.text(`${EMBEDDED} [data-recommendation]`)) ?? "",
            SECOND_WHY,
          );
          assertEquals(await shell.count(`${EMBEDDED} [data-opens-review]`), 0);
          assertEquals(
            await shell.evaluate(
              `document.querySelector(${
                JSON.stringify(sendAnswer)
              })?.hasAttribute("disabled") ?? true`,
            ),
            true,
          );
          const pending = await questionsOf(shell);
          assertEquals(pending.length, 2);
          const second = pending[1];
          assert(second !== undefined);
          assertEquals(second.status, "pending");
          assertEquals(second.answer, null);
          assertEquals(second.applied, false);
          assertEquals(
            second.options.map((option) => option.key),
            ["keep", "rename"],
          );
          for (const option of second.options) {
            assertEquals(option.action, null);
            assertEquals(option.evidence, [{
              document: evidence.document,
              version: evidence.version,
              section: evidence.section,
            }]);
          }
          const text = await mustCall(shell, {
            kind: "read",
            resource: "questions",
            method: "text",
            body: { question: second.id },
          });
          assertEquals(text["prompt"], SECOND_PROMPT);
          assertEquals((text["prompt"] as string).includes(OPEN_NAME), false);
          assertEquals((text["prompt"] as string).includes(KNOWN_NAME), false);
          await shell.type(`${EMBEDDED} [data-own-answer]`, OWN_ANSWER);
          await shell.until(
            `(() => { const button = document.querySelector(${
              JSON.stringify(sendAnswer)
            }); return button !== null && button.disabled === false; })()`,
            "명시 답을 보낼 수 없다",
          );
          await shell.click(sendAnswer);
          const deadline = Date.now() + 60_000;
          let answered: AskedQuestion | undefined;
          for (;;) {
            answered = (await questionsOf(shell))[1];
            if (answered?.status === "answered") break;
            const dock = String(
              await shell.evaluate(
                `document.querySelector(${
                  JSON.stringify(EMBEDDED)
                })?.innerText ?? null`,
              ),
            ).slice(0, 400);
            assert(
              Date.now() < deadline,
              `명시 답이 접수되지 않았다: ${
                JSON.stringify(answered ?? null)
              } dock=${dock}`,
            );
            await delay(250);
          }
          assertEquals(answered?.answer?.kind, "text");
          assertEquals(answered?.applied, false);
          const answeredText = await mustCall(shell, {
            kind: "read",
            resource: "questions",
            method: "text",
            body: { question: second.id },
          });
          assertEquals(answeredText["answer_text"], OWN_ANSWER);
          assertEquals(await definitionOf(shell, LATER_TERM), null);
          assertEquals(await definitionOf(shell, OPEN_TERM), null);
          assertEquals(await definitionOf(shell, KNOWN_TERM), KNOWN_MEANING);
          await untilAsk(
            provider,
            () => provider.phase() === "done",
            "명시 답 종료",
          );
          await untilAskDone(shell, provider, "명시 답이 끝나지 않았다");
          assertEquals(provider.callsNamed().includes("term.define"), false);
          assertEquals(
            provider.callsNamed().filter((name) => name === "question.submit")
              .length,
            2,
          );
          assertStringIncludes((await shell.text(EMBEDDED)) ?? "", NOTED_REPLY);
          await shell.until(
            `document.querySelector(${
              JSON.stringify(`${EMBEDDED} [data-question-strip]`)
            }) === null`,
            "답한 질문이 칸에 남아 있다",
          );
          const kept = await mustCall(shell, {
            kind: "read",
            resource: "questions",
            method: "text",
            body: { question: second.id },
          });
          assertEquals(kept["answer_text"], OWN_ANSWER);
          await openAskMeanings(shell);
          assertEquals(
            await shell.count("[data-definitions] [data-term]"),
            1,
          );
          assertEquals(
            await shell.count("[data-candidates] [data-candidate]"),
            2,
          );
          assertEquals(await shell.text("[data-definition]"), KNOWN_MEANING);
          assertEquals(await definitionOf(shell, LATER_TERM), null);
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

// 4: 고정한 context·이름·뜻이 있는 선택지를 사람이 확정하면 machine이 그 내용만
// 사람의 결정으로 적용한다. 확인 창은 열지 않는다. 자유 답은 정의가 아니다.
const FIX_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fbb";
const FIX_TERM = "trm_01arz3ndektsv4rrffq69g5fbb";
const FIX_NAME = "정산주기";
const FIX_MEANING = "한 달이 끝나는 날 맞추는 계산";
const FIX_PURPOSE = "고정한 뜻만 적용한다";
const FIX_TITLE = "적용알파";
const FIX_PROMPT = "정산주기의 뜻을 이 글로 고정할까요?";
const FIX_REASON = "후보 이름과 이 뜻을 선택지에 고정했다.";
const FIX_TEXT = "정산주기의 뜻을 고정한 선택지로 물어 달라.";
const FIX_AGAIN = "같은 고정 선택지로 다시 물어 달라.";
const FREE_ANSWER = "뜻은 대충 한 달마다";
const FREE_REPLY = "자유 답은 정의로 적용하지 않았다.";
const AGAIN_NOTE = "같은 이름과 뜻을 다시 고정해 물어 두었다.";
const APPLIED_NOTE = "사람이 고른 선택지만 적용했다.";

type FixPhase = "ask" | "first-hold" | "idle" | "second-hold" | "done";

type FixFixture = {
  url: string;
  close: () => Promise<void>;
  failure: () => string;
  phase: () => FixPhase;
  callsNamed: () => string[];
  body: (index: number) => string;
  calls: () => number;
};

// 질문을 낸 run은 답을 기다리고(WaitRun) 답이 정해지면 같은 run이 이어져 tool 결과를
// 싣고 다시 model을 부른다. hold 단계의 두 번째 호출이 그 이어짐이다. 고정 action의
// 실제 적용은 machine의 갈래다(이 파일 아래 Deno.test 주석).
function startFixScript(): FixFixture {
  const bodies: string[] = [];
  const named: string[] = [];
  const found = { phase: "ask" as FixPhase, failure: "" };
  const issue = (id: string, name: string, args: unknown): SemanticReply => {
    named.push(name);
    return toolCall(id, name, args);
  };
  const choice = (
    key: string,
    label: string,
    description: string,
    fixed: boolean,
  ) => ({
    key,
    label,
    description,
    evidence: [],
    adoption: null,
    action: null,
    ...(fixed
      ? {
        term_definition: {
          term: FIX_TERM,
          name: FIX_NAME,
          definition: FIX_MEANING,
        },
      }
      : {}),
  });
  const ask = (id: string): SemanticReply =>
    issue(id, "question.submit", {
      prompt: FIX_PROMPT,
      reason: FIX_REASON,
      options: [
        choice("use", FIX_NAME, FIX_MEANING, true),
        choice(
          "leave",
          "지금은 정하지 않는다",
          "이 선택지는 뜻을 고정하지 않는다.",
          false,
        ),
      ],
      recommendation: { option_key: "use", explanation: FIX_REASON },
      expires_at: null,
    });
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      bodies.push(text);
      let reply: SemanticReply;
      try {
        if (found.phase === "ask") {
          reply = ask("toolu_fix_ask");
          found.phase = "first-hold";
        } else if (found.phase === "first-hold") {
          toolContent(text);
          found.phase = "idle";
          reply = said(FREE_REPLY);
        } else if (found.phase === "idle") {
          reply = ask("toolu_fix_again");
          found.phase = "second-hold";
        } else if (found.phase === "second-hold") {
          toolContent(text);
          found.phase = "done";
          reply = said(AGAIN_NOTE);
        } else if (found.phase === "done") {
          reply = said(APPLIED_NOTE);
        } else {
          throw new Error(`예상하지 않은 단계: ${found.phase}`);
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
    phase: () => found.phase,
    callsNamed: () => named,
    body: (index) => bodies[index] ?? "",
    calls: () => bodies.length,
  };
}

async function untilFix(
  provider: FixFixture,
  ready: () => boolean,
  what: string,
) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    assert(provider.failure() === "", provider.failure());
    if (ready()) return;
    assert(
      Date.now() < deadline,
      `${what}: phase ${provider.phase()} call ${provider.calls()} ${
        provider.body(provider.calls() - 1).slice(-500)
      }`,
    );
    await delay(250);
  }
}

async function untilFixDone(
  flow: FlowShell,
  provider: FixFixture,
  what: string,
) {
  try {
    await flow.until(
      `document.querySelector("${EMBEDDED} [data-work-status]")?.getAttribute("data-work-status") === "done"`,
      what,
      180_000,
    );
  } catch (error) {
    throw new Error(
      `${
        (error as Error).message
      } | failure=${provider.failure()} phase=${provider.phase()} calls=${provider.calls()} last=${
        provider.body(provider.calls() - 1).slice(-400)
      }`,
    );
  }
}

Deno.test({
  name:
    "documents/terms#R2 lophn-agent/questions#R13 lophn-agent/questions#R15 lophn-agent/questions#R6 flow define-terms 4: 고정한 context·이름·뜻 선택지를 확인 창 없이 사람의 결정으로 적용하고 자유 답은 정의로 쓰지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    await Deno.writeTextFile(
      `${folder}/${FIX_TITLE}.md`,
      `# ${FIX_TITLE}\n\n## 쓰임\n\n${FIX_NAME}라는 말이 그대로 있다.\n`,
    );
    const provider = startFixScript();
    let flow: FlowShell | undefined;
    try {
      flow = await openFlowShell({ start: "lophn" });
      const shell = flow;
      await registerAskProvider(shell, provider.url);
      await registerTrackedProject(shell, { folder });
      await untilDocuments(shell, [FIX_TITLE], "문서 관측 대기");
      const alpha = await documentTitled(shell, FIX_TITLE);
      await untilSectionStatus(
        shell,
        alpha.id,
        "whole",
        `${FIX_TITLE} 추출 대기`,
      );
      const preparedAt = Date.now() + READY_TIMEOUT_MS;
      let sectionKey = "";
      let version = alpha.latest_version;
      for (;;) {
        const current = await documentTitled(shell, FIX_TITLE);
        const outline = await mustCall(shell, {
          kind: "worker",
          resource: "outline",
          method: "document",
          body: {
            reference: {
              document: alpha.id,
              version: current.latest_version,
              section: null,
            },
          },
        });
        const section = (outline.entries as { key?: string; title?: string }[])
          .find((entry) => entry.title === "쓰임");
        if (
          outline.section_status === "whole" &&
          typeof section?.key === "string"
        ) {
          sectionKey = section.key;
          version = current.latest_version;
          break;
        }
        assert(
          Date.now() < preparedAt,
          `목차에 쓰임이 없다: ${
            JSON.stringify(outline.entries).slice(0, 300)
          }`,
        );
        await delay(250);
      }
      let start = 0;
      let end = 0;
      for (;;) {
        const read = await readFixed(shell, alpha.id, version, sectionKey);
        const body = String(read["text"] ?? "");
        const ranges = read["ranges"] as {
          start_line?: number;
          end_line?: number;
        }[];
        if (body.includes(FIX_NAME) && ranges.length > 0) {
          start = Math.min(...ranges.map((range) => range.start_line ?? 0));
          end = Math.max(...ranges.map((range) => range.end_line ?? 0));
          break;
        }
        assert(
          Date.now() < preparedAt,
          `고정 판 본문이 없다: ${body.slice(0, 160)}`,
        );
        await delay(250);
      }
      assert(start >= 1 && end >= start, `${start}-${end}`);
      await mustCall(shell, {
        kind: "command",
        resource: "contexts",
        method: "create",
        body: commandBody({
          id: FIX_CONTEXT,
          title: "Fixed meaning",
          purpose: FIX_PURPOSE,
          items: [{
            target: {
              kind: "document",
              document: alpha.id,
              section: null,
            },
            perspective: "basis",
            reason: "말의 본문 근거",
          }],
        }),
      });
      await mustCall(shell, {
        kind: "command",
        resource: "terms",
        method: "propose",
        body: commandBody({
          id: FIX_TERM,
          context: FIX_CONTEXT,
          name: FIX_NAME,
          evidence: [{
            document: alpha.id,
            version,
            section: sectionKey,
            start_line: start,
            end_line: end,
          }],
        }),
      });
      const sendAnswer = `${EMBEDDED} [data-send-answer]`;
      const picked = `${EMBEDDED} [data-option='use']`;
      const untilPrompt = async (id: string) => {
        const card =
          `${EMBEDDED} [data-request-id='${id}'] [data-question-text='ready']`;
        try {
          await shell.until(
            `document.querySelector(${JSON.stringify(card)})?.textContent === ${
              JSON.stringify(FIX_PROMPT)
            }`,
            "질문이 칸에 서지 않았다",
            120_000,
          );
        } catch (error) {
          throw new Error(
            `${
              (error as Error).message
            } | failure=${provider.failure()} phase=${provider.phase()}`,
          );
        }
      };
      const untilQuestion = async (index: number) => {
        const until = Date.now() + 60_000;
        while ((await questionsOf(shell))[index] === undefined) {
          assert(Date.now() < until, `질문 ${index}이 만들어지지 않았다`);
          await delay(250);
        }
      };
      const noWindow = async () => {
        assertEquals(await shell.count(`${EMBEDDED} [data-opens-review]`), 0);
        assertEquals(await shell.count(`${EMBEDDED} [data-review]`), 0);
        assertEquals(await shell.count("[data-confirmation]"), 0);
        // 확인 창이 열렸다면 desktop 창 말고 BrowserWindow가 하나 더 있다.
        const windows = await shell.shell.mainEvaluate(
          `(() => electron.BrowserWindow.getAllWindows().length)()`,
        );
        assertEquals(windows, 1);
      };

      await sendToEngineer(shell, FIX_TEXT);
      await untilFix(
        provider,
        () => provider.phase() === "first-hold",
        "첫 질문",
      );
      await untilQuestion(0);
      const first = (await questionsOf(shell))[0];
      assert(first !== undefined);
      assertEquals(first.status, "pending");
      assertEquals(first.applied, false);
      await untilPrompt(first.id);
      await noWindow();
      const use = first.options.find((option) => option.key === "use");
      const leave = first.options.find((option) => option.key === "leave");
      assert(use !== undefined && leave !== undefined);
      const action = use.action as {
        command: string;
        concern: string;
        targets: string[];
        input: {
          kind: string;
          value: { term: string; name: string; definition: string };
        };
        comparison: { base_revision: string };
      };
      assertEquals(action.command, "term.define");
      assertEquals(action.concern, "documents/terms");
      assertEquals(action.targets, [FIX_TERM]);
      assertEquals(action.input.kind, "inline");
      assertEquals(action.input.value, {
        term: FIX_TERM,
        name: FIX_NAME,
        definition: FIX_MEANING,
      });
      assert(action.comparison.base_revision.length > 0);
      assertEquals(leave.action, null);
      const term = await mustCall(shell, {
        kind: "read",
        resource: "terms",
        method: "get",
        body: { term: FIX_TERM },
      });
      assertEquals(
        (term.term as { context: string; definition: string | null }).context,
        FIX_CONTEXT,
      );
      assertEquals(await definitionOf(shell, FIX_TERM), null);
      // 고르기만으로는 답이 아니다. 보내야 사람의 결정으로 접수된다(questions#R4).
      await shell.click(picked);
      await shell.until(
        `document.querySelector(${
          JSON.stringify(picked)
        })?.getAttribute("aria-checked") === "true"`,
        "선택지가 골라지지 않았다",
      );
      await delay(1_000);
      assertEquals((await questionsOf(shell))[0]?.status, "pending");
      assertEquals((await questionsOf(shell))[0]?.answer, null);
      assertEquals(await definitionOf(shell, FIX_TERM), null);
      // 자유 답은 글 답 하나다. 글을 쓰면 고른 선택지는 지워지고 뜻으로 읽지 않는다.
      await shell.type(`${EMBEDDED} [data-own-answer]`, FREE_ANSWER);
      await shell.until(
        `(() => { const button = document.querySelector(${
          JSON.stringify(sendAnswer)
        }); return button !== null && button.disabled === false; })()`,
        "자유 답을 보낼 수 없다",
      );
      await shell.until(
        `document.querySelector(${
          JSON.stringify(picked)
        })?.getAttribute("aria-checked") === "false"`,
        "자유 답이 고른 선택지를 지우지 않았다",
      );
      await noWindow();
      await shell.click(sendAnswer);
      const freeAt = Date.now() + 60_000;
      for (;;) {
        const answered = (await questionsOf(shell))[0];
        if (answered?.status === "answered") {
          assertEquals(answered.answer?.kind, "text");
          assertEquals(answered.applied, false);
          break;
        }
        assert(Date.now() < freeAt, `자유 답이 접수되지 않았다`);
        await delay(250);
      }
      const freeText = await mustCall(shell, {
        kind: "read",
        resource: "questions",
        method: "text",
        body: { question: first.id },
      });
      assertEquals(freeText["answer_text"], FREE_ANSWER);
      assertEquals(await definitionOf(shell, FIX_TERM), null);
      await untilFixDone(shell, provider, "첫 질문이 끝나지 않았다");
      assertEquals(provider.callsNamed().includes("term.define"), false);

      await sendToEngineer(shell, FIX_AGAIN);
      await untilFix(
        provider,
        () => provider.phase() === "second-hold",
        "둘째 질문",
      );
      await untilQuestion(1);
      const second = (await questionsOf(shell))[1];
      assert(second !== undefined);
      assertEquals(second.status, "pending");
      assertEquals(second.applied, false);
      await untilPrompt(second.id);
      await noWindow();
      const againUse = second.options.find((option) => option.key === "use");
      assert(againUse !== undefined);
      assertEquals(
        (againUse.action as { command?: string } | null)?.command,
        "term.define",
      );
      await shell.click(picked);
      await shell.until(
        `document.querySelector(${
          JSON.stringify(picked)
        })?.getAttribute("aria-checked") === "true"`,
        "선택지가 골라지지 않았다",
      );
      await delay(1_000);
      assertEquals((await questionsOf(shell))[1]?.status, "pending");
      assertEquals(await definitionOf(shell, FIX_TERM), null);
      await noWindow();
      assertEquals(await shell.count(sendAnswer), 1);
      // term.define 선택지를 보내면 main이 정본을 다시 읽어 확인 창 없이
      // AnswerQuestionAction으로 접수한다. 고른 선택지가 그대로 사람의 결정이다.
      await shell.click(sendAnswer);
      const acceptedAt = Date.now() + 60_000;
      for (;;) {
        const answered = (await questionsOf(shell))[1];
        if (answered?.status === "answered") {
          assertEquals(answered.answer?.kind, "option");
          assertEquals(answered.answer?.option_key, "use");
          break;
        }
        assert(
          Date.now() < acceptedAt,
          `고른 선택지가 접수되지 않았다: ${
            JSON.stringify(answered ?? null)
          } failure=${provider.failure()} phase=${provider.phase()}`,
        );
        await delay(250);
      }
      await noWindow();
      // 접수된 결정은 질문을 기다리던 run을 해소기가 이어 machine이 고정 뜻을 적용한다.
      await t.step("접수된 고정 뜻이 정의로 적용된다", async () => {
        const appliedAt = Date.now() + 60_000;
        for (;;) {
          const answered = (await questionsOf(shell))[1];
          const meaning = await definitionOf(shell, FIX_TERM);
          if (answered?.applied === true && meaning === FIX_MEANING) break;
          assert(
            Date.now() < appliedAt,
            `고정 뜻이 적용되지 않았다: ${JSON.stringify(answered ?? null)} ${
              String(meaning)
            }`,
          );
          await delay(250);
        }
        await noWindow();
      });
      await untilFixDone(shell, provider, "둘째 질문이 끝나지 않았다");
      assertEquals(provider.callsNamed().includes("term.define"), false);
      assertEquals(
        provider.callsNamed().filter((name) => name === "question.submit")
          .length,
        2,
      );
      const kept = await mustCall(shell, {
        kind: "read",
        resource: "questions",
        method: "text",
        body: { question: first.id },
      });
      assertEquals(kept["answer_text"], FREE_ANSWER);
    } finally {
      await flow?.close();
      await provider.close();
      if (flow !== undefined) await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// 5: 사람의 정의는 결정 주체·이전/이후 내용이 있는 변경 기록으로 남고, 이후 agent가
// 읽는 목록에서도 사람 정의와 미정 후보가 섞이지 않는다. 4의 machine 적용(followups
// 49·55)은 볼 수 없어, 같은 term.define 명령을 사람 직접 정의 경로로 불러 본다.
const LOG_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fbc";
const LOG_DEFINED = "trm_01arz3ndektsv4rrffq69g5fbc";
const LOG_OPEN = "trm_01arz3ndektsv4rrffq69g5fbd";
const LOG_TITLE = "기록알파";
const LOG_SECTION = "쓰임";
const LOG_PURPOSE = "변경 기록과 목록을 가르는 자료";
const LOG_NAME = "정산주기";
const LOG_OPEN_NAME = "임시표";
const LOG_FIRST = "한 달이 끝나는 날 맞추는 계산";
const LOG_SECOND = "분기가 끝나는 날 맞추는 계산";
const LOG_READ_TEXT = "이 context의 용어 목록을 읽어 달라.";
const LOG_READ_DONE = "용어 목록을 읽었다.";

type FixedEvidence = {
  document: string;
  version: string;
  section: string;
  start_line: number;
  end_line: number;
};

// 목차에서 section을 찾아 그 고정 판 본문이 읽힐 때의 section·줄 범위를 근거로 준다.
async function fixedEvidence(
  flow: FlowShell,
  document: string,
  title: string,
  section: string,
  word: string,
): Promise<FixedEvidence> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const current = await documentTitled(flow, title);
    const outline = await mustCall(flow, {
      kind: "worker",
      resource: "outline",
      method: "document",
      body: {
        reference: {
          document,
          version: current.latest_version,
          section: null,
        },
      },
    });
    const found = (outline.entries as { key?: string; title?: string }[])
      .find((entry) => entry.title === section);
    if (outline.section_status === "whole" && typeof found?.key === "string") {
      const read = await readFixed(
        flow,
        document,
        current.latest_version,
        found.key,
      );
      const ranges = read["ranges"] as {
        start_line?: number;
        end_line?: number;
      }[];
      if (String(read["text"] ?? "").includes(word) && ranges.length > 0) {
        return {
          document,
          version: current.latest_version,
          section: found.key,
          start_line: Math.min(...ranges.map((range) => range.start_line ?? 0)),
          end_line: Math.max(...ranges.map((range) => range.end_line ?? 0)),
        };
      }
    }
    assert(Date.now() < deadline, `고정 판 근거가 없다: ${title}`);
    await delay(250);
  }
}

type LoggedEvent = {
  seq: string;
  type: string;
  subject: string | null;
  actor: string;
  run: string | null;
  payload: Record<string, unknown>;
};

// term event는 사람 화면에도 events read에도 공개하지 않는다(공개 정책이 없는 event는
// 숨김이다). 변경 기록은 ledger의 events 행을 읽기 전용으로 열어 본다.
function termEvents(home: string, subjects: string[]): LoggedEvent[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    const rows = db.prepare(
      `SELECT seq, type, subject, actor, run, payload FROM events
       WHERE subject IN (${subjects.map(() => "?").join(", ")}) ORDER BY seq`,
    ).all(...subjects) as {
      seq: number | bigint;
      type: string;
      subject: string | null;
      actor: string;
      run: string | null;
      payload: string;
    }[];
    return rows.map((row) => ({
      seq: String(row.seq),
      type: row.type,
      subject: row.subject,
      actor: row.actor,
      run: row.run,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
  } finally {
    db.close();
  }
}

type LogFixture = {
  url: string;
  close: () => Promise<void>;
  failure: () => string;
  calls: () => number;
  body: (index: number) => string;
  read: () => Record<string, unknown> | null;
};

function startLogScript(): LogFixture {
  const bodies: string[] = [];
  const found = {
    phase: "ask" as "ask" | "seen" | "done",
    failure: "",
    read: null as Record<string, unknown> | null,
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
      let reply: SemanticReply;
      try {
        if (found.phase === "ask") {
          found.phase = "seen";
          reply = toolCall("toolu_log_terms", "context.terms", {
            context: LOG_CONTEXT,
          });
        } else if (found.phase === "seen") {
          found.read = toolContent(text);
          found.phase = "done";
          reply = said(LOG_READ_DONE);
        } else {
          reply = said(LOG_READ_DONE);
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
    calls: () => bodies.length,
    body: (index) => bodies[index] ?? "",
    read: () => found.read,
  };
}

Deno.test({
  name:
    "documents/terms#R1 documents/terms#R2 documents/terms#R4 platform/ledger#R3 platform/ledger#R10 flow define-terms 5: 사람 정의를 결정 주체와 이전·이후 내용의 변경 기록으로 남기고 agent가 읽는 목록에서 정의와 미정 후보를 구별한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    await Deno.writeTextFile(
      `${folder}/${LOG_TITLE}.md`,
      `# ${LOG_TITLE}\n\n## ${LOG_SECTION}\n\n${LOG_NAME}라는 말과 ${LOG_OPEN_NAME}라는 말이 그대로 있다.\n`,
    );
    const provider = startLogScript();
    let flow: FlowShell | undefined;
    try {
      flow = await openFlowShell({ start: "lophn" });
      const shell = flow;
      await registerAskProvider(shell, provider.url);
      await registerTrackedProject(shell, { folder });
      await untilDocuments(shell, [LOG_TITLE], "문서 관측 대기");
      const glossary = await documentTitled(shell, LOG_TITLE);
      await untilSectionStatus(
        shell,
        glossary.id,
        "whole",
        `${LOG_TITLE} 추출 대기`,
      );
      const evidence = await fixedEvidence(
        shell,
        glossary.id,
        LOG_TITLE,
        LOG_SECTION,
        LOG_NAME,
      );
      await mustCall(shell, {
        kind: "command",
        resource: "contexts",
        method: "create",
        body: commandBody({
          id: LOG_CONTEXT,
          title: "Change log",
          purpose: LOG_PURPOSE,
          items: [{
            target: {
              kind: "document",
              document: glossary.id,
              section: null,
            },
            perspective: "basis",
            reason: "말의 본문 근거",
          }],
        }),
      });
      await mustCall(shell, {
        kind: "command",
        resource: "terms",
        method: "propose",
        body: commandBody({
          id: LOG_OPEN,
          context: LOG_CONTEXT,
          name: LOG_OPEN_NAME,
          evidence: [evidence],
        }),
      });
      await mustCall(shell, {
        kind: "command",
        resource: "terms",
        method: "propose",
        body: commandBody({
          id: LOG_DEFINED,
          context: LOG_CONTEXT,
          name: LOG_NAME,
          evidence: [evidence],
        }),
      });
      // 사람이 직접 정의한다(4의 선택지 접수와 같은 term.define이다).
      const candidate = await mustCall(shell, {
        kind: "read",
        resource: "terms",
        method: "get",
        body: { term: LOG_DEFINED },
      });
      await mustCall(shell, {
        kind: "command",
        resource: "terms",
        method: "define",
        body: commandBody(
          { term: LOG_DEFINED, name: LOG_NAME, definition: LOG_FIRST },
          { base_revision: (candidate.term as { revision: string }).revision },
        ),
      });

      await t.step(
        "platform/ledger#R3 documents/terms#R2: 정의는 사람 주체와 이전·이후 내용이 있는 변경 기록으로 남고 후보는 정의 기록이 없다",
        () => {
          const events = termEvents(shell.home, [LOG_DEFINED, LOG_OPEN]);
          const defined = events.filter((event) =>
            event.type === "TermDefined"
          );
          assertEquals(defined.length, 1);
          assertEquals(defined[0].subject, LOG_DEFINED);
          assertEquals(defined[0].actor, "user");
          assertEquals(defined[0].payload["context"], LOG_CONTEXT);
          assertEquals(defined[0].payload["name"], LOG_NAME);
          assertEquals(defined[0].payload["before_definition"], null);
          assertEquals(defined[0].payload["definition"], LOG_FIRST);
          assert(typeof defined[0].payload["before_revision"] === "string");
          // 정의가 아닌 후보에는 정의 기록이 없다.
          assertEquals(
            events.some((event) =>
              event.subject === LOG_OPEN && event.type !== "TermProposed"
            ),
            false,
          );
          assertEquals(
            events.filter((event) =>
              event.subject === LOG_OPEN && event.type === "TermProposed"
            ).length,
            1,
          );
        },
      );

      await t.step(
        "platform/ledger#R10: 사람이 뜻을 고치면 먼저 기록은 그대로 두고 이전·이후 내용의 새 기록이 더해진다",
        async () => {
          const before = termEvents(shell.home, [LOG_DEFINED]);
          const first = before.find((event) => event.type === "TermDefined");
          assert(first !== undefined);
          const current = await mustCall(shell, {
            kind: "read",
            resource: "terms",
            method: "get",
            body: { term: LOG_DEFINED },
          });
          await mustCall(shell, {
            kind: "command",
            resource: "terms",
            method: "update",
            body: commandBody(
              { term: LOG_DEFINED, definition: LOG_SECOND },
              {
                base_revision: (current.term as { revision: string }).revision,
              },
            ),
          });
          const after = termEvents(shell.home, [LOG_DEFINED]);
          // 먼저 기록은 seq·주체·내용 그대로이고 뒤에 새 기록만 붙는다.
          assertEquals(after.slice(0, before.length), before);
          assertEquals(after.length, before.length + 1);
          const updated = after.at(-1);
          assertEquals(updated?.type, "TermUpdated");
          assertEquals(updated?.actor, "user");
          assert(BigInt(updated!.seq) > BigInt(first.seq));
          const payload = updated!.payload as {
            before: { definition?: string };
            after: { definition?: string };
          };
          assertEquals(payload.before.definition, LOG_FIRST);
          assertEquals(payload.after.definition, LOG_SECOND);
          const defined = after.filter((event) => event.type === "TermDefined");
          assertEquals(defined.length, 1);
          assertEquals(defined[0].payload["definition"], LOG_FIRST);
        },
      );

      await t.step(
        "documents/terms#R1 documents/terms#R4: 이후 agent가 읽는 목록에서 사람 정의와 미정 후보가 갈라져 있다",
        async () => {
          await sendToEngineer(shell, LOG_READ_TEXT);
          const deadline = Date.now() + 180_000;
          while (provider.read() === null) {
            assert(provider.failure() === "", provider.failure());
            assert(
              Date.now() < deadline,
              `목록을 읽지 못했다: calls ${provider.calls()} ${
                provider.body(provider.calls() - 1).slice(-400)
              }`,
            );
            await delay(250);
          }
          const read = provider.read()!;
          const definitions = read["definitions"] as TermSeen[];
          const candidates = read["candidates"] as TermSeen[];
          assertEquals(definitions.map((term) => term.name), [LOG_NAME]);
          assertEquals(definitions[0].definition, LOG_SECOND);
          assertEquals(candidates.map((term) => term.name), [LOG_OPEN_NAME]);
          assertEquals(candidates[0].definition, null);
          assertEquals((candidates[0].evidence ?? []).length, 1);
          await shell.until(
            `document.querySelector("${EMBEDDED} [data-work-status]")?.getAttribute("data-work-status") === "done"`,
            "목록 읽기가 끝나지 않았다",
            180_000,
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
