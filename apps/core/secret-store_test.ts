// platform/secrets#R1, platform/redaction#R1, documents/outline-and-search#R8: 제품 core가 secret
// store를 열어 알려진 값 registry를 채우고, documents의 제품 redactor가 pattern 검출에 더해
// 그 값도 가린다. keychain은 fake adapter다(사람의 실제 keychain에 닿지 않는다). core,
// reader Worker는 실제고 데이터 root는 temp dir다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import {
  removeSecret,
  setSecret,
} from "../../packages/protocol/platform/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "../../packages/core/projects/outline-and-search/adapters/store.ts";
import { recordExtraction } from "../../packages/core/projects/outline-and-search/extraction.ts";
import { confirmationBinding } from "../../packages/core/server/identity/mod.ts";
import {
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/core/secrets/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const teams: TeamModule[] = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const AT = Date.UTC(2024, 0, 1);
const TOKEN = "d".repeat(43);
const FIRST = "correct-horse-battery-staple-9";
const SECOND = "second-secret-value-77";
const OPERATIONS = [
  "document.save",
  "document.prepare",
  "document.read",
  "SetSecret",
  "RemoveSecret",
];

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
};

async function startAt(
  home: string,
  keychain: FakeKeychain,
  restart: boolean,
): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(restart ? 17 : 5),
    testCredentials: true,
    superviseIo: false,
    secretKeychain: keychain,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-secret",
  };
  const accepted = await core.acceptTestCredential?.(context, TOKEN);
  assert(accepted?.ok);
  if (!restart) {
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  guard.keep();
  return core;
}

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-secret-store-" });
  const keychain = createFakeKeychain();
  const core = await startAt(home, keychain, false);
  await using guard = closeUnlessKept(async () => {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const store = openDerived(derivedPath(`${home}/derived`));
  assert(store.ok, store.ok ? "" : store.error.message);
  guard.keep();
  return { core, home, keychain, store: store.value };
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

// 문서를 저장하고 그 판의 추출 결과를 파생 store에 심는다(documents-served_test와 같은 길).
async function seed(opened: Opened): Promise<string> {
  assert(opened.core.notePrepared);
  for (
    const [preparation, purpose] of [
      ["prep-secret-1", "document_files"],
      ["prep-file-secret-1", "document_file"],
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
      preparation_ref: "prep-secret-1",
      files: [{
        path: "a.md",
        blob_hash: HASH,
        bytes: 10,
        media_type: "text/markdown",
        primary: true,
        preparation_ref: "prep-file-secret-1",
      }],
      idempotency_key: "secret-1",
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
    idempotency_key: "secret-1",
    compare: { base_version: null },
    prepared: ["prep-secret-1"],
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

async function readText(
  core: Core,
  version: string,
): Promise<{ status: number; text: string | null; omission: string | null }> {
  const read = await post(core, "documents/read", {
    reference: { document: DOC, version, section: null },
  });
  const body = await read.json() as {
    text?: string | null;
    omission_reason?: string | null;
  };
  return {
    status: read.status,
    text: body.text ?? null,
    omission: body.omission_reason ?? null,
  };
}

// 보호 입력이 끝난 상태를 만든다: keychain에 값을 두고 준비 증거를 ledger에 남긴다. 제품의
// 보호 입력 pipe(`secret.prepare`)가 하는 일이다.
async function prepare(
  opened: Opened,
  name: string,
  value: string,
): Promise<{ preparation: string; sealed_ref: string }> {
  const stored = await opened.keychain.store({
    name,
    purpose: "app_secret",
    owner: name,
    value: new TextEncoder().encode(value),
  });
  assert(stored.ok);
  const preparation = `prep-${crypto.randomUUID()}`;
  const db = new DatabaseSync(`${opened.home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      "INSERT INTO secret_preparations (preparation, sealed_ref, purpose, owner) VALUES (?, ?, 'app_secret', ?)",
    ).run(preparation, stored.value, name);
  } finally {
    db.close();
  }
  return { preparation, sealed_ref: stored.value };
}

// 사람 결정 handle을 발급한다(secret_input 확인).
async function handleFor(
  core: Core,
  route: typeof setSecret | typeof removeSecret,
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

async function setValue(
  opened: Opened,
  name: string,
  value: string,
  compare: { sealed_ref: string | null; revision: number | null },
): Promise<{ ref: string; revision: number }> {
  const made = await prepare(opened, name, value);
  const input = {
    name,
    preparation: {
      preparation: made.preparation,
      sealed_ref: made.sealed_ref,
      purpose: "app_secret",
      owner: name,
    },
  };
  const response = await post(opened.core, "secrets/set", {
    input,
    idempotency_key: `set-${crypto.randomUUID()}`,
    compare,
    prepared: [],
    confirmation: await handleFor(opened.core, setSecret, input),
  });
  const body = await response.json() as { revision?: number };
  assertEquals(response.status, 200, JSON.stringify(body));
  return { ref: made.sealed_ref, revision: body.revision! };
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

async function close(opened: Opened) {
  opened.store.close();
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
}

Deno.test("platform/redaction#R1 documents/outline-and-search#R8: 등록한 secret 값은 documents 읽기 출력에서 가려지고 회수하면 알려진 값이 아니다", async () => {
  const opened = await open();
  try {
    const version = await seed(opened);
    // 알려진 값이 없으면 pattern에 걸리지 않는 값은 그대로 나온다.
    const before = await readText(opened.core, version);
    assertEquals(before.status, 200);
    assert(before.text?.includes(FIRST), "등록 전에는 pattern에 걸리지 않는다");

    // 사람이 secret을 등록하면(SetSecret) 응답 전에 reader가 그 값을 안다.
    const first = await setValue(opened, "first_secret", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    const masked = await readText(opened.core, version);
    assertEquals(masked.status, 200);
    assert(masked.text !== null);
    assert(!masked.text.includes(FIRST), "등록한 값이 출력에 남았다");
    assert(masked.text.includes(SECOND), "등록하지 않은 값은 그대로다");
    assert(masked.text.includes("*"));

    // 교체: 옛 값은 알려진 값에서 빠지고 새 값이 알려진다.
    await setValue(opened, "first_secret", SECOND, {
      sealed_ref: first.ref,
      revision: first.revision,
    });
    const replaced = await readText(opened.core, version);
    assert(replaced.text !== null);
    assert(
      replaced.text.includes(FIRST),
      "교체된 옛 값은 더 이상 알려진 값이 아니다",
    );
    assert(!replaced.text.includes(SECOND), "새 값이 알려지지 않았다");

    // 제거: 마지막 값도 회수된다.
    const current = (() => {
      const db = new DatabaseSync(`${opened.home}/lophn.db`, {
        readOnly: true,
      });
      try {
        return db.prepare(
          "SELECT sealed_ref, revision FROM secrets WHERE name = 'first_secret'",
        ).get() as { sealed_ref: string; revision: number };
      } finally {
        db.close();
      }
    })();
    await removeValue(opened, "first_secret", current);
    const revoked = await readText(opened.core, version);
    assert(revoked.text?.includes(FIRST));
    assert(revoked.text?.includes(SECOND), "회수한 값이 계속 가려진다");
  } finally {
    await close(opened);
  }
});

Deno.test("platform/redaction#R1: 두 이름이 같은 값을 쥐면 하나를 회수해도 다른 하나가 알려진 채 남는다", async () => {
  const opened = await open();
  try {
    const version = await seed(opened);
    const a = await setValue(opened, "shared_a", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    await setValue(opened, "shared_b", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    await removeValue(opened, "shared_a", {
      sealed_ref: a.ref,
      revision: a.revision,
    });
    const read = await readText(opened.core, version);
    assert(read.text !== null);
    assert(!read.text.includes(FIRST), "남은 이름의 값은 계속 가려진다");
  } finally {
    await close(opened);
  }
});

Deno.test("platform/secrets#R8 platform/redaction#R1: core를 다시 띄우면 참조의 값을 keychain에서 다시 읽어 등록하고 keychain이 잠겨 있는 동안은 원문을 내보내지 않는다", async () => {
  const opened = await open();
  let core: Core | undefined;
  try {
    const version = await seed(opened);
    await setValue(opened, "restart_secret", FIRST, {
      sealed_ref: null,
      revision: null,
    });
    await opened.core.shutdown();
    // keychain이 잠긴 채 다시 뜬다. 값을 읽지 못하므로 알려진 값을 모르는 채 원문을 내보내지
    // 않는다(unavailable). 파일 볼트·환경 변수 fallback은 없다.
    opened.keychain.setStatus("unavailable");
    core = await startAt(opened.home, opened.keychain, true);
    const locked = await readText(core, version);
    assertEquals(locked.status, 200);
    assertEquals(locked.text, null);
    assertEquals(locked.omission, "redaction_failed");
    // 풀리면 재시도가 값을 다시 읽어 등록하고 출력은 값을 가린다.
    opened.keychain.setStatus("available");
    const deadline = Date.now() + 15_000;
    let again = await readText(core, version);
    while (again.text === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      again = await readText(core, version);
    }
    assertEquals(again.status, 200);
    assert(again.text !== null);
    assert(!again.text.includes(FIRST));
    assert(again.text.includes(SECOND));
  } finally {
    opened.store.close();
    await core?.shutdown();
    await Deno.remove(opened.home, { recursive: true });
  }
});

Deno.test("platform/secrets#R1: secret 참조가 없는 core는 keychain을 열지 않고 기동한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-secret-store-none-" });
  let touched = 0;
  const keychain = createFakeKeychain();
  const counting = new Proxy(keychain, {
    get(target, property, receiver) {
      if (property === "status" || property === "load") touched++;
      return Reflect.get(target, property, receiver);
    },
  });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(AT),
    random: seededRandom(5),
    testCredentials: true,
    superviseIo: false,
    secretKeychain: counting,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  try {
    assertEquals(touched, 0);
  } finally {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
