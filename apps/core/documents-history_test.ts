// documents/outline-and-search#R19·R20·R21, documents/versions#R10: section 이력·diff·restore를
// 실제 core(reader Worker, 명령 writer), documents worker(format 검사), I/O worker(blob)에서
// 본다. 판은 coding agent가 실제 upload·prepare·save로 쌓고, restore는 사람이 옛 판의 원문
// blob 참조로 준비(prepare)한 뒤 `document.restore`로 확정한다. 추출 결과는 실제 document
// format module(`extractFormat`)이 만든 section·본문을 파생 store에 심는다(consumer 조립은
// documents#T21). 데이터 root·작업 폴더는 temp dir고 사람 데이터 root는 열지 않는다.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  diffPageSchema,
  documentPrepare,
  documentSave,
  documentUpload,
  FORMAT_CHECK_CONTENT_MAX_BYTES,
  sectionHistoryPageSchema,
} from "../../packages/contracts/documents/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { extractFormat } from "../../packages/documents/formats/guest.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "../../packages/documents/outline-and-search/adapters/store.ts";
import {
  type ExtractionRecord,
  recordExtraction,
} from "../../packages/documents/outline-and-search/extraction.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const PLACE = { kind: "project" as const, id: PROJECT };
const OTHER = "doc_01arz3ndektsv4rrffq69g5faw";
const ABSENT = "doc_01arz3ndektsv4rrffq69g5fb9";
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "b".repeat(43);
const LIMITED_TOKEN = "c".repeat(43);
const USER_OPERATIONS = [
  "project.create",
  "document.get",
  "document.history",
  "document.file",
  "document.section_history",
  "document.diff",
  "document.prepare",
  "document.restore",
];

type Opened = {
  core: Core;
  home: string;
  work: string;
  store: DerivedStore;
  dispose(): Promise<void>;
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-history-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-history-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(41),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const contexts: [AuthenticatedContext, string][] = [
    [{
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}`,
      scope: {
        operations: [
          "document.upload",
          "document.prepare",
          "document.save",
          "document.list",
          "document.get",
          "document.history",
          "format.list",
          "format.get",
          "format.validate",
        ],
        targets: {},
      },
      conditions: {},
      credential_ref: "cred-agent",
    }, AGENT_TOKEN],
    [{
      principal: "user",
      actor: "user",
      scope: { operations: USER_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: "cred-user",
    }, USER_TOKEN],
    // 이 문서와 다른 문서만 닿는 자격이다. 이 문서는 없는 것과 같아야 한다.
    [{
      principal: "user",
      actor: "user",
      scope: { operations: USER_OPERATIONS, targets: { document: OTHER } },
      conditions: {},
      credential_ref: "cred-limited",
    }, LIMITED_TOKEN],
  ];
  for (const [context, token] of contexts) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const store = openDerived(derivedPath(`${home}/derived`));
  assert(store.ok, store.ok ? "" : store.error.message);
  return {
    core,
    home,
    work,
    store: store.value,
    async dispose() {
      store.value.close();
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

function post(
  opened: Opened,
  path: string,
  body: unknown,
  token = USER_TOKEN,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${opened.core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function ok200<T>(
  opened: Opened,
  path: string,
  body: unknown,
  token = USER_TOKEN,
): Promise<T> {
  const response = await post(opened, path, body, token);
  const text = await response.text();
  assertEquals(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text) as T;
}

async function createProject(opened: Opened) {
  await ok200(opened, "projects/create", {
    input: {
      id: PROJECT,
      name: "mahas",
      title: "Notes",
      purpose: "",
      folders: [{ path: "/tmp/lophn-test-history", description: "" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "project-1",
    compare: {},
    prepared: [],
  });
}

type Saved = { document: string; version: string; text: string };

// coding agent가 plan.md를 실제 upload·prepare·save로 저장한다. 같은 자리·slug는 같은 문서다.
async function savePlan(opened: Opened, text: string): Promise<Saved> {
  await Deno.writeTextFile(`${opened.work}/plan.md`, text);
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  const saved = await saveFromPaths(
    {
      client,
      scope: { root: opened.work, forbidden: [opened.home] },
      prepareBytes: uploadPrepareBytes(client),
    },
    { paths: ["plan.md"], place: PLACE, slug: "plan" },
  );
  assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
  return {
    document: saved.value.saved.document,
    version: saved.value.saved.version,
    text,
  };
}

type Fixed = {
  document: { revision: string; latest_version: string; title: string };
  version: {
    id: string;
    number: number;
    content_hash: string;
    format: { name: string; module_hash: string; explicit: boolean };
    files: {
      path: string;
      blob_hash: string;
      bytes: number;
      media_type: string;
      primary: boolean;
    }[];
  };
};

function fixedOf(opened: Opened, saved: Saved): Promise<Fixed> {
  return ok200<Fixed>(opened, "documents/get", {
    document: saved.document,
    version: saved.version,
  });
}

// 실제 document format module이 낸 section·본문을 파생 store에 심는다. status를 주면
// consumer가 확인하지 못한 판(검사 한도 초과 등)처럼 section 없이 그 상태만 심는다.
async function extract(
  opened: Opened,
  saved: Saved,
  status: "ready" | "unverified" = "ready",
): Promise<void> {
  const fixed = await fixedOf(opened, saved);
  const bytes = new TextEncoder().encode(saved.text);
  const result = extractFormat("document", {
    input_hash: createHash("sha256").update(bytes).digest("hex"),
    module_hash: fixed.version.format.module_hash,
    files: [{
      path: "plan.md",
      media_type: "text/markdown",
      primary: true,
      content: Array.from(bytes),
    }],
  });
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  const record: ExtractionRecord = {
    document: saved.document,
    version: saved.version,
    content_hash: fixed.version.content_hash,
    module_hash: fixed.version.format.module_hash,
    extraction: status === "ready"
      ? {
        status: "ready",
        title: result.title ?? undefined,
        text: result.text,
        text_hash: result.text_hash,
        sections: result.sections,
      }
      : { status: "unverified" },
  };
  const written = recordExtraction(opened.store, record, "1");
  assert(written.ok, written.ok ? "" : written.error.message);
  const cursor = opened.store.transaction((tx) =>
    ok(tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
      ["1"],
    ))
  );
  assert(cursor.ok);
}

const V1 = "# 계획서\n\n## 개요\n그대로 두는 개요\n\n## 계획\n처음 계획\n";
const V2 =
  "# 계획서\n\n## 개요\n그대로 두는 개요\n\n## 계획\n고친 계획\n첫 보강\n";
const V3 = "# 계획서\n\n## 개요\n개요도 고침\n\n## 계획\n고친 계획\n첫 보강\n";

// 세 판을 쌓고 각각 실제 추출한다.
async function history(opened: Opened) {
  await createProject(opened);
  const one = await savePlan(opened, V1);
  const two = await savePlan(opened, V2);
  const three = await savePlan(opened, V3);
  assertEquals(one.document, two.document);
  assertEquals(two.document, three.document);
  for (const saved of [one, two, three]) await extract(opened, saved);
  return { one, two, three, document: one.document };
}

type SectionHistoryBody = {
  entries: {
    version: string;
    status: string;
    before: { version: string } | null;
  }[];
  omissions: { version: string; reason: string }[];
  complete: boolean;
};

Deno.test("documents/outline-and-search#R19: 실제 core의 section 이력은 같은 key의 추가·본문 수정·변경 없음을 판마다 낸다", async () => {
  const opened = await open();
  try {
    const { one, two, three, document } = await history(opened);
    const plan = await ok200<SectionHistoryBody>(
      opened,
      "documents/section_history",
      { document, section: "계획" },
    );
    assert(sectionHistoryPageSchema.safeParse(plan).success);
    assertEquals(
      plan.entries.map((entry) => [entry.version, entry.status]),
      [
        [one.version, "added"],
        [two.version, "modified"],
        [three.version, "unchanged"],
      ],
    );
    const overview = await ok200<SectionHistoryBody>(
      opened,
      "documents/section_history",
      { document, section: "개요" },
    );
    assertEquals(
      overview.entries.map((entry) => entry.status),
      ["added", "unchanged", "modified"],
    );
    // 중간 판부터 잘라도 첫 행은 직전 판과 비교한다.
    const cropped = await ok200<SectionHistoryBody>(
      opened,
      "documents/section_history",
      { document, section: "계획", from: two.version },
    );
    assertEquals(
      cropped.entries.map((entry) => [entry.version, entry.status]),
      [[two.version, "modified"], [three.version, "unchanged"]],
    );
    assertEquals(cropped.entries[0].before?.version, one.version);
  } finally {
    await opened.dispose();
  }
});

type DiffBody = {
  additions: {
    range: { start_line: number; end_line: number };
    text: string;
  }[];
  deletions: {
    range: { start_line: number; end_line: number };
    text: string;
  }[];
  omissions: { version: string; reason: string }[];
  complete: boolean;
};

Deno.test("documents/outline-and-search#R21: 실제 core의 diff는 두 판 전체와 선택 section의 추가·삭제 줄을 낸다", async () => {
  const opened = await open();
  try {
    const { one, two, three, document } = await history(opened);
    const whole = await ok200<DiffBody>(opened, "documents/diff", {
      document,
      before: one.version,
      after: two.version,
    });
    assert(diffPageSchema.safeParse(whole).success);
    assertEquals(whole.deletions, [{
      range: { start_line: 7, end_line: 7 },
      text: "처음 계획",
    }]);
    assertEquals(whole.additions, [{
      range: { start_line: 7, end_line: 8 },
      text: "고친 계획\n첫 보강",
    }]);
    assertEquals(whole.complete, true);
    // 선택 section은 그 section 줄만 비교한다: 3번 판의 개요 수정은 계획의 diff가 아니다.
    const plan = await ok200<DiffBody>(opened, "documents/diff", {
      document,
      before: two.version,
      after: three.version,
      section: "계획",
    });
    assertEquals([plan.additions, plan.deletions, plan.omissions], [
      [],
      [],
      [],
    ]);
    const overview = await ok200<DiffBody>(opened, "documents/diff", {
      document,
      before: two.version,
      after: three.version,
      section: "개요",
    });
    assertEquals(overview.deletions.map((change) => change.text), [
      "그대로 두는 개요",
    ]);
    assertEquals(overview.additions.map((change) => change.text), [
      "개요도 고침",
    ]);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/outline-and-search#R22: 검사 한도(1 MiB)를 넘어 확인하지 못한 큰 판은 section도 본문도 추정하지 않고 누락으로 밝힌다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const one = await savePlan(opened, V1);
    await extract(opened, one);
    // 실제로 1 MiB를 넘는 판. consumer는 이런 판의 추출을 확인하지 못한 판으로 남긴다.
    const big = `${V1}${"한 줄\n".repeat(400_000)}`;
    assert(new TextEncoder().encode(big).length > 1024 * 1024);
    const two = await savePlan(opened, big);
    await extract(opened, { ...two, text: V1 }, "unverified");
    const page = await ok200<SectionHistoryBody>(
      opened,
      "documents/section_history",
      { document: one.document, section: "계획" },
    );
    assertEquals(page.entries.map((entry) => entry.status), ["added"]);
    assertEquals(page.omissions.map((item) => item.version), [two.version]);
    const diff = await ok200<DiffBody>(opened, "documents/diff", {
      document: one.document,
      before: one.version,
      after: two.version,
    });
    assertEquals([diff.additions, diff.deletions], [[], []]);
    assertEquals(diff.omissions.map((item) => item.version), [two.version]);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/outline-and-search#R19: 권한 밖 문서의 이력·diff는 없는 문서와 같은 답이다", async () => {
  const opened = await open();
  try {
    const { one, two, document } = await history(opened);
    const pairs: [string, unknown, unknown][] = [
      [
        "documents/section_history",
        { document, section: "계획" },
        { document: ABSENT, section: "계획" },
      ],
      [
        "documents/diff",
        { document, before: one.version, after: two.version },
        { document: ABSENT, before: one.version, after: two.version },
      ],
    ];
    for (const [path, hidden, absent] of pairs) {
      const first = await post(opened, path, hidden, LIMITED_TOKEN);
      const second = await post(opened, path, absent, LIMITED_TOKEN);
      assert(first.status >= 400, path);
      assertEquals(first.status, second.status, path);
      assertEquals(await first.json(), await second.json(), path);
    }
  } finally {
    await opened.dispose();
  }
});

function ledgerEvents(home: string): string[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return (db.prepare("SELECT type FROM events ORDER BY seq").all() as {
      type: string;
    }[]).map((row) => row.type);
  } finally {
    db.close();
  }
}

type Prepared = { preparation_ref: string } & Record<string, unknown>;

// 사람이 옛 판의 원문 blob 참조로 restore를 준비한다(prepare). 형식은 그 판의 정확한 FormatRef다.
async function prepareRestore(
  opened: Opened,
  fixed: Fixed,
  document: string,
  base: string,
  key: string,
): Promise<Response> {
  return await post(opened, "documents/prepare", {
    document,
    base_version: base,
    files: fixed.version.files.map((file) => ({
      ...file,
      content: {
        kind: "existing",
        reference: {
          owner_kind: "document_version",
          owner_key: `${fixed.version.id}/${file.path}`,
          field: "file",
          hash: file.blob_hash,
          registered_seq: "1",
        },
      },
    })),
    format: fixed.version.format,
    source: null,
    idempotency_key: key,
  });
}

async function restoreOf(
  opened: Opened,
  document: string,
  selected: Saved,
  key: string,
): Promise<{ status: string; version: string; event_seq: string | null }> {
  const fixed = await fixedOf(opened, selected);
  const latest = await ok200<Fixed>(opened, "documents/get", { document });
  const prepared = await prepareRestore(
    opened,
    fixed,
    document,
    latest.document.latest_version,
    key,
  );
  const preparedText = await prepared.text();
  assertEquals(prepared.status, 200, preparedText);
  const body = JSON.parse(preparedText) as Prepared;
  return await ok200(opened, "documents/restore", {
    input: {
      document,
      restore_version: selected.version,
      prepared: body,
    },
    idempotency_key: key,
    compare: {
      base_version: latest.document.latest_version,
      base_revision: latest.document.revision,
    },
    prepared: [body.preparation_ref],
  });
}

Deno.test("documents/versions#R10: 실제 core에서 1번 판으로 restore하면 새 최신 판이 1번 내용이고 이전 판과 원문은 그대로며 반복하면 판이 늘지 않는다", async () => {
  const opened = await open();
  try {
    const { one, two, three, document } = await history(opened);
    const events = ledgerEvents(opened.home).length;
    const restored = await restoreOf(opened, document, one, "restore-1");
    assertEquals(restored.status, "saved");
    const list = await ok200<{ versions: { id: string; number: number }[] }>(
      opened,
      "documents/history",
      { document },
    );
    assertEquals(list.versions.map((version) => version.number), [1, 2, 3, 4]);
    assertEquals(list.versions[3].id, restored.version);
    // 새 판은 1번 판의 원문을 그대로 읽는다. 2·3번 판도 그대로다.
    const read = async (version: string): Promise<string> => {
      const response = await post(opened, "documents/file", {
        version,
        path: "plan.md",
      });
      assertEquals(response.status, 200);
      return await response.text();
    };
    assertEquals(await read(restored.version), V1);
    assertEquals(await read(one.version), V1);
    assertEquals(await read(two.version), V2);
    assertEquals(await read(three.version), V3);
    const first = await fixedOf(opened, one);
    const fresh = await fixedOf(opened, { ...one, version: restored.version });
    assertEquals(fresh.version.content_hash, first.version.content_hash);
    assertEquals(fresh.version.format, first.version.format);
    // DocumentSaved와 DocumentRestored가 새 판과 함께 남는다.
    assertEquals(ledgerEvents(opened.home).slice(events), [
      "DocumentSaved",
      "DocumentRestored",
    ]);
    // 같은 restore를 반복하면 새 판이 없다.
    const again = await restoreOf(opened, document, one, "restore-2");
    assertEquals(again.status, "unchanged");
    assertEquals(again.event_seq, null);
    assertEquals(again.version, restored.version);
    assertEquals(ledgerEvents(opened.home).length, events + 2);
    // 새 판의 section 이력은 되돌린 모습을 낸다: 추출 뒤 계획은 3번 판에서 1번 내용으로 수정이다.
    await extract(opened, { ...one, version: restored.version });
    const plan = await ok200<SectionHistoryBody>(
      opened,
      "documents/section_history",
      { document, section: "계획", from: three.version },
    );
    assertEquals(
      plan.entries.map((entry) => [entry.version, entry.status]),
      [[three.version, "unchanged"], [restored.version, "modified"]],
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/versions#R10: 낡은 base로 restore하면 conflict고 권한 밖 문서의 restore는 없는 문서와 같은 답이다", async () => {
  const opened = await open();
  try {
    const { one, two, three, document } = await history(opened);
    const fixed = await fixedOf(opened, one);
    const latest = await ok200<Fixed>(opened, "documents/get", { document });
    const prepared = await prepareRestore(
      opened,
      fixed,
      document,
      latest.document.latest_version,
      "restore-stale",
    );
    assertEquals(prepared.status, 200);
    const body = await prepared.json() as Prepared;
    const stale = await post(opened, "documents/restore", {
      input: { document, restore_version: one.version, prepared: body },
      idempotency_key: "restore-stale",
      compare: {
        base_version: two.version,
        base_revision: latest.document.revision,
      },
      prepared: [body.preparation_ref],
    });
    assertEquals(stale.status, 409, await stale.text());
    // 어떤 판도 늘지 않았다.
    const list = await ok200<{ versions: unknown[] }>(
      opened,
      "documents/history",
      { document },
    );
    assertEquals(list.versions.length, 3);
    assertEquals(
      (await ok200<Fixed>(opened, "documents/get", { document })).document
        .latest_version,
      three.version,
    );
    // 권한 밖 자격은 이 문서에 대해 없는 문서와 같은 답을 받는다.
    const hidden = await post(opened, "documents/restore", {
      input: { document, restore_version: one.version, prepared: body },
      idempotency_key: "restore-hidden",
      compare: {
        base_version: latest.document.latest_version,
        base_revision: latest.document.revision,
      },
      prepared: [body.preparation_ref],
    }, LIMITED_TOKEN);
    const missing = await post(opened, "documents/restore", {
      input: {
        document: ABSENT,
        restore_version: one.version,
        prepared: { ...body, document: ABSENT },
      },
      idempotency_key: "restore-hidden",
      compare: {
        base_version: latest.document.latest_version,
        base_revision: latest.document.revision,
      },
      prepared: [body.preparation_ref],
    }, LIMITED_TOKEN);
    assert(hidden.status >= 400);
    assertEquals(hidden.status, missing.status);
  } finally {
    await opened.dispose();
  }
});

const BIG_DOCUMENT = "doc_01arz3ndektsv4rrffq69g5fb0";

Deno.test("documents/versions#R10 documents/formats#R4: 검사 한도(1 MiB)를 넘는 명시 format 판도 restore되고 새 바이트의 같은 저장은 그대로 거절된다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const client = createCoreClient({
      baseUrl: `http://127.0.0.1:${opened.core.port}`,
      connection: CAC,
      provider: () =>
        Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
    });
    const big = `${V1}${"한 줄\n".repeat(400_000)}`;
    const bigBytes = new TextEncoder().encode(big);
    assert(bigBytes.length > FORMAT_CHECK_CONTENT_MAX_BYTES);
    const blobHash = createHash("sha256").update(bigBytes).digest("hex");
    const upload = async () => {
      const sent = await client.upload(
        documentUpload,
        { blob_hash: blobHash, bytes: bigBytes.length },
        new Blob([bigBytes]).stream(),
      );
      assert(sent.ok, sent.ok ? "" : JSON.stringify(sent.error));
      return [{
        path: "plan.md",
        blob_hash: blobHash,
        bytes: bigBytes.length,
        media_type: "text/markdown",
        primary: true,
        content: { kind: "prepared", blob: sent.value },
      }];
    };
    // 새 바이트를 명시 format으로 저장하려는 시도는 검사 한도 때문에 거절된다.
    const implicit = await client.read(documentPrepare, {
      document: BIG_DOCUMENT,
      base_version: null,
      metadata: { title: "계획서", place: PLACE, name: "plan" },
      files: await upload(),
      source: null,
      idempotency_key: "big-1",
    });
    assert(implicit.ok, implicit.ok ? "" : JSON.stringify(implicit.error));
    const prepared = implicit.value as {
      preparation_ref: string;
      format: { name: string; module_hash: string; explicit: boolean };
    };
    const explicitFormat = { ...prepared.format, explicit: true };
    const refused = await client.read(documentPrepare, {
      document: BIG_DOCUMENT,
      base_version: null,
      metadata: { title: "계획서", place: PLACE, name: "plan" },
      files: await upload(),
      format: explicitFormat,
      source: null,
      idempotency_key: "big-2",
    });
    assert(!refused.ok);
    assertEquals(refused.error.code, "invalid_input");
    // 명시 format 아래 이미 저장돼 있던 큰 판(한도가 생기기 전의 저장)을 같은 FormatRef로 확정한다.
    const sent = await client.command(documentSave, {
      input: { ...prepared, format: explicitFormat },
      idempotency_key: "big-1",
      compare: { base_version: null },
      prepared: [prepared.preparation_ref],
    });
    assert(sent.ok, sent.ok ? "" : JSON.stringify(sent.error));
    const bigVersion = (sent.value as { version: string }).version;
    // 작은 판이 이어진다(생략한 계약은 base의 정확한 FormatRef다).
    const small = await savePlan(opened, V1);
    assertEquals(small.document, BIG_DOCUMENT);
    const before = await fixedOf(opened, {
      document: BIG_DOCUMENT,
      version: bigVersion,
      text: big,
    });
    assertEquals(before.version.format.explicit, true);
    assertEquals(before.version.files[0].bytes, bigBytes.length);
    // 큰 판으로 restore한다: 한도 초과 검사 생략은 warning이고 새 판이 같은 바이트·FormatRef로 선다.
    const restored = await restoreOf(
      opened,
      BIG_DOCUMENT,
      { document: BIG_DOCUMENT, version: bigVersion, text: big },
      "restore-big",
    );
    assertEquals(restored.status, "saved");
    const after = await fixedOf(opened, {
      document: BIG_DOCUMENT,
      version: restored.version,
      text: big,
    });
    assertEquals(after.version.number, 3);
    assertEquals(after.version.content_hash, before.version.content_hash);
    assertEquals(after.version.format, before.version.format);
    const read = await post(opened, "documents/file", {
      version: restored.version,
      path: "plan.md",
    });
    assertEquals(read.status, 200);
    const digest = createHash("sha256");
    for await (const chunk of read.body!) digest.update(chunk);
    assertEquals(digest.digest("hex"), blobHash);
  } finally {
    await opened.dispose();
  }
});
