// 세 질문
// - contract: boundary `contexts`(제출한 초안은 격리 test를 통과해야만 적용되고 검색은 적용된 판으로 한다),
//   `agent-roles`·`agent-tool-spi`(PM만 초안을 열고 쓴다), `supervision`(context worker child).
// - 현실적 회귀: 초안 폴더 규칙(turn scope, rewind 폴더 목록, runtime Deno 권한)이 어긋나 같은 turn에 쓰기가
//   forbidden이 되는 것(두 번 고친 일), 틀린 계약이 test를 건너 적용되는 것, 적용됐는데 검색이 worker를 못 지나는 것.
// - 왜 지금 test가 못 잡나: 지금 PM으로 도는 E2E는 file 쓰기뿐이다. 초안 폴더는 data root 아래라 runtime의
//   `<dataRoot>/projects` 쓰기 허락, file scope의 openDraft 확장, context worker가 한꺼번에 맞아야 하고
//   이 id들은 정적 대답으로는 줄 수 없다.
//
// 두 번째 행 묶음(violation-calls-pm)의 세 질문
// - contract: boundary `contexts`(문서가 계약을 어기면 위반이 기록되고 새 위반만 event가 된다),
//   `events`·`router`(새 일 event는 그 project의 PM을 새 session으로 부른다).
// - 현실적 회귀: 사람이 문서를 고쳐도 감시가 못 봐 위반이 기록되지 않는 것, 위반이 기록됐는데 event가
//   안 나가 PM이 모르는 것, 다른 project의 PM이 불리는 것.
// - 왜 지금 test가 못 잡나: 위반 key 판정은 unit이 보지만 disk 변경, context worker child의 감시·계산,
//   core의 command, Reactor, Router, agent runtime child의 turn은 process 셋을 건너야 이어진다.
import { assert, assertEquals } from "@std/assert";
import {
  agentSessionList,
  receivedMessageList,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  contextBundlesRoute,
  contextGetRoute,
  contextSearchRoute,
  contextViolationsRoute,
} from "../../packages/protocol/projects/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import type {
  FakeServer,
  JournalEntry,
  Reply,
} from "../support/fake-server/mod.ts";
import { lastToolResult, lastUserText } from "../support/fake-server/probe.ts";

// 폴더가 이미 가진 layout은 `bundle.json` 한 파일(계약, 검색, 예)이다.
const bundle = (expectKeys: string[]) => ({
  schema: 1,
  contract: {
    types: [{
      name: "Note",
      summary: "A note",
      visibility: "private",
      source: { kind: "docs", paths: ["notes/*.md"] },
      key: "slug",
      fields: [{
        name: "slug",
        from: { kind: "frontmatter", key: "slug" },
        value_type: "string",
        required: true,
        visibility: "private",
      }],
      relations: [],
      // 문서에서 slug를 지우면 위반이 된다.
      rules: [{
        id: "slug-present",
        kind: "required_field",
        params: { field: "slug" },
        message: "A note needs a slug",
      }],
    }],
  },
  searches: [{
    name: "notes",
    title: "Notes",
    inputs: [],
    query: { from: "Note", where: null, follow: [], sort: [], group: null },
    result: {
      kind: "table",
      columns: [{ label: "Slug", path: "slug" }],
      page_size: 30,
    },
  }],
  saved_views: [],
  examples: [
    { kind: "search", search: "notes", inputs: {}, expect_keys: expectKeys },
  ],
});

type Row = {
  name: string;
  content: unknown;
  // 적용되면 true. 격리 test를 못 넘으면 false.
  applies: boolean;
};

const ROWS: Row[] = [
  {
    name: "submit-and-search",
    content: bundle(["alpha", "beta"]),
    applies: true,
  },
  // 예가 기대하는 문서가 project에 없다(example_mismatch).
  { name: "bad-draft-kept-out", content: bundle(["ghost"]), applies: false },
];

async function poll<T>(
  what: string,
  read: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${what}이(가) 되지 않았다`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// context_draft의 tool 결과(JSON 글)에서 id와 폴더를 뽑는다. 결과가 아니면 모두 undefined다.
function draftOf(result: string) {
  let content: { context?: string; draft?: string; folder?: string } = {};
  try {
    content = JSON.parse(result).content ?? {};
  } catch {
    // 글이 JSON이 아니면 빈 채로 둔다.
  }
  return {
    context: content.context,
    draft: content.draft,
    folder: content.folder,
  };
}

// 앞 tool 결과가 없으면 text로 답해 turn이 끝나게 한다.
const afterDraft = (content: unknown) => (request: JournalEntry): Reply => {
  const result = lastToolResult(request) ?? "";
  const { context, draft, folder } = draftOf(result);
  if (context === undefined || draft === undefined || folder === undefined) {
    return { kind: "text", text: `no draft: ${result}` };
  }
  const target = JSON.stringify({ context, draft });
  return {
    kind: "tool",
    calls: [
      {
        id: "t_write",
        name: "file_write",
        arguments: JSON.stringify({
          path: `${folder}/bundle.json`,
          content: JSON.stringify(content),
        }),
      },
      { id: "t_test", name: "context_test", arguments: target },
      { id: "t_submit", name: "context_submit", arguments: target },
    ],
  };
};

async function runRow(
  core: Core,
  fake: FakeServer,
  project: string,
  row: Row,
) {
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{
          id: "t_draft",
          name: "context_draft",
          arguments: JSON.stringify({ name: row.name, purpose: "Keep notes" }),
        }],
      },
    },
    { reply: afterDraft(row.content) },
    { reply: { kind: "text", text: "done" } },
  ]);
  const session = await openSession(core, { role: "project_manager", project });
  await say(core, session, "make the notes context");
  const turn = await waitTurnEnd(core, session);
  const journal = fake.journal();
  assertEquals(journal.length, 3);
  const { context, draft, folder } = draftOf(lastToolResult(journal[1]!) ?? "");
  assert(context && draft && folder, "context_draft가 id와 폴더를 주지 않았다");
  const { tool_calls: calls } = await core.call(toolCallList, {
    turn: turn.id,
  });
  return { journal, context, draft, folder, calls };
}

// 앞 행이 적용한 context의 문서가 계약을 어기면 그 project의 PM이 program 메시지로 새 session에서 불린다.
async function violationCallsPm(
  core: Core,
  fake: FakeServer,
  project: string,
  proj: string,
  context: string,
) {
  const pm = { role: "project_manager", project } as const;
  const before =
    (await core.call(agentSessionList, { agent: pm })).sessions.length;
  fake.reset();
  fake.script([{ reply: { kind: "text", text: "noted" } }]);
  await Deno.writeTextFile(`${proj}/notes/alpha.md`, `# alpha\n`);

  // route: 위반이 고친 문서를 가리킨다.
  const violations = await until("위반이 기록됨", async () => {
    const read = await core.call(contextViolationsRoute, { context });
    return read.violations.length > 0 ? read.violations : undefined;
  });
  assertEquals(violations.map((v) => [v.kind, v.rule, v.path]), [
    ["rule", "Note.slug-present", "notes/alpha.md"],
  ]);

  // ledger: program 메시지로 열린 PM session이 정확히 하나 늘었다.
  const sessions = await until("PM session이 열림", async () => {
    const read = await core.call(agentSessionList, { agent: pm });
    return read.sessions.length > before ? read.sessions : undefined;
  });
  assertEquals(sessions.length, before + 1);
  const opened = await until("program 메시지가 옴", async () => {
    for (const { id } of sessions) {
      const { messages } = await core.call(receivedMessageList, {
        session: id,
      });
      if (messages.some((m) => m.from.kind === "program")) return id;
    }
  });
  await waitTurnEnd(core, opened);

  // fake: 그 turn이 받은 글에 context id가 있다.
  const journal = fake.journal();
  assertEquals(journal.length, 1);
  assert(
    lastUserText(journal[0]!).includes(context),
    lastUserText(journal[0]!),
  );
}

async function assertGone(path: string): Promise<void> {
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error(`${path}가 남아 있다`);
}

Deno.test("E2E PM이 제출한 초안은 격리 test를 통과할 때만 적용되고 적용된 context는 검색된다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const proj = `${run.work}/proj`;
    await Deno.mkdir(`${proj}/notes`, { recursive: true });
    for (const slug of ["alpha", "beta"]) {
      await Deno.writeTextFile(
        `${proj}/notes/${slug}.md`,
        `---\nslug: ${slug}\n---\n# ${slug}\n`,
      );
    }
    const { project } = await openProject(core, proj);

    let appliedContext: string | undefined;
    for (const row of ROWS) {
      const got = await runRow(core, fake, project, row);
      const outcomes = Object.fromEntries(
        got.calls.map((c) => [c.response_key, c.outcome?.kind]),
      );
      // disk: 초안 폴더는 data root 안이고 제출로 사라졌다.
      assert(got.folder.startsWith(run.home), got.folder);
      await assertGone(got.folder);
      if (row.applies) {
        // ledger: 적용된 판이 제출한 초안이고 PM의 write·test·submit이 모두 성공했다.
        const applied = await poll("판이 적용됨", async () => {
          const read = await core!.call(contextGetRoute, {
            context: got.context,
          });
          return read.applied ?? undefined;
        });
        assertEquals(applied.id, got.draft);
        appliedContext = got.context;
        assertEquals(outcomes, {
          t_draft: "success",
          t_write: "success",
          t_test: "success",
          t_submit: "success",
        });
        // route: 검색이 context worker를 지나 test가 둔 문서의 key를 돌려준다.
        const rows = await poll("문서가 index됨", async () => {
          const found = await core!.tryCall(contextSearchRoute, {
            context: got.context,
            search: "notes",
            inputs: {},
          });
          return found.ok && found.value.total > 0
            ? found.value.rows
            : undefined;
        });
        assertEquals(rows.map((r) => r.ref.key).sort(), ["alpha", "beta"]);
      } else {
        // fake: PM이 받은 test 결과가 통과가 아니다.
        const seen = lastToolResult(got.journal[2]!, "t_test") ?? "";
        assert(seen.includes("failed"), seen);
        // ledger: 판은 failed로 끝나고 applied는 없다.
        const failed = await poll("검사가 끝남", async () => {
          const read = await core!.call(contextBundlesRoute, {
            context: got.context,
          });
          const item = read.bundles.find((b) => b.bundle.id === got.draft);
          return item?.bundle.status === "failed" ? item : undefined;
        });
        assertEquals(failed.check?.findings[0]?.kind, "example_mismatch");
        assertEquals(
          (await core.call(contextGetRoute, { context: got.context })).applied,
          null,
        );
        // route: 적용된 판이 없으니 검색은 거절한다.
        const found = await core.tryCall(contextSearchRoute, {
          context: got.context,
          search: "notes",
          inputs: {},
        });
        assert(!found.ok);
        assertEquals(found.error.code, "not_found");
      }
    }
    assert(appliedContext, "적용된 context가 없다");
    await violationCallsPm(core, fake, project, proj, appliedContext);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
