// coding-agent#T43 제품 경로: 실제 core(임시 LOPHN_HOME, 실제 coding-agent worker child)에 긴 log와 사람
// 보고가 있는 문제를 심고, 그 앱 하나 범위의 실제 coding connection credential로
// `/v1/repair_context/summary|bundle|more`를 HTTP로 부른다. 알려진 값(connection token)과 pattern
// 비밀은 어느 응답에도 없고, 다른 앱의 문제는 없는 문제와 같은 답이며, 일반 `blobs/read`는 닫혀 있다.
// 사람의 실제 keychain·데이터 root는 열지 않는다(fake keychain, temp home).
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import {
  openWorld,
  type World,
} from "../../packages/apps/runtime/world_test.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "./problems.ts";
import { ticketDefinitions } from "./tickets.ts";

// pattern 검출기(openai 형식)가 잡는 값. connection token은 core 알려진 값이다.
const SECRET = "sk-ABCDEF0123456789SECRETVALUE";
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const ABSENT_PROBLEM = "prb_01arz3ndektsv4rrffq69g5fb9";
const ABSENT_REPORT = "rpt_01arz3ndektsv4rrffq69g5fb9";
const OCCURRENCES = 24;

type Reply = { status: number; body: Record<string, unknown> };

async function post(
  world: World,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

const envelope = (input: unknown, compare: unknown = {}) => ({
  input,
  idempotency_key: `k-${crypto.randomUUID()}`,
  compare,
  prepared: [],
});

const rpt = (n: number) =>
  `rpt_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;
const snp = (n: number) =>
  `snp_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;

type Prepared = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

async function prepare(
  world: World,
  principal: string,
  purpose: string,
  text: string,
): Promise<Prepared> {
  const prepared = await world.harness.prepareBlob({
    principal,
    purpose,
    bytes: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
  });
  assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
  return prepared.value as Prepared;
}

function blobOf(prepared: Prepared) {
  return {
    hash: prepared.hash,
    size_bytes: prepared.size_bytes,
    purpose: prepared.purpose,
    source: { kind: "prepared", blob: prepared },
  };
}

// 같은 문제(exception key의 discriminator는 최초 rpt)에 접수되는 보고 하나.
function reportInput(
  principal: string,
  app: string,
  n: number,
  options: {
    observedMs: number;
    logs?: Prepared;
    text?: Prepared;
    problem?: string;
  },
) {
  const feedback = options.text !== undefined;
  const at = new Date(options.observedMs).toISOString();
  const authentication = {
    principal,
    actor: feedback ? "user" : "machine",
    scope: { operations: ["RecordReport"], targets: {} },
    conditions: {},
    credential_ref: `cred-${n}`,
  };
  const blobs = [
    ...(options.logs ? [blobOf(options.logs)] : []),
    ...(options.text ? [blobOf(options.text)] : []),
  ];
  return {
    report: {
      id: rpt(n),
      app,
      mode: "live",
      diagnostic_scope: null,
      release: RELEASE,
      release_missing_reason: null,
      bundle_hash: "a".repeat(64),
      source: feedback ? "feedback" : "exception",
      code: feedback ? "_feedback" : "_exception",
      text: options.text?.hash ?? null,
      details: null,
      snapshot: snp(n),
      observed_at: at,
      principal,
      content_hash: String(n).padStart(2, "0").repeat(32),
    },
    snapshot: {
      id: snp(n),
      captured_at: at,
      invocation: {
        id: "inv_01arz3ndektsv4rrffq69g5fav",
        binding: "sdk_context",
        record_missing_reason: null,
      },
      invocation_missing_reason: null,
      error: {
        name: "TypeError",
        message: `boom ${n}`,
        message_missing_reason: null,
        frames: [{
          path: `src/f${n % 3}.ts`,
          function: null,
          line: 1,
          column: 1,
        }],
        source_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "stack unavailable" },
        truncation_notes: [],
      },
      error_missing_reason: null,
      logs: options.logs === undefined ? null : {
        blob: options.logs.hash,
        line_count: 30,
        truncated: false,
        scope: "process",
        from_at: null,
        to_at: null,
        collected_at: at,
      },
      logs_missing_reason: options.logs === undefined
        ? { reason: "log not collected" }
        : null,
      screen: null,
      screen_missing_reason: { reason: "not collected" },
    },
    group_key: {
      kind: "exception",
      code: "_exception",
      discriminator: rpt(1),
    },
    existing_problem: feedback ? options.problem ?? null : null,
    blobs,
    origin: {
      context: {
        authentication,
        app,
        mode: "live",
        diagnostic_scope: null,
        release: RELEASE,
        release_missing_reason: null,
        bundle_hash: "a".repeat(64),
        binding: feedback ? "shell" : "sdk",
        origin: feedback ? "shell_user" : "process_observer",
      },
      report_id: rpt(n),
      content_hash: String(n).padStart(2, "0").repeat(32),
    },
  };
}

async function record(
  world: World,
  token: string,
  input: ReturnType<typeof reportInput>,
): Promise<string> {
  const sent = await post(
    world,
    "problems/record-report",
    token,
    envelope(input, {
      active_release: RELEASE,
      problem_seq: null,
    }),
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  return String(sent.body["problem"]);
}

// 읽은 data fence의 자료 줄이다.
function dataLines(fenced: unknown): string[] {
  const lines = String(fenced).split("\n");
  return lines.slice(1, -1).map((line) => line.slice(2));
}

Deno.test("coding-agent/repair-context#R11 R12 R15 R16 R17 R19: 실제 core의 repair_context route가 긴 log·사람 보고를 예산·cursor로 읽고 비밀과 범위 밖 대상을 내지 않는다", async () => {
  const keychain: FakeKeychain = createFakeKeychain();
  const world = await openWorld({
    approvals: true,
    extend: {
      teams: [
        { codingAgentConnectionDefinitions },
        { ticketDefinitions },
        { problemsTestDefinitions },
        { problemsReportDefinitions },
      ],
      teamModules: [
        new URL("./coding-agent.ts", import.meta.url).href,
        new URL("./tickets.ts", import.meta.url).href,
        new URL("./problems.ts", import.meta.url).href,
        new URL("./repair-context-ports_test.ts", import.meta.url).href,
      ],
      coding: { keychain, loaders: [] },
    },
  });
  try {
    await world.harness.codingCredentialsReady;
    const user = (await world.login("user", [
      "CreateCodingAgentConnection",
      "CreateTicket",
      "app.create",
    ])).token;
    const machine = await world.login("machine", ["RecordReport"]);
    const made = await post(
      world,
      "apps/create",
      user,
      envelope({ slug: "other", name: "Other", description: "other app" }),
    );
    assertEquals(made.status, 200, JSON.stringify(made.body));
    const otherApp = String(made.body["id"]);

    // 이 앱 하나 범위의 실제 coding connection이다. 이 token도 core 알려진 값이다.
    const connected = await world.harness.codingCredentials!.connect(
      { label: "repair", scope: { kind: "app", app: world.app } },
      async (submission): Promise<Result<unknown>> => {
        const sent = await post(
          world,
          "coding_agent_connections/create",
          user,
          envelope(submission),
        );
        return sent.status === 200
          ? ok(sent.body)
          : err({ code: "conflict", message: `${sent.status}` });
      },
    );
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    const token = decoder.decode(
      keychain.stored.get(codingCredentialRef(connected.value.connection)!)!,
    );
    const secrets = [SECRET, token];

    // 긴 log(30줄, 한 줄에 다국어 2,000 bytes쯤, 전체 60 KB쯤)와 비밀이 든 사람 글. 같은 문제에 24개
    // 발생. log는 한 페이지(24,576 bytes)를 넘어 byte 상한으로 나뉘어 읽힌다.
    const logLines = Array.from(
      { length: 30 },
      (_, i) =>
        i === 10
          ? `line ${i} leaked ${SECRET} and ${token}`
          : `line ${i} ${"한글🙂".repeat(200)}`,
    );
    const logs = await prepare(
      world,
      machine.context.principal,
      "snapshot_logs",
      logLines.join("\n"),
    );
    const humanText = await prepare(
      world,
      machine.context.principal,
      "report_text",
      `저장하면 멈춰요. 내 키는 ${SECRET} 이고 token ${token} 입니다.\n${
        "더 긴 설명 ".repeat(200)
      }`,
    );
    const t0 = Date.now() - 3_600_000;
    const problem = await record(
      world,
      machine.token,
      reportInput(machine.context.principal, world.app, 1, {
        observedMs: t0,
        logs,
      }),
    );
    for (let n = 2; n < OCCURRENCES; n += 1) {
      assertEquals(
        await record(
          world,
          machine.token,
          reportInput(machine.context.principal, world.app, n, {
            observedMs: t0 + n * 60_000,
          }),
        ),
        problem,
      );
    }
    // 사람 보고(기존 문제에 붙는 feedback)가 마지막 발생이다.
    assertEquals(
      await record(
        world,
        machine.token,
        reportInput(machine.context.principal, world.app, OCCURRENCES, {
          observedMs: t0 + OCCURRENCES * 60_000,
          text: humanText,
          problem,
        }),
      ),
      problem,
    );
    // 다른 앱의 문제는 같은 형태로 하나 둔다.
    const otherLogs = await prepare(
      world,
      machine.context.principal,
      "snapshot_logs",
      "other app log",
    );
    const outside = await record(
      world,
      machine.token,
      {
        ...reportInput(machine.context.principal, otherApp, 40, {
          observedMs: t0,
          logs: otherLogs,
        }),
        group_key: {
          kind: "exception",
          code: "_exception",
          discriminator: rpt(40),
        },
      },
    );
    assert(outside !== problem);

    const ask = (route: string, body: unknown, bearer = token) =>
      post(world, `repair_context/${route}`, bearer, body);
    const leaked = (value: unknown) => {
      const text = JSON.stringify(value);
      return secrets.some((secret) => text.includes(secret));
    };

    // summary: 문제당 2줄·1,200자 안이고 as_of_seq가 있다.
    const summary = await ask("summary", { selector: { problem } });
    assertEquals(summary.status, 200, JSON.stringify(summary.body));
    assertFalse(leaked(summary.body));
    assert(typeof summary.body["as_of_seq"] === "string");
    const summaryProblems = (summary.body["summary"] as {
      problems: { symptom: string }[];
    }).problems;
    assertEquals(summaryProblems.length, 1);

    // bundle: 24,576 bytes·300줄 안이고, 사람 글·log가 data fence 안에서 가려진 채 보인다.
    const bundle = await ask("bundle", { selector: { problem } });
    assertEquals(bundle.status, 200, JSON.stringify(bundle.body));
    assertFalse(leaked(bundle.body));
    assert(typeof bundle.body["as_of_seq"] === "string");
    const context = bundle.body["context"] as {
      bytes: number;
      lines: number;
      sections: { kind: string; content: string; availability: string }[];
    };
    assert(context.bytes <= 24_576);
    assert(context.lines <= 300);
    const human = context.sections.find((section) =>
      section.kind === "human_text"
    );
    assert(human !== undefined, "사람 글 절이 있다");
    assert(human.content.includes("<<<LOPHN-DATA"));
    assert(human.content.includes("저장하면 멈춰요"));
    // 긴 log는 묶음 예산 때문에 줄고(R12), 줄인 자리가 실제 이어 읽기 참조를 가리킨다.
    const logSection = context.sections.find((section) =>
      section.kind === "logs"
    )! as unknown as {
      content: string;
      availability: string;
      more: { kind: string; source: string }[] | null;
    };
    assertEquals(logSection.availability, "truncated");
    assert(logSection.content.includes("이어 읽기: more log"));
    assert(/원래 \d+ bytes·\d+줄/.test(logSection.content));
    assertEquals(logSection.more![0].kind, "log");
    assertEquals(logSection.more![0].source, `snapshot:${snp(1)}`);

    // more: log를 페이지(24,576 bytes·300줄)씩 이어 읽는다(누락·중복 없음). 비밀은 가려진다.
    // bundle이 가리킨 참조 그대로 이어 읽는다.
    const source = logSection.more![0].source;
    const chunks: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await ask("more", { problem, kind: "log", source, cursor });
      assertEquals(page.status, 200, JSON.stringify(page.body));
      assertFalse(leaked(page.body));
      assert(typeof page.body["as_of_seq"] === "string");
      const item = String(page.body["item"]);
      assert(encoder.encode(item).length <= 24_576);
      assert(item.split("\n").length <= 300);
      chunks.push(...dataLines(item));
      pages += 1;
      cursor = page.body["next_cursor"] as string | null;
    } while (cursor !== null && pages < 10);
    assert(pages >= 3 && pages <= 4, `${pages}쪽`);
    const joined = chunks.join("");
    // 줄바꿈 말고는 누락·중복이 없다: 30줄의 표식이 한 번씩, 비밀 자리는 가려진 채다.
    for (let i = 0; i < 30; i += 1) {
      assertEquals(joined.split(`line ${i} `).length, 2, `line ${i}`);
    }
    assert(joined.includes("line 10 leaked * and *"));
    assertEquals(
      joined.replaceAll("line 10 leaked * and *", "").length,
      logLines.join("").replace(logLines[10], "").length,
    );

    // more: 발생 목록은 20개씩이고 중복·누락이 없다. 사람 보고(마지막 발생)가 먼저다.
    const ids: string[] = [];
    cursor = null;
    pages = 0;
    do {
      const page = await ask("more", {
        problem,
        kind: "occurrences",
        source: `problem:${problem}`,
        cursor,
      });
      assertEquals(page.status, 200, JSON.stringify(page.body));
      const rows = JSON.parse(dataLines(page.body["item"]).join("\n")) as {
        id: string;
      }[];
      assert(rows.length <= 20);
      ids.push(...rows.map((row) => row.id));
      cursor = page.body["next_cursor"] as string | null;
      pages += 1;
    } while (cursor !== null && pages < 10);
    assertEquals(pages, 2);
    assertEquals(ids.length, OCCURRENCES);
    assertEquals(new Set(ids).size, OCCURRENCES);
    assertEquals(ids[0], rpt(OCCURRENCES));

    // more: 사람 글(report_text)도 같은 길이다. 비밀은 가려진다.
    const text = await ask("more", {
      problem,
      kind: "reference",
      source: `report:${rpt(OCCURRENCES)}`,
      cursor: null,
    });
    assertEquals(text.status, 200, JSON.stringify(text.body));
    assertFalse(leaked(text.body));

    // source_diff는 보존 근거가 없으면 이유만 낸다.
    const diff = await ask("more", {
      problem,
      kind: "source_diff",
      source: `problem:${problem}`,
      cursor: null,
    });
    assertEquals(diff.status, 200, JSON.stringify(diff.body));
    assertEquals(diff.body["item"], null);
    assert(
      (diff.body["missing"] as { reason: string }).reason.includes(
        "source diff",
      ),
    );

    // 변조·다른 kind에 쓴 cursor는 invalid_input이다.
    const first = await ask("more", {
      problem,
      kind: "log",
      source,
      cursor: null,
    });
    const next = String(first.body["next_cursor"]);
    const tampered = await ask("more", {
      problem,
      kind: "log",
      source,
      cursor: `${next.slice(0, 3)}${next[3] === "A" ? "B" : "A"}${
        next.slice(4)
      }`,
    });
    assertEquals(tampered.status, 400);
    const wrongKind = await ask("more", {
      problem,
      kind: "screen",
      source,
      cursor: next,
    });
    assertEquals(wrongKind.status, 400);

    // 다른 앱의 문제는 없는 문제와 같은 답이다(summary·bundle·more).
    for (
      const [route, body] of [
        ["summary", (id: string) => ({ selector: { problem: id } })],
        ["bundle", (id: string) => ({ selector: { problem: id } })],
        ["more", (id: string) => ({
          problem: id,
          kind: "log",
          source: `report:${rpt(40)}`,
          cursor: null,
        })],
      ] as const
    ) {
      const hidden = await ask(route, body(outside));
      const absent = await ask(route, body(ABSENT_PROBLEM));
      assertEquals(hidden.status, 404, JSON.stringify(hidden.body));
      assertEquals(hidden, absent);
    }

    // 좁은 본문 읽기: 범위 안 보고는 가린 글, 범위 밖 보고는 없는 보고와 같은 답이다.
    const body = await post(world, "problems/report_body", token, {
      report: rpt(1),
      field: "snapshot_logs",
      length_bytes: 65_536,
    });
    assertEquals(body.status, 200, JSON.stringify(body.body));
    assertFalse(leaked(body.body));
    const hiddenBody = await post(world, "problems/report_body", token, {
      report: rpt(40),
      field: "snapshot_logs",
      length_bytes: 65_536,
    });
    const absentBody = await post(world, "problems/report_body", token, {
      report: ABSENT_REPORT,
      field: "snapshot_logs",
      length_bytes: 65_536,
    });
    assertEquals(hiddenBody.status, 404);
    assertEquals(hiddenBody, absentBody);
    // 정해진 field 밖은 입력 오류다.
    const other = await post(world, "problems/report_body", token, {
      report: rpt(1),
      field: "snapshot_stack",
      length_bytes: 100,
    });
    assertEquals(other.status, 400);

    // 일반 blobs/read는 coding 연결에 계속 닫혀 있다.
    const general = await post(world, "blobs/read", token, {
      owner_kind: "report",
      owner_key: rpt(1),
      field: "snapshot_logs",
      offset_bytes: 0,
      length_bytes: 100,
    });
    assertEquals(general.status, 403, JSON.stringify(general.body));

    // 문제 검증 읽기는 제품 reader 등록에 있다(404가 아니다).
    const verifications = await post(
      world,
      "problems/list-verifications",
      token,
      {
        app: world.app,
        problem,
      },
    );
    assertEquals(verifications.status, 200, JSON.stringify(verifications.body));
  } finally {
    await world.close();
  }
});
