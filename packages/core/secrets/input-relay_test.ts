// platform/secrets#R1 R2 R6 R8, platform/redaction#R1: 사람이 secret을 넣는 제품 경로 전부를
// 실제 core로 본다. 값은 `/v1/secrets/input`(보호 입력 upload route)으로 와서 core를 지나
// I/O worker의 `secret.prepare`로만 가고, 준비 증거는 core의 writer가 ledger에 남기며, SetSecret이
// 참조를 확정한 뒤 documents 읽기와 메시지 본문이 그 값을 가린다.
//
// keychain은 fake adapter다(사람의 실제 keychain·secret-tool에 닿지 않는다). I/O worker는 같은
// process 안의 실제 `createPlatformIo`(fake keychain을 쥔 secret pipe)이고 core와 frame pipe로
// 이어진다. LOPHN_HOME은 temp dir다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import { disconnectProvider } from "../../protocol/lophn-agent/mod.ts";
import { FrameDecoder } from "../../protocol/base/mod.ts";
import { removeSecret, setSecret } from "../../protocol/secrets/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "../projects/outline-and-search/adapters/store.ts";
import { recordExtraction } from "../projects/outline-and-search/extraction.ts";
import { confirmationBinding } from "../server/identity/mod.ts";
import {
  createFakeKeychain,
  createSecretWork,
  type FakeKeychain,
} from "./mod.ts";
import { id } from "../lophn-agent/session/testing/mod.ts";
import { createSecretPipe } from "./worker/pipe.ts";
import { type Core, startCore } from "../main/daemon/core.ts";
import { createLedgerRegistration } from "../projects/register.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "../lophn-agent/register.ts";
import { inProcessIo } from "../testing/in-process-io.ts";
import { closeUnlessKept } from "../testing/close-on-throw.ts";

const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const AT = Date.UTC(2024, 0, 1);
const TOKEN = "e".repeat(43);
// pattern 규칙에 걸리지 않는 값이라 알려진 값 registry로만 가려진다.
const FIRST = "correct-horse-battery-staple-9";
const SECOND = "second-secret-value-77";
const OPERATIONS = [
  "document.save",
  "document.prepare",
  "document.read",
  "secret.input",
  "ListSecrets",
  "SetSecret",
  "RemoveSecret",
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "ReadMessageBody",
  "RegisterProvider",
  "DisconnectProvider",
  "project.create",
];

const ANTHROPIC = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["api_key"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

const TEXT = [
  "# 용어집",
  "",
  "## 문서",
  "",
  "문서는 판으로 저장된다.",
  `내부 메모: ${FIRST} 그리고 ${SECOND} 입니다.`,
].join("\n");

type Opened = {
  core: Core;
  home: string;
  keychain: FakeKeychain;
  store: DerivedStore;
  io: ReturnType<typeof inProcessIo>;
};

// 같은 데이터 root에서 core를 띄운다. 다시 띄울 때는 credential 기록이 이미 ledger에 있다.
async function boot(
  home: string,
  keychain: FakeKeychain,
  restart: boolean,
  secretSweepMs?: number,
): Promise<{ core: Core; io: ReturnType<typeof inProcessIo> }> {
  // 값이 닿는 곳은 fake keychain뿐이다. 증거는 응답으로 돌려주고 core가 남긴다.
  const io = inProcessIo({
    root: home,
    secrets: createSecretPipe({
      work: createSecretWork({
        keychain,
        preparationId: () => `prep_${crypto.randomUUID()}`,
      }),
    }),
  });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("../projects/register.ts", import.meta.url).href,
      new URL("../lophn-agent/register.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(restart ? 12 : 11),
    testCredentials: true,
    secretKeychain: keychain,
    ...(secretSweepMs === undefined ? {} : { secretSweepMs }),
    spawn: io.spawn,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-secret-input",
  };
  assert((await core.acceptTestCredential?.(context, TOKEN))?.ok);
  if (!restart) assert((await core.record(context)).ok);
  guard.keep();
  return { core, io };
}

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-secret-input-" });
  const keychain = createFakeKeychain();
  const { core, io } = await boot(home, keychain, false);
  await using guard = closeUnlessKept(async () => {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const store = openDerived(derivedPath(`${home}/derived`));
  assert(store.ok, store.ok ? "" : store.error.message);
  guard.keep();
  return { core, home, keychain, store: store.value, io };
}

async function close(opened: Opened) {
  opened.store.close();
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
}

function post(core: Core, path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

function base64url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

// 사람의 보호 입력창(main)이 하는 일: 값을 upload route로 보내고 값 없는 준비 증거를 받는다.
async function inputValue(
  core: Core,
  owner: string,
  value: string,
  declared?: number,
  purpose = "app_secret",
): Promise<Response> {
  const bytes = new TextEncoder().encode(value);
  return await fetch(`http://127.0.0.1:${core.port}/v1/secrets/input`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-lophn-input": base64url(JSON.stringify({
        purpose,
        owner,
        bytes: declared ?? bytes.length,
      })),
      authorization: `Bearer ${TOKEN}`,
    },
    body: bytes,
  });
}

type Preparation = {
  preparation: string;
  sealed_ref: string;
  purpose: string;
  owner: string;
};

// 사람 결정 handle을 발급한다(secret_input 확인). main이 준비 증거를 받은 뒤에 한다.
async function handleFor(
  core: Core,
  route:
    | typeof setSecret
    | typeof removeSecret
    | typeof disconnectProvider,
  input: unknown,
): Promise<string> {
  const binding = await confirmationBinding(route, input);
  assert(binding);
  const issued = await core.confirmation?.({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${crypto.randomUUID()}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [route.name],
      expires_at: new Date(AT + 600_000).toISOString(),
    },
  });
  assert(issued?.ok, issued?.ok ? "" : JSON.stringify(issued?.error));
  const handle = (issued.value as { confirmation?: string }).confirmation;
  assert(typeof handle === "string");
  return handle;
}

// 값 입력 → SetSecret까지 사람이 하는 길 전부.
async function setValue(
  opened: Opened,
  name: string,
  value: string,
  compare: { sealed_ref: string | null; revision: number | null },
): Promise<{ ref: string; revision: number }> {
  const prepared = await inputValue(opened.core, name, value);
  const evidence = await prepared.json() as Preparation;
  assertEquals(prepared.status, 200, JSON.stringify(evidence));
  assertEquals(evidence.owner, name);
  assertEquals(evidence.purpose, "app_secret");
  const input = { name, preparation: evidence };
  const response = await post(opened.core, "secrets/set", {
    input,
    idempotency_key: `set-${crypto.randomUUID()}`,
    compare,
    prepared: [],
    confirmation: await handleFor(opened.core, setSecret, input),
  });
  const body = await response.json() as { revision?: number };
  assertEquals(response.status, 200, JSON.stringify(body));
  return { ref: evidence.sealed_ref, revision: body.revision! };
}

async function removeValue(
  opened: Opened,
  name: string,
  compare: { sealed_ref: string; revision: number },
): Promise<void> {
  const input = { name };
  const response = await post(opened.core, "secrets/remove", {
    input,
    idempotency_key: `remove-${crypto.randomUUID()}`,
    compare,
    prepared: [],
    confirmation: await handleFor(opened.core, removeSecret, input),
  });
  assertEquals(response.status, 200, await response.text());
}

// 문서를 저장하고 그 판의 추출 결과를 파생 store에 심는다(secret-store_test와 같은 길).
async function seed(opened: Opened): Promise<string> {
  assert(opened.core.notePrepared);
  for (
    const [preparation, purpose] of [
      ["prep-input-1", "document_files"],
      ["prep-file-input-1", "document_file"],
    ] as const
  ) {
    const noted = await opened.core.notePrepared({
      preparation,
      principal: "user-1",
      purpose,
      hash: HASH,
      size_bytes: 10,
    }, AT);
    assert(noted.ok, noted.ok ? "" : noted.error.message);
  }
  const saved = await post(opened.core, "documents/save", {
    input: {
      document: DOC,
      base_version: null,
      files_hash: HASH,
      file_count: 1,
      primary_path: "a.md",
      content_hash: HASH,
      preparation_ref: "prep-input-1",
      files: [{
        path: "a.md",
        blob_hash: HASH,
        bytes: 10,
        media_type: "text/markdown",
        primary: true,
        preparation_ref: "prep-file-input-1",
      }],
      idempotency_key: "input-1",
      metadata: { title: "용어집", place: null, name: null },
      format: { name: "document", module_hash: HASH, explicit: false },
      validation: {
        input_hash: HASH,
        module_hash: HASH,
        status: "passed",
        error_count: 0,
        warning_count: 0,
        diagnostics: [],
      },
      source: null,
    },
    idempotency_key: "input-1",
    compare: { base_version: null },
    prepared: ["prep-input-1"],
  });
  const body = await saved.json() as { version: string; event_seq: string };
  assertEquals(saved.status, 200, JSON.stringify(body));
  const written = recordExtraction(opened.store, {
    document: DOC,
    version: body.version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "용어집",
      text: TEXT,
      text_hash: HASH,
      sections: [{
        key: "문서",
        title: "문서",
        parent: null,
        position: 0,
        level: 2,
        anchor: null,
        own_ranges: [{ start_line: 5, end_line: 6 }],
        subtree_range: { start_line: 5, end_line: 6 },
        characters: 60,
        body_hash: HASH,
      }],
    },
  }, body.event_seq);
  assert(written.ok, written.ok ? "" : written.error.message);
  const cursor = opened.store.transaction((tx) =>
    ok(tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
      [body.event_seq],
    ))
  );
  assert(cursor.ok);
  return body.version;
}

async function readText(core: Core, version: string): Promise<string | null> {
  const read = await post(core, "documents/read", {
    reference: { document: DOC, version, section: null },
  });
  const body = await read.json() as { text?: string | null };
  assertEquals(read.status, 200, JSON.stringify(body));
  return body.text ?? null;
}

type Assignment = { id: string; role: string; revision: number; state: string };

// 메시지 하나를 보내고 저장된 본문(redaction을 거친 글)을 읽어 돌려준다.
class Conversation {
  private sent = 0;
  private readonly core: Core;
  private readonly assignment: Assignment;
  private readonly session: string;
  private readonly number: number;

  private constructor(
    core: Core,
    assignment: Assignment,
    session: string,
    number: number,
  ) {
    this.core = core;
    this.assignment = assignment;
    this.session = session;
    this.number = number;
  }

  static async open(core: Core, number = 1): Promise<Conversation> {
    const listed = await post(core, "assignments/list", {});
    const body = await listed.json() as { assignments: Assignment[] };
    assertEquals(listed.status, 200, JSON.stringify(body));
    const lophn = body.assignments.find((entry) => entry.role === "lophn")!;
    const session = id("ses", number);
    // 세션은 쓸 수 있는 project 하나를 자리로 받는다. 같은 key라 다시 만들어도 같은 결과다.
    const place = await post(core, "projects/create", {
      input: {
        id: id("prj", 1),
        name: "alpha",
        title: "alpha",
        purpose: "",
        folders: [],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: "place-secret-input",
      compare: {},
      prepared: [],
    });
    assertEquals(place.status, 200, await place.text());
    const opened = await post(core, "sessions/open", {
      input: {
        id: session,
        assignment: lophn.id,
        work_place: { kind: "project", id: id("prj", 1) },
        opening_context: null,
      },
      idempotency_key: `open-secret-input-${number}`,
      compare: {
        assignment_revision: lophn.revision,
        assignment_state: lophn.state,
      },
      prepared: [],
    });
    assertEquals(opened.status, 200, await opened.text());
    return new Conversation(core, lophn, session, number);
  }

  // 한 번 보내 본다. 성공이면 message id가 있다.
  async sayRaw(
    text: string,
  ): Promise<{ status: number; body: unknown; message: string }> {
    const n = ++this.sent;
    const state = await (await post(this.core, "sessions/read", {
      session: this.session,
    })).json() as { session: { state_seq: string } };
    const message = id("msg", this.number * 100 + n);
    const sent = await post(this.core, "messages/receive", {
      input: {
        id: message,
        session: this.session,
        content: { schema_version: 1, parts: [{ kind: "text", text }] },
        mode: "request",
      },
      idempotency_key: `say-${this.number}-${n}`,
      compare: {
        session_state: "open",
        session_state_seq: state.session.state_seq,
        assignment_revision: this.assignment.revision,
        assignment_state: this.assignment.state,
      },
      prepared: [],
    });
    return { status: sent.status, body: await sent.json(), message };
  }

  async bodyOf(message: string): Promise<string> {
    const read = await (await post(this.core, "messages/body", { message }))
      .json() as { content: { parts: { text: string }[] } };
    return read.content.parts[0]!.text;
  }

  async say(text: string): Promise<string> {
    const sent = await this.sayRaw(text);
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    return await this.bodyOf(sent.message);
  }
}

function currentRef(home: string, name: string) {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "SELECT sealed_ref, revision FROM secrets WHERE name = ?",
    ).get(name) as { sealed_ref: string; revision: number } | undefined;
  } finally {
    db.close();
  }
}

function preparationRows(home: string): number {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return (db.prepare("SELECT count(*) AS n FROM secret_preparations")
      .get() as { n: number }).n;
  } finally {
    db.close();
  }
}

Deno.test("platform/secrets#R2 platform/redaction#R1 documents/outline-and-search#R8 lophn-agent/conversation#R2: 사람이 제품 경로로 넣은 secret은 documents 읽기와 메시지 본문에서 가려진다", async () => {
  const opened = await open();
  try {
    const version = await seed(opened);
    const chat = await Conversation.open(opened.core);
    // 등록 전에는 pattern에 걸리지 않는 값이 그대로다.
    assert((await readText(opened.core, version))?.includes(FIRST));
    assert((await chat.say(`전에 말한 ${FIRST}`)).includes(FIRST));

    const first = await setValue(opened, "service_key", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    // 증거는 SetSecret이 소비했고 현재 참조는 값이 아니라 참조다.
    assertEquals(preparationRows(opened.home), 0);
    assertEquals(currentRef(opened.home, "service_key")?.sealed_ref, first.ref);
    // keychain에는 값이 있다.
    const stored = await opened.keychain.load(first.ref);
    assert(stored.ok);
    assertEquals(new TextDecoder().decode(stored.value), FIRST);

    const masked = await readText(opened.core, version);
    assert(masked !== null);
    assert(!masked.includes(FIRST), "documents 읽기에 값이 남았다");
    assert(masked.includes(SECOND), "등록하지 않은 값은 그대로다");
    assert(masked.includes("*"));
    const body = await chat.say(`이제 ${FIRST} 와 ${SECOND}`);
    assert(!body.includes(FIRST), "메시지 본문에 값이 남았다");
    assert(body.includes(SECOND), "등록하지 않은 값은 그대로다");
    assert(body.includes("*"));

    // 목록은 이름·설정 여부·판만 보인다.
    const list = await post(opened.core, "secrets/list", {});
    const listed = await list.json();
    assertEquals(list.status, 200, JSON.stringify(listed));
    assertEquals(
      (listed as { secrets: unknown[] }).secrets,
      [{ name: "service_key", configured: true, revision: 1 }],
    );
    assert(!JSON.stringify(listed).includes(first.ref));
  } finally {
    await close(opened);
  }
});

Deno.test("platform/secrets#R6 platform/redaction#R1: 교체와 제거는 옛 값을 알려진 값에서 회수한다", async () => {
  const opened = await open();
  try {
    const version = await seed(opened);
    const chat = await Conversation.open(opened.core);
    const first = await setValue(opened, "service_key", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    assert(!(await readText(opened.core, version))?.includes(FIRST));

    // 교체: 옛 값은 더 이상 가려지지 않고 새 값이 가려진다.
    await setValue(opened, "service_key", SECOND, {
      sealed_ref: first.ref,
      revision: first.revision,
    });
    const replaced = await readText(opened.core, version);
    assert(replaced?.includes(FIRST), "교체된 옛 값이 계속 가려진다");
    assert(!replaced?.includes(SECOND), "새 값이 가려지지 않았다");
    const replacedBody = await chat.say(`옛 ${FIRST} 새 ${SECOND}`);
    assert(replacedBody.includes(FIRST), "메시지: 옛 값이 계속 가려진다");
    assert(!replacedBody.includes(SECOND), "메시지: 새 값이 가려지지 않았다");

    // 제거: 마지막 값도 회수된다.
    await removeValue(
      opened,
      "service_key",
      currentRef(opened.home, "service_key")!,
    );
    assertEquals(currentRef(opened.home, "service_key"), undefined);
    const removed = await readText(opened.core, version);
    assert(removed?.includes(FIRST) && removed.includes(SECOND));
    const removedBody = await chat.say(`둘 다 ${FIRST} ${SECOND}`);
    assert(removedBody.includes(FIRST) && removedBody.includes(SECOND));
  } finally {
    await close(opened);
  }
});

async function* walk(root: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) yield* walk(path);
    else if (entry.isFile) yield path;
  }
}

function contains(haystack: Uint8Array, needle: string): boolean {
  const target = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + target.length <= haystack.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

Deno.test("platform/secrets#R1 platform/secrets#R2: 값은 ledger·log·argv·환경 변수·JSON 제어 frame 어디에도 없고 byte chunk로만 I/O worker에 간다", async () => {
  const opened = await open();
  try {
    await seed(opened);
    const chat = await Conversation.open(opened.core);
    await setValue(opened, "service_key", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    await chat.say(`본문에 ${FIRST}`);
    // 데이터 root의 모든 파일(ledger, WAL, 로그, blob)에 값이 없다.
    for await (const path of walk(opened.home)) {
      // 시험이 심은 문서의 파생 색인(documents.sqlite*)은 문서 본문을 담는 것이 그 일이다.
      if (path.includes("/derived/documents.sqlite")) continue;
      assert(
        !contains(await Deno.readFile(path), FIRST),
        `값이 파일에 남았다: ${path.slice(opened.home.length)}`,
      );
    }
    // 감독이 띄운 child의 argv·환경에도 없다.
    for (const request of opened.io.requests) {
      assert(!JSON.stringify(request).includes(FIRST));
    }
    // core가 I/O worker에 쓴 frame: 값은 bytes frame에만 있고 JSON 제어 frame에는 없다.
    const decoder = new FrameDecoder();
    let inBytes = 0;
    for (const chunk of opened.io.stdin) {
      for (const frame of decoder.push(chunk)) {
        if (frame.kind === "json") {
          assert(!JSON.stringify(frame.payload).includes(FIRST));
        } else if (frame.kind === "bytes" && contains(frame.payload, FIRST)) {
          inBytes++;
        }
      }
    }
    assertEquals(inBytes, 1, "값은 byte chunk frame 하나로만 간다");
  } finally {
    await close(opened);
  }
});

Deno.test("platform/secrets#R8: keychain이 없으면 보호 입력만 unavailable이고 증거도 남지 않으며 풀리면 다시 된다", async () => {
  const opened = await open();
  try {
    opened.keychain.setStatus("unavailable");
    const refused = await inputValue(opened.core, "service_key", FIRST);
    const body = await refused.json() as { error?: { code: string } };
    assertEquals(refused.status, 503, JSON.stringify(body));
    assertEquals(preparationRows(opened.home), 0);
    assertEquals(opened.keychain.stored.size, 0);
    opened.keychain.setStatus("available");
    const accepted = await inputValue(opened.core, "service_key", FIRST);
    assertEquals(accepted.status, 200, await accepted.clone().text());
    assertEquals(preparationRows(opened.home), 1);
    assertEquals(opened.keychain.stored.size, 1);
  } finally {
    await close(opened);
  }
});

Deno.test("platform/secrets#R2: 선언한 크기와 다른 body는 keychain에 아무것도 두지 않는다", async () => {
  const opened = await open();
  try {
    const wrong = await inputValue(
      opened.core,
      "service_key",
      FIRST,
      FIRST.length + 3,
    );
    assertEquals(wrong.status, 400, await wrong.clone().text());
    assertEquals(preparationRows(opened.home), 0);
    assertEquals(opened.keychain.stored.size, 0);
  } finally {
    await close(opened);
  }
});

// provider credential(lophn-agent 소유 ledger 표)의 값도 같은 보호 입력으로 넣고 같은 registry에
// 등록·회수된다. 참조를 확정하는 command는 provider의 command이고 core는 그 owner의 참조를 읽는다.
// provider에는 credential이 하나라 값을 바꾸려면 Disconnect 뒤 다시 Connect한다.
Deno.test("platform/secrets#R1 platform/redaction#R1: provider credential의 값도 Connect로 알려진 값이 되고 Disconnect하면 회수된다", async () => {
  const opened = await open();
  try {
    const version = await seed(opened);
    const provider = id("pvd", 1);
    const prepare = async (value: string) => {
      const response = await inputValue(
        opened.core,
        provider,
        value,
        undefined,
        "provider_credential",
      );
      const evidence = await response.json() as Preparation;
      assertEquals(response.status, 200, JSON.stringify(evidence));
      return evidence;
    };
    const connect = async (value: string, key: string) => {
      const response = await post(opened.core, "providers/register", {
        input: {
          id: provider,
          name: "Anthropic",
          definition: ANTHROPIC,
          endpoint: "https://api.anthropic.com",
          protocol: "anthropic-messages",
          credential: { kind: "api_key", preparation: await prepare(value) },
        },
        idempotency_key: key,
        compare: {},
        prepared: [],
      });
      const body = await response.json() as { provider: { revision: number } };
      assertEquals(response.status, 200, JSON.stringify(body));
      return body.provider.revision;
    };

    const revision = await connect(FIRST, "connect-1");
    const masked = await readText(opened.core, version);
    assert(
      !masked?.includes(FIRST),
      "provider credential 값이 가려지지 않았다",
    );
    assert(masked?.includes(SECOND));

    // Disconnect: 확인 창을 거쳐 provider와 credential을 지우고 옛 값을 회수한다.
    const input = { provider };
    const disconnected = await post(opened.core, "providers/disconnect", {
      input,
      idempotency_key: "disconnect-1",
      compare: { revision },
      prepared: [],
      confirmation: await handleFor(opened.core, disconnectProvider, input),
    });
    assertEquals(disconnected.status, 200, await disconnected.clone().text());
    const revoked = await readText(opened.core, version);
    assert(revoked?.includes(FIRST), "Disconnect한 옛 값이 계속 가려진다");

    // 같은 ID로 다시 Connect하면 새 값이 알려진다.
    await connect(SECOND, "connect-2");
    const replaced = await readText(opened.core, version);
    assert(replaced?.includes(FIRST), "옛 값이 다시 가려진다");
    assert(!replaced?.includes(SECOND), "새 값이 가려지지 않았다");
  } finally {
    await close(opened);
  }
});

Deno.test("platform/secrets#R8 lophn-agent/conversation#R2: keychain이 잠긴 채 core가 다시 뜨면 메시지 본문은 값을 모른 채 저장되지 않고 풀리면 값을 가린다", async () => {
  const opened = await open();
  let core: Core | undefined;
  try {
    await setValue(opened, "service_key", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    await opened.core.shutdown();
    // 값을 읽지 못하면 알려진 값을 다 모르는 것이다. 모르는 채로 원문을 저장하지 않는다.
    opened.keychain.setStatus("unavailable");
    core = (await boot(opened.home, opened.keychain, true)).core;
    const locked = await Conversation.open(core, 2);
    const refused = await locked.sayRaw(`잠긴 동안 ${FIRST}`);
    assertEquals(refused.status, 503, JSON.stringify(refused.body));
    // 풀리면 재시도가 값을 다시 읽어 등록하고, 본문은 값을 가린다.
    opened.keychain.setStatus("available");
    const deadline = Date.now() + 15_000;
    let again = await locked.sayRaw(`풀린 뒤 ${FIRST}`);
    while (again.status !== 200 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      again = await locked.sayRaw(`풀린 뒤 ${FIRST}`);
    }
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assert(!(await locked.bodyOf(again.message)).includes(FIRST));
  } finally {
    opened.store.close();
    await core?.shutdown();
    await Deno.remove(opened.home, { recursive: true });
  }
});

// ---- provider Disconnect와 OS keychain [agent-I53] ----

// 보호 입력 → RegisterProvider까지 사람이 하는 Connect.
async function connectValue(
  opened: Opened,
  provider: string,
  value: string,
  key: string,
): Promise<{ ref: string; revision: number }> {
  const response = await inputValue(
    opened.core,
    provider,
    value,
    undefined,
    "provider_credential",
  );
  const evidence = await response.json() as Preparation;
  assertEquals(response.status, 200, JSON.stringify(evidence));
  const registered = await post(opened.core, "providers/register", {
    input: {
      id: provider,
      name: "Anthropic",
      definition: ANTHROPIC,
      endpoint: "https://api.anthropic.com",
      protocol: "anthropic-messages",
      credential: { kind: "api_key", preparation: evidence },
    },
    idempotency_key: key,
    compare: {},
    prepared: [],
  });
  const body = await registered.json() as { provider: { revision: number } };
  assertEquals(registered.status, 200, JSON.stringify(body));
  return { ref: evidence.sealed_ref, revision: body.provider.revision };
}

// 확인 창을 거친 Disconnect.
async function disconnectValue(
  opened: Opened,
  provider: string,
  revision: number,
  key: string,
): Promise<void> {
  const input = { provider };
  const response = await post(opened.core, "providers/disconnect", {
    input,
    idempotency_key: key,
    compare: { revision },
    prepared: [],
    confirmation: await handleFor(opened.core, disconnectProvider, input),
  });
  assertEquals(response.status, 200, await response.clone().text());
}

function storedValues(keychain: FakeKeychain): string[] {
  return [...keychain.stored.values()].map((bytes) =>
    new TextDecoder().decode(bytes)
  ).sort();
}

Deno.test("lophn-agent/harness/provider#R6 platform/secrets#R7 [agent-I53]: Disconnect하면 응답 전에 그 provider의 secret이 OS keychain에서 지워지고 다른 provider의 secret은 남는다", async () => {
  const opened = await open();
  try {
    const first = await connectValue(opened, id("pvd", 1), FIRST, "connect-1");
    const second = await connectValue(
      opened,
      id("pvd", 2),
      SECOND,
      "connect-2",
    );
    assertEquals(storedValues(opened.keychain), [FIRST, SECOND].sort());

    await disconnectValue(opened, id("pvd", 1), first.revision, "disconnect-1");

    assertEquals(opened.keychain.stored.has(first.ref), false);
    assert(opened.keychain.stored.has(second.ref));
    assertEquals(storedValues(opened.keychain), [SECOND]);
  } finally {
    await close(opened);
  }
});

Deno.test("lophn-agent/harness/provider#R6 platform/secrets#R1 platform/secrets#R6 [agent-I53b]: keychain 삭제가 실패해도 Disconnect는 확정이고 재기동만으로는 keychain을 열지 않으며 새 Connect가 연 뒤 주기 쓸기가 남은 secret을 지운다", async () => {
  const opened = await open();
  let core: Core | undefined;
  try {
    const first = await connectValue(opened, id("pvd", 1), FIRST, "connect-1");

    // ledger는 확정이지만 OS 삭제는 확인되지 않는다. 이 사실을 지운 것으로 꾸미지 않는다(R7).
    opened.keychain.holdRemovals(true);
    await disconnectValue(opened, id("pvd", 1), first.revision, "disconnect-1");
    assert(opened.keychain.stored.has(first.ref), "삭제 실패가 숨겨졌다");

    // keychain이 풀린 뒤 core가 다시 떠도 참조가 없으면 keychain을 열지 않아 남은 값은 그대로다(R1).
    opened.keychain.holdRemovals(false);
    opened.keychain.confirmRemovals();
    await opened.core.shutdown();
    core = (await boot(opened.home, opened.keychain, true, 100)).core;
    assert(opened.keychain.stored.has(first.ref), "재기동이 keychain을 열었다");

    // 새 Connect가 keychain을 열면 주기 쓸기가 ledger가 가리키지 않는 값을 두 번 연속 본 뒤 지운다.
    const other = await connectValue(
      { ...opened, core },
      id("pvd", 2),
      SECOND,
      "connect-2",
    );
    const deadline = Date.now() + 15_000;
    while (opened.keychain.stored.has(first.ref) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assertEquals(opened.keychain.stored.has(first.ref), false);
    // ledger가 가리키는 값은 건드리지 않는다.
    assert(opened.keychain.stored.has(other.ref));
  } finally {
    opened.store.close();
    await core?.shutdown();
    await Deno.remove(opened.home, { recursive: true });
  }
});

Deno.test("lophn-agent/harness/provider#R8 [agent-I53]: Disconnect 뒤 같은 ID로 다시 Connect하면 새 secret만 keychain에 있고 옛 secret은 없다", async () => {
  const opened = await open();
  try {
    const provider = id("pvd", 1);
    const first = await connectValue(opened, provider, FIRST, "connect-1");
    await disconnectValue(opened, provider, first.revision, "disconnect-1");
    assertEquals(storedValues(opened.keychain), []);

    const second = await connectValue(opened, provider, SECOND, "connect-2");
    assertEquals(opened.keychain.stored.has(first.ref), false);
    assertEquals(storedValues(opened.keychain), [SECOND]);
    assert(opened.keychain.stored.has(second.ref));
    assert(first.ref !== second.ref);
  } finally {
    await close(opened);
  }
});

// agent runtime(machine 자격)만 ProviderDisconnected를 따라 읽어 진행 run을 회수한다. 사람·agent·app은
// 이 event를 보지 못한다(run 접수·시작·끝남과 같은 공개 범위).
Deno.test("lophn-agent/harness/provider#R4 [agent-I53]: ProviderDisconnected event는 machine 자격만 읽고 사람 자격에는 보이지 않는다", async () => {
  const opened = await open();
  try {
    const machineToken = "m".repeat(43);
    const userToken = "u".repeat(43);
    const credentials: [AuthenticatedContext, string][] = [
      [{
        principal: "machine:agent-runtime",
        actor: "machine",
        scope: { operations: ["ListEvents"], targets: {} },
        conditions: {},
        credential_ref: "cred-machine-events",
      }, machineToken],
      [{
        principal: "user-2",
        actor: "user",
        scope: { operations: ["ListEvents"], targets: {} },
        conditions: {},
        credential_ref: "cred-user-events",
      }, userToken],
    ];
    for (const [context, token] of credentials) {
      assert((await opened.core.acceptTestCredential?.(context, token))?.ok);
      assert((await opened.core.record(context)).ok);
    }
    const provider = id("pvd", 1);
    const first = await connectValue(opened, provider, FIRST, "connect-1");
    await disconnectValue(opened, provider, first.revision, "disconnect-1");

    const list = async (token: string) => {
      const response = await fetch(
        `http://127.0.0.1:${opened.core.port}/v1/events/list`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            after_seq: "0",
            types: ["ProviderDisconnected"],
          }),
        },
      );
      const body = await response.json() as {
        events: { type: string; subject: string }[];
      };
      assertEquals(response.status, 200, JSON.stringify(body));
      return body.events;
    };
    assertEquals(
      (await list(machineToken)).map((event) => [event.type, event.subject]),
      [["ProviderDisconnected", provider]],
    );
    assertEquals(await list(userToken), []);
  } finally {
    await close(opened);
  }
});
