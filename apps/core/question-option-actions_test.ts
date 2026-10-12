// lophn-agent#T29 끝에서 끝까지: 사람이 고른 문서 자리 이동 선택지가 실제 core·documents 위에서
// 한 번만 적용되는지 본다(실제 core, documents worker, I/O worker. 데이터 root는 temp dir이고 사람
// 데이터 root는 열지 않는다). model provider는 부르지 않는다. 설정 변경 선택지와 답 저장 → 적용 →
// 재개의 중단 지점은 waiting-and-recovery_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { answerQuestionAction } from "../../packages/protocol/lophn-agent/mod.ts";
import { moveOptionAction } from "../../packages/core/lophn-agent/tools/questions/mod.ts";
import { call, command, count, inspect } from "./testing/approvals-fixture.ts";
import {
  acceptCredential,
  context,
  issueConfirmation,
  MACHINE_TOKEN,
  openWaitingWorld,
  type Seat,
  USER_TOKEN,
  type WaitingWorld,
} from "./testing/waiting-world.ts";
import { id } from "./testing/tool-judgment-world.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const SEED_TOKEN = "s".repeat(43);
const SCOPED_TOKEN = "z".repeat(43);
const ABSENT_DOCUMENT = id("doc", 90);
const PROJECT = id("prj", 1);
const OTHER_PROJECT = id("prj", 2);

const MOVED = "select count(*) as n from events where type = 'DocumentMoved'";
const EVIDENCE = "select count(*) as n from question_evidence";

type World = WaitingWorld & {
  work: string;
  seed(
    slug: string,
    text: string,
  ): Promise<{ document: string; version: string }>;
  async_dispose(): Promise<void>;
};

async function open(): Promise<World> {
  const world = await openWaitingWorld();
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-option-actions-work-" }),
  );
  await acceptCredential(
    world.core,
    context(
      `coding_agent:${CAC}`,
      [
        "document.upload",
        "document.prepare",
        "document.save",
        "document.list",
        "document.get",
      ],
      {},
      "seed",
    ),
    SEED_TOKEN,
  );
  for (
    const [project, name] of [[PROJECT, "alpha"], [OTHER_PROJECT, "beta"]]
  ) {
    const created = await call(
      world.server,
      "projects/create",
      USER_TOKEN,
      command({
        id: project,
        name,
        title: name,
        purpose: "",
        folders: [{ path: `${work}/${name}-folder`, description: "" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
  }
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${world.core.port}`,
    connection: CAC,
    provider: () => Promise.resolve({ ok: true, value: { token: SEED_TOKEN } }),
  });
  const deps = {
    client,
    scope: { root: work, forbidden: [world.core.dataRoot] },
    prepareBytes: uploadPrepareBytes(client),
  };
  let n = 0;
  return Object.assign(world, {
    work,
    async seed(slug: string, text: string) {
      n += 1;
      const path = `seed-${n}.md`;
      await Deno.writeTextFile(`${work}/${path}`, text);
      const saved = await saveFromPaths(deps, {
        paths: [path],
        place: { kind: "project" as const, id: PROJECT },
        slug,
        title: slug,
      });
      assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
      return {
        document: saved.value.saved.document,
        version: saved.value.saved.version,
      };
    },
    async async_dispose() {
      await world.dispose();
      await Deno.remove(work, { recursive: true });
    },
  });
}

function revisionOf(world: World, document: string): string {
  return String(
    inspect(world.server, "select revision from documents where id = ?", [
      document,
    ])[0]!["revision"],
  );
}

function placeOf(world: World, document: string) {
  const row = inspect(
    world.server,
    "select place_id, name from documents where id = ?",
    [document],
  )[0]!;
  return { place: row["place_id"], name: row["name"] };
}

let counter = 0;

// 문서 이동 선택지를 만들어 질문을 하고 사람이 그 선택지를 고른다. 적용은 하지 않는다.
async function askMove(
  world: World,
  document: string,
  over: { base_revision?: string; target?: string; seat?: Seat } = {},
) {
  counter += 1;
  const group = id("qgr", 100 + counter);
  const question = id("qst", 100 + counter);
  const action = moveOptionAction({
    document: over.target ?? document,
    place: { kind: "project", id: OTHER_PROJECT },
    name: "moved",
    base_revision: over.base_revision ?? revisionOf(world, document),
  });
  const run = (over.seat ?? world.lophn).run;
  const state = await world.read("runs/read", MACHINE_TOKEN, { run });
  const waited = await world.post("runs/wait", MACHINE_TOKEN, {
    run,
    request: {
      kind: "question",
      input: {
        id: group,
        run,
        session: null,
        expires_at: null,
        questions: [{
          id: question,
          prompt: `Move this document? (${question})`,
          reason: "It belongs with the other project.",
          options: [
            {
              key: "move",
              label: "Move",
              description: "Move it to the other project.",
              evidence: [],
              adoption: null,
              action,
            },
            {
              key: "leave",
              label: "Leave it",
              description: "Keep it where it is.",
              evidence: [],
              adoption: null,
              action: null,
            },
          ],
          recommendation: { option_key: "move", explanation: "Same topic." },
        }],
      },
    },
    call: null,
  }, {
    state_seq: (state.body["run"] as { state_seq: string }).state_seq,
  });
  assertEquals(waited.status, 200, JSON.stringify(waited.body));
  const read = await world.read("questions/read", MACHINE_TOKEN, { group });
  const created = (read.body["group"] as { created_seq: string }).created_seq;
  return { group, question, action, created };
}

async function choose(
  world: World,
  group: string,
  question: string,
  created: string,
  action: { binding_hash: string },
  option = "move",
) {
  const input = {
    group,
    created_seq: created,
    answer: { kind: "option", option_key: option },
    binding_hash: action.binding_hash,
    evidence: { question, option },
  };
  const reply = await call(
    world.server,
    "questions/answer-action",
    USER_TOKEN,
    command(input, {
      compare: { created_seq: created },
      confirmation: await issueConfirmation(world, answerQuestionAction, input),
    }),
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
}

function applyBody(question: string, action: unknown, world: World) {
  const seq = String(
    inspect(
      world.server,
      `select g.closed_seq as s from questions q
       join question_groups g on g.id = q."group" where q.id = ?`,
      [question],
    )[0]!["s"],
  );
  return {
    question,
    answered_seq: seq,
    option_key: "move",
    action,
    evidence: { question, option: "move" },
  };
}

Deno.test("lophn-agent/questions#R13: 선택 전에는 문서가 그대로이고 사람이 고른 뒤에만 고정한 이동이 한 번 적용되며 두 번째는 conflict다", async () => {
  const world = await open();
  try {
    const { document } = await world.seed("report", "# Report\n");
    const before = placeOf(world, document);
    const { group, question, action, created } = await askMove(
      world,
      document,
    );
    // 질문을 만든 것만으로는 아무것도 바뀌지 않는다.
    assertEquals(placeOf(world, document), before);
    assertEquals(count(world.server, MOVED), 0);
    await choose(world, group, question, created, action);
    // 답을 접수했을 뿐 적용은 아니다.
    assertEquals(placeOf(world, document), before);
    assertEquals(count(world.server, MOVED), 0);
    const applied = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(question, action, world),
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals((applied.body as { applied: boolean }).applied, true);
    assertEquals(placeOf(world, document), {
      place: OTHER_PROJECT,
      name: "moved",
    });
    assertEquals(count(world.server, MOVED), 1);
    assertEquals(count(world.server, EVIDENCE), 1);
    // 근거를 검증한 적용은 사람 결정이라 actor=user, run=null로 남는다(identity R14).
    const moved = inspect(
      world.server,
      "select actor, run from events where type = 'DocumentMoved'",
    );
    assertEquals(moved[0]!["actor"], "user");
    assertEquals(moved[0]!["run"], null);
    const read = await world.read("questions/read", MACHINE_TOKEN, { group });
    assertEquals(
      (read.body["group"] as { questions: { applied: boolean }[] })
        .questions[0].applied,
      true,
    );
    // 같은 선택지의 두 번째 적용은 conflict이고 이동도 일회 기록도 더하지 않는다.
    const again = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(question, action, world),
    );
    assertEquals(again.status, 409, JSON.stringify(again.body));
    assertEquals(count(world.server, MOVED), 1);
    assertEquals(count(world.server, EVIDENCE), 1);
  } finally {
    await world.async_dispose();
  }
});

Deno.test("lophn-agent/questions#R14: 질문 뒤 문서가 바뀌면 답은 남고 이동은 적용되지 않으며 달라진 대상과 이유를 알린다", async () => {
  const world = await open();
  try {
    const { document } = await world.seed("report", "# Report\n");
    const { group, question, action, created } = await askMove(
      world,
      document,
    );
    await choose(world, group, question, created, action);
    // 질문 뒤 사람이 문서 이름을 바꿨다. 질문이 고정한 기준 revision은 낡았다.
    const renamed = await world.post(
      "documents/rename",
      USER_TOKEN,
      { document, name: "weekly" },
      { base_revision: revisionOf(world, document) },
    );
    assertEquals(renamed.status, 200, JSON.stringify(renamed.body));
    const kept = placeOf(world, document);
    const refused = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(question, action, world),
    );
    assertEquals(refused.status, 409, JSON.stringify(refused.body));
    const details = (refused.body["error"] as {
      details?: { targets: string[]; reason: string };
    }).details;
    assertEquals(details?.targets, [document]);
    assert((details?.reason ?? "").length > 0);
    // 이동은 일어나지 않았고 일회 기록도 없어 다시 적용을 시도할 수 있다.
    assertEquals(placeOf(world, document), kept);
    assertEquals(count(world.server, MOVED), 0);
    assertEquals(count(world.server, EVIDENCE), 0);
    // 답은 그대로다.
    const read = await world.read("questions/read", MACHINE_TOKEN, { group });
    const record = read.body["group"] as {
      status: string;
      questions: { applied: boolean; answer: { option_key: string } }[];
    };
    assertEquals(record.status, "answered");
    assertEquals(record.questions[0].answer.option_key, "move");
    assertEquals(record.questions[0].applied, false);
  } finally {
    await world.async_dispose();
  }
});

Deno.test("lophn-agent/questions#R13: 고르지 않은 선택지의 근거로는 문서를 옮기지 않는다", async () => {
  const world = await open();
  try {
    const { document } = await world.seed("report", "# Report\n");
    const before = placeOf(world, document);
    const { group, question, action, created } = await askMove(
      world,
      document,
    );
    // 이동하지 않는 선택지를 골랐다. 이동 action을 적용할 근거가 아니다.
    const left = await world.post(
      "questions/answer",
      USER_TOKEN,
      {
        group,
        created_seq: created,
        answers: [{
          question,
          answer: { kind: "option", option_key: "leave" },
        }],
      },
      { created_seq: created },
    );
    assertEquals(left.status, 200, JSON.stringify(left.body));
    const refused = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(question, action, world),
    );
    assertEquals(refused.status, 403, JSON.stringify(refused.body));
    assertEquals(placeOf(world, document), before);
    assertEquals(count(world.server, MOVED), 0);
    assertEquals(count(world.server, EVIDENCE), 0);
  } finally {
    await world.async_dispose();
  }
});

Deno.test("lophn-agent/questions#R13: 범위 밖 문서와 없는 문서는 같은 not_found로 답하고 아무것도 바꾸지 않는다", async () => {
  const world = await open();
  try {
    const { document } = await world.seed("report", "# Report\n");
    // 없는 문서를 고정한 선택지.
    const absent = await askMove(world, document, {
      target: ABSENT_DOCUMENT,
      base_revision: "1",
    });
    await choose(
      world,
      absent.group,
      absent.question,
      absent.created,
      absent.action,
    );
    const missing = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(absent.question, absent.action, world),
    );
    assertEquals(missing.status, 404, JSON.stringify(missing.body));
    // 실제 문서이지만 적용 자격의 범위 밖이다. 없는 문서와 같은 답이다.
    await acceptCredential(
      world.core,
      {
        principal: "machine:scoped",
        actor: "machine",
        scope: {
          operations: ["ApplyQuestionOption", "document.move"],
          targets: { document: ABSENT_DOCUMENT },
        },
        conditions: {},
        credential_ref: "cred-machine-scoped",
      },
      SCOPED_TOKEN,
    );
    // 앞 질문이 끝나지 않은 run은 새 질문을 받지 않으므로 다른 assignment의 run으로 묻는다.
    const moved = await askMove(world, document, { seat: world.editor });
    await choose(
      world,
      moved.group,
      moved.question,
      moved.created,
      moved.action,
    );
    const outside = await world.post(
      "questions/apply-option",
      SCOPED_TOKEN,
      applyBody(moved.question, moved.action, world),
    );
    assertEquals(outside.status, 404, JSON.stringify(outside.body));
    assertEquals(outside.body, missing.body);
    assertEquals(count(world.server, MOVED), 0);
    assertEquals(count(world.server, EVIDENCE), 0);
  } finally {
    await world.async_dispose();
  }
});

Deno.test("lophn-agent/questions#R16: 채택 선택지의 고정 version은 그 문서의 실제 version이어야 하고 새 version이 생겨도 채택은 처음 판이다", async () => {
  const world = await open();
  try {
    const { document, version } = await world.seed("design", "# Design\n");
    const ask = async (reference: unknown) => {
      const run = world.lophn.run;
      const state = await world.read("runs/read", MACHINE_TOKEN, { run });
      counter += 1;
      return await world.post("runs/wait", MACHINE_TOKEN, {
        run,
        request: {
          kind: "question",
          input: {
            id: id("qgr", 150 + counter),
            run,
            session: null,
            expires_at: null,
            questions: [{
              id: id("qst", 150 + counter),
              prompt: `Adopt this design? (${counter})`,
              reason: "It is the design to build.",
              options: [{
                key: "adopt",
                label: "Adopt",
                description: "Build exactly this version.",
                evidence: [],
                adoption: reference,
                action: null,
              }],
              recommendation: null,
            }],
          },
        },
        call: null,
      }, {
        state_seq: (state.body["run"] as { state_seq: string }).state_seq,
      });
    };
    // 없는 version, 다른 문서의 version은 채택으로 고정할 수 없다.
    const fake = await ask({
      document,
      version: id("ver", 77),
      section: null,
    });
    assertEquals(fake.status, 400, JSON.stringify(fake.body));
    const wrong = await ask({
      document: id("doc", 77),
      version,
      section: null,
    });
    assertEquals(wrong.status, 400, JSON.stringify(wrong.body));
    // 실제 version은 고정된다. 질문은 그 판만 가리키고 답한 뒤에도 같다.
    const real = await ask({ document, version, section: null });
    assertEquals(real.status, 200, JSON.stringify(real.body));
    const stored = inspect(
      world.server,
      `select q.options as options from questions q
       join question_groups g on g.id = q."group" where g.run = ?`,
      [world.lophn.run],
    );
    const options = JSON.parse(String(stored[0]!["options"])) as {
      adoption: { version: string };
    }[];
    assertEquals(options[0]!.adoption.version, version);
  } finally {
    await world.async_dispose();
  }
});
