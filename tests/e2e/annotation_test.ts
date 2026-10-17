// 세 질문
// - contract: boundary `apps`(annotation 저장은 앱 하나 범위이고 신원은 shell main이 정한 값으로 들어온다),
//   `router`(전달은 그 앱 App Engineer에게 사람 메시지 하나다), `agent-tools`(`image_read`가 `annotation:<id>`를 core가
//   agent 자격의 앱으로 거른 screenshot으로 연다), `core-api`.
// - 현실적 회귀: 다른 앱의 annotation(앱 화면 속 정보, screenshot)을 다른 앱의 App Engineer가 읽는 것, 보내기가 다른 앱의
//   session으로 가는 것, 저장한 screenshot이 model에 실리지 않는 것(blob 경로·권한).
// - 왜 지금 test가 못 잡나: `annotations_test.ts`는 저장과 읽기를 따로 보고, upload → blob → Router → App Engineer turn →
//   runtime의 `image_read` → model 요청까지 이어지는 길은 process를 건너야 한다.
//
// `archived-app` 행: boundary `apps`·`router`(보관한 앱은 새 입력을 받지 않는다), 회귀는 보관한 앱의 App Engineer에게
// 새 session이 열리거나 저장이 거절됐는데 메시지가 먼저 가는 것, `annotations_test.ts`는 저장 command의 거절만 보고
// 보내기 → 저장 → 전달에서 전달이 일어나지 않음(session이 열리지 않음)은 Router 쪽 상태까지 읽어야 보인다.
//
// core는 file 전체에서 하나다. 앱 A, B를 만들고 행은 table 순서로 돈다. `other-app`은 `new-session`이 만든
// A의 annotation id를 쓴다(행 순서에 기댄다). shell main 역할은 test가 route를 직접 불러 맡는다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../packages/base/mod.ts";
import {
  type AnnotationInput,
  annotationSend,
  annotationsGet,
} from "../../packages/protocol/apps/annotation.ts";
import { appArchive, appCreate } from "../../packages/protocol/apps/mod.ts";
import {
  agentSessionList,
  agentSessionRead,
  receivedMessageList,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { uploadScreenshot } from "../support/annotation/upload.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import type { FakeServer, JournalEntry } from "../support/fake-server/mod.ts";
import { idIn, lastUserText } from "../support/fake-server/probe.ts";

// 유효한 1x1 PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);
const PNG_BASE64 = btoa(String.fromCharCode(...PNG));

type Ctx = {
  core: Core;
  fake: FakeServer;
  a: string;
  b: string;
  // new-session이 보낸 A의 annotation. other-app이 쓴다.
  annotationOfA?: string;
};

const annotationOf = (
  release: string,
  screenshot: AnnotationInput["screenshot"],
): AnnotationInput => ({
  n: 1,
  kind: "element",
  note: "NOTE-MARK",
  screenshot,
  component: "List > Card > Button",
  element: { role: "button", name: "Save", text: "Save" },
  rect: {
    x_ratio: 0.1,
    width_ratio: 0.2,
    y_px: 40,
    height_px: 30,
    scroll_x: 0,
    scroll_y: 0,
  },
  view: { screen: "home", path: "/" },
  release: release as AnnotationInput["release"],
});

async function ship(
  ctx: Ctx,
  app: string,
  session: string | null,
  withScreenshot: boolean,
  release = ctx.core.ids.newId("rel"),
) {
  const screenshot = withScreenshot
    ? await uploadScreenshot(ctx.core, PNG)
    : null;
  const sent = await ctx.core.call(annotationSend, {
    app: app as never,
    session: session as never,
    annotations: [annotationOf(release, screenshot)],
  });
  return { sent, release };
}

const callImage = (annotation: string) => ({
  kind: "tool" as const,
  calls: [{
    id: "t_image",
    name: "image_read",
    arguments: JSON.stringify({ path: `annotation:${annotation}` }),
  }],
});

// 둘째 model 요청의 마지막 user message에서 tool_result 안 image block을 모은다.
function imagesIn(request: JournalEntry): { data: string }[] {
  const body = request.body as {
    messages: { role: string; content: unknown }[];
  };
  const content = body.messages.findLast((m) => m.role === "user")?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: { type: string; content?: unknown }) =>
    block.type === "tool_result" && Array.isArray(block.content)
      ? block.content.filter((part) => part.type === "image").map((part) =>
        part.source as { data: string }
      )
      : []
  );
}

// 받은 메시지에는 session 자신의 답도 들어 있어 사람 메시지만 고른다.
async function humanMessagesOf(core: Core, session: string) {
  const { messages } = await core.call(receivedMessageList, { session });
  return messages.filter((message) => message.from.kind === "human");
}

type Row = { name: string; run(ctx: Ctx): Promise<void> };

const ROWS: Row[] = [
  {
    name: "new-session",
    async run(ctx) {
      const { core, fake, a } = ctx;
      fake.reset();
      fake.script([
        {
          reply: (request) => {
            const id = idIn(lastUserText(request), "ann");
            return id === undefined
              ? { kind: "text", text: "no annotation id" }
              : callImage(id);
          },
        },
        { reply: { kind: "text", text: "seen" } },
      ]);
      const { sent, release } = await ship(ctx, a, null, true);
      const annotation = sent.annotations[0];
      ctx.annotationOfA = annotation;
      await waitTurnEnd(core, sent.session, 0);

      // inbox
      const { session } = await core.call(agentSessionRead, {
        session: sent.session,
      });
      assertEquals(session.agent, { role: "app_engineer", app: a });
      const messages = await humanMessagesOf(core, sent.session);
      assertEquals(messages.length, 1);
      assertEquals(messages[0].refs, [{ kind: "annotation", id: annotation }]);

      // fake
      const images = imagesIn(fake.journal()[1]);
      assertEquals(images.length, 1);
      assertEquals(images[0].data, PNG_BASE64);

      // ledger
      const { annotations } = await core.call(annotationsGet, {
        batch: sent.batch,
      });
      assertEquals(annotations.length, 1);
      assertEquals(annotations[0].app, a);
      assertEquals(annotations[0].release, release);
      assertEquals(annotations[0].view.screen, "home");
      assertEquals(annotations[0].screenshot?.hash, await sha256Hex(PNG));
    },
  },
  {
    name: "open-session",
    async run(ctx) {
      const { core, fake, a } = ctx;
      fake.reset();
      const session = await openSession(core, { role: "app_engineer", app: a });
      fake.script([{ reply: { kind: "text", text: "noted" } }]);
      const { sent } = await ship(ctx, a, session, false);
      const turn = await waitTurnEnd(core, session, 0);

      // route
      assertEquals(sent.session, session);

      // inbox
      const messages = await humanMessagesOf(core, session);
      assertEquals(messages.length, 1);
      assertEquals(messages[0].refs, [{
        kind: "annotation",
        id: sent.annotations[0],
      }]);
      assertEquals(messages[0].turn, turn.id);

      // fake
      assert(lastUserText(fake.journal()[0]).includes("NOTE-MARK"));
    },
  },
  {
    name: "other-app",
    async run(ctx) {
      const { core, fake, a, b, annotationOfA } = ctx;
      assert(annotationOfA, "new-session 행이 먼저 돌아야 한다");
      fake.reset();
      const session = await openSession(core, { role: "app_engineer", app: b });
      fake.script([
        { reply: callImage(annotationOfA) },
        { reply: { kind: "text", text: "cannot" } },
      ]);
      await say(core, session, "read it");
      const turn = await waitTurnEnd(core, session, 0);

      // ledger
      const { tool_calls } = await core.call(toolCallList, { turn: turn.id });
      assertEquals(
        tool_calls.find((call) => call.response_key === "t_image")?.outcome,
        { kind: "failure", code: "not_found" },
      );

      // fake
      assertEquals(imagesIn(fake.journal()[1]).length, 0);

      // route
      const refused = await core.tryCall(annotationSend, {
        app: a as never,
        session: session as never,
        annotations: [annotationOf(core.ids.newId("rel"), null)],
      });
      assert(!refused.ok);
      assertEquals(refused.error.code, "conflict");
    },
  },
  {
    // 앱 C를 이 행에서 만들어 보관한다. 보관한 앱은 새 입력을 받지 않는다.
    name: "archived-app",
    async run(ctx) {
      const { core } = ctx;
      const created = await core.call(appCreate, {
        slug: "annotation-c",
        name: "annotation-c",
        description: "app annotation-c",
      }, {});
      const c = created.id;
      await core.call(appArchive, { app: c }, {
        base_revision: created.revision,
      });
      const refused = await core.tryCall(annotationSend, {
        app: c,
        session: null,
        annotations: [annotationOf(core.ids.newId("rel"), null)],
      });

      // route
      assert(!refused.ok);
      assertEquals(refused.error.code, "conflict");

      // inbox
      const { sessions } = await core.call(agentSessionList, {
        agent: { role: "app_engineer", app: c },
        archived: "include",
      });
      assertEquals(sessions.length, 0);
    },
  },
];

Deno.test("annotation 묶음은 그 앱 App Engineer에게만 가고 screenshot은 그 앱 App Engineer만 model에 싣는다", async (t) => {
  const run = await createRun();
  let fake: FakeServer | undefined;
  let core: Core | undefined;
  try {
    fake = await startFakeServer();
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const app = (slug: string) =>
      core!.call(appCreate, {
        slug,
        name: slug,
        description: `app ${slug}`,
      }, {});
    const ctx: Ctx = {
      core,
      fake,
      a: (await app("annotation-a")).id,
      b: (await app("annotation-b")).id,
    };
    for (const row of ROWS) {
      await t.step(row.name, () => row.run(ctx));
    }
  } finally {
    await core?.kill();
    await fake?.close();
    await run.remove();
  }
});
