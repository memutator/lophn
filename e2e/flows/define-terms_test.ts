// flow define-terms: 실제 headless shell·core·documents worker를 임시 LOPHN_HOME으로 연다.
// 1의 context 선택과 3·6의 사람 직접 정의 화면, 미루기·전제 변경·같은 이름·보관 갈래를 본다.
// 그 테스트의 후보는 사람 command의 고정 본문 근거로 준비한다. 2는 다음 테스트가 본다.
// 4~5의 term.define question option adapter는 여기서 부르지 않는다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

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
