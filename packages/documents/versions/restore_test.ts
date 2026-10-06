// documents/versions#R10·R13: 이전 판 restore. 판의 바이트·hash는 모두 실제 sha256이고 파일 목록
// hash는 실제 canonical 목록의 hash다. 저장은 실제 save command로 쌓는다.
import { assert, assertEquals } from "@std/assert";
import { err, sha256Hex } from "../../base/mod.ts";
import { BUILTIN_MODULE_HASH } from "../formats/mod.ts";
import { createVersionCommands } from "./commands.ts";
import { filesHash } from "./model.ts";
import { ids, keep, userContext, versionFixture } from "./testing/mod.ts";

type Fixture = ReturnType<typeof versionFixture>;

const commands = createVersionCommands();
const AT = "2026-10-05T00:00:00.000Z";
const PATH = "/work/notes/a.md";
const REAL_FORMAT = {
  name: "document",
  module_hash: BUILTIN_MODULE_HASH,
  explicit: false,
};
const EXPLICIT_FORMAT = { ...REAL_FORMAT, explicit: true };
const encoder = new TextEncoder();

type Built = {
  text: string;
  blob_hash: string;
  bytes: number;
  files_hash: string;
  format: typeof REAL_FORMAT;
};

async function built(
  text: string,
  format: typeof REAL_FORMAT = REAL_FORMAT,
): Promise<Built> {
  const bytes = encoder.encode(text);
  const blob_hash = await sha256Hex(bytes);
  const files_hash = await filesHash([{
    path: "a.md",
    blob_hash,
    bytes: bytes.length,
    media_type: "text/markdown",
    primary: true,
  }]);
  return { text, blob_hash, bytes: bytes.length, files_hash, format };
}

function plainFile(item: Built) {
  return {
    path: "a.md",
    blob_hash: item.blob_hash,
    bytes: item.bytes,
    media_type: "text/markdown",
    primary: true,
  };
}

function preparedOf(
  document: string,
  base: string | null,
  item: Built,
  key: string,
  extra: Record<string, unknown> = {},
) {
  return {
    document,
    base_version: base,
    files_hash: item.files_hash,
    file_count: 1,
    primary_path: "a.md",
    content_hash: item.files_hash,
    preparation_ref: `prep-${key}`,
    idempotency_key: key,
    ...(base === null
      ? { metadata: { title: "계획서", place: null, name: null } }
      : {}),
    format: item.format,
    validation: {
      input_hash: item.files_hash,
      module_hash: item.format.module_hash,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
    files: [{ ...plainFile(item), preparation_ref: `prep-file-${key}` }],
    ...extra,
  };
}

async function saved(
  fixture: Fixture,
  base: string | null,
  item: Built,
  key: string,
  extra: Record<string, unknown> = {},
  document = ids.doc,
) {
  return keep(fixture.transaction((tx) =>
    commands.save.handle(
      tx,
      userContext(),
      preparedOf(document, base, item, key, extra) as never,
      { base_version: base },
    )
  ));
}

function documentRow(fixture: Fixture) {
  const row = fixture.sql.get(
    "SELECT latest_version, revision, title, status FROM documents WHERE id = ?",
    [ids.doc],
  );
  return {
    latest: String(row?.["latest_version"]),
    revision: String(row?.["revision"]),
    title: String(row?.["title"]),
    status: String(row?.["status"]),
  };
}

type Selected = { version: string; item: Built };
type Overrides = {
  prepared?: Record<string, unknown>;
  input?: Record<string, unknown>;
  file?: Record<string, unknown>;
};

// 선택한 판의 바이트를 가리키는 restore 입력. 파일은 그 판이 이미 가진 원문 blob의 참조다.
function restoreOf(
  selected: Selected,
  base: string,
  key: string,
  overrides: Overrides = {},
) {
  const { item } = selected;
  return {
    document: ids.doc,
    restore_version: selected.version,
    ...overrides.input,
    prepared: {
      ...preparedOf(ids.doc, base, item, key),
      files: [{
        ...plainFile(item),
        existing: {
          owner_kind: "document_version",
          owner_key: `${selected.version}/a.md`,
          field: "file",
          hash: item.blob_hash,
          registered_seq: "1",
        },
        ...overrides.file,
      }],
      ...overrides.prepared,
    },
  };
}

type RestoreInput = ReturnType<typeof restoreOf>;

function restore(
  fixture: Fixture,
  input: RestoreInput,
  actor = userContext(),
  compare?: { base_version: string; base_revision: string },
) {
  const current = documentRow(fixture);
  return fixture.transaction((tx) =>
    commands.restore.handle(
      tx,
      actor,
      input as never,
      compare ?? {
        base_version: current.latest,
        base_revision: current.revision,
      },
    )
  );
}

async function history(fixture: Fixture) {
  const first = await built("# 계획서\n\n## 개요\n처음 글\n", EXPLICIT_FORMAT);
  const second = await built("# 계획서\n\n## 개요\n고친 글\n");
  const one = await saved(fixture, null, first, "save-1");
  const two = await saved(fixture, one.version, second, "save-2");
  return {
    first: { version: one.version, item: first },
    second: { version: two.version, item: second },
  };
}

Deno.test("documents/versions#R10: restore는 선택한 판의 바이트와 정확한 FormatRef로 새 판을 남기고 이전 판과 event는 그대로다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    const before = fixture.sql.all(
      "SELECT * FROM versions ORDER BY number",
      [],
    );
    const events = fixture.emitted.length;
    const restored = keep(
      restore(fixture, restoreOf(first, second.version, "restore-1")),
    );
    assertEquals(restored.status, "saved");
    // 새 판은 3번이고 내용·형식이 1번 판과 같다. 형식은 1번의 명시 계약 그대로다.
    const row = fixture.sql.get(
      `SELECT number, content_hash, files_hash, format_name, module_hash, format_explicit
       FROM versions WHERE id = ?`,
      [restored.version],
    );
    assertEquals(row?.["number"], 3);
    assertEquals(row?.["content_hash"], first.item.files_hash);
    assertEquals(row?.["files_hash"], first.item.files_hash);
    assertEquals(row?.["format_name"], EXPLICIT_FORMAT.name);
    assertEquals(row?.["module_hash"], BUILTIN_MODULE_HASH);
    assertEquals(row?.["format_explicit"], 1);
    // 파일 행과 원문 blob 참조는 선택한 판의 같은 blob을 새 판의 경로에 묶는다.
    const rows = fixture.sql.all(
      "SELECT path, blob_hash, bytes FROM version_files WHERE version = ?",
      [restored.version],
    );
    assertEquals(rows.map((item) => [item.path, item.blob_hash]), [[
      "a.md",
      first.item.blob_hash,
    ]]);
    assert(
      fixture.blobs.some((blob) =>
        blob.owner_key === `${restored.version}/a.md` &&
        blob.field === "file" && blob.hash === first.item.blob_hash
      ),
    );
    assert(
      fixture.blobs.some((blob) =>
        blob.owner_key === restored.version && blob.field === "files"
      ),
    );
    // 최신은 새 판이고 DocumentSaved와 DocumentRestored가 이어서 나온다.
    assertEquals(documentRow(fixture).latest, restored.version);
    const added = fixture.emitted.slice(events);
    assertEquals(added.map((event) => event.type), [
      "DocumentSaved",
      "DocumentRestored",
    ]);
    assertEquals(added[1].payload, {
      restore_version: first.version,
      previous_version: second.version,
      version: restored.version,
    });
    assertEquals(
      (added[0].payload as { previous_version: string }).previous_version,
      second.version,
    );
    assertEquals(restored.event_seq, added[1].seq);
    // 이전 두 판의 행은 그대로고 2번 판도 여전히 읽힌다.
    const after = fixture.sql.all(
      "SELECT * FROM versions WHERE number <= 2 ORDER BY number",
      [],
    );
    assertEquals(after, before);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R10: 같은 restore를 반복하거나 최신과 같은 판을 고르면 새 판도 event도 없다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    const restored = keep(
      restore(fixture, restoreOf(first, second.version, "restore-1")),
    );
    const events = fixture.emitted.length;
    const blobs = fixture.blobs.length;
    // 같은 판을 다시 고르면 최신(3번)과 내용·형식이 같아 그대로다.
    const again = keep(
      restore(fixture, restoreOf(first, restored.version, "restore-2")),
    );
    assertEquals(again.status, "unchanged");
    assertEquals(again.event_seq, null);
    assertEquals(again.version, restored.version);
    // 최신 판 자체를 고르는 restore도 그렇다.
    const latest = keep(
      restore(
        fixture,
        restoreOf(
          { version: restored.version, item: first.item },
          restored.version,
          "restore-3",
        ),
      ),
    );
    assertEquals(latest.status, "unchanged");
    assertEquals(fixture.emitted.length, events);
    assertEquals(fixture.blobs.length, blobs);
    assertEquals(
      fixture.sql.get(
        "SELECT COUNT(*) AS n FROM versions WHERE document = ?",
        [ids.doc],
      )?.["n"],
      3,
    );
    // 새 최신 판은 1번 내용이고 2번 판의 내용으로 다시 restore하면 4번이 선다.
    const back = keep(
      restore(fixture, restoreOf(second, restored.version, "restore-4")),
    );
    assertEquals(back.status, "saved");
    assertEquals(
      fixture.sql.get("SELECT number FROM versions WHERE id = ?", [
        back.version,
      ])?.["number"],
      4,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R10: 최신 판이나 문서 revision이 읽은 것과 다르면 conflict고 아무것도 덮지 않는다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    const current = documentRow(fixture);
    const events = fixture.emitted.length;
    const cases: [
      string,
      { base_version: string; base_revision: string },
      RestoreInput,
    ][] = [
      [
        "낡은 base_version",
        { base_version: first.version, base_revision: current.revision },
        restoreOf(first, first.version, "restore-1"),
      ],
      [
        "낡은 base_revision",
        { base_version: second.version, base_revision: "99" },
        restoreOf(first, second.version, "restore-2"),
      ],
      [
        "준비 결과가 묶은 base와 CAS가 다름",
        { base_version: second.version, base_revision: current.revision },
        restoreOf(first, first.version, "restore-3"),
      ],
    ];
    for (const [name, compare, input] of cases) {
      const result = restore(fixture, input, userContext(), compare);
      assert(!result.ok, name);
      assertEquals(result.error.code, "conflict", name);
    }
    assertEquals(fixture.emitted.length, events);
    assertEquals(documentRow(fixture).latest, second.version);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R10: 준비 결과가 선택한 판의 내용·목록·FormatRef가 아니면 invalid_input이다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    const other = await built("전혀 다른 글", EXPLICIT_FORMAT);
    const cases: [string, RestoreInput][] = [
      [
        "내용 hash",
        restoreOf(first, second.version, "r-1", {
          prepared: { content_hash: second.item.files_hash },
        }),
      ],
      [
        "목록 hash",
        restoreOf(first, second.version, "r-2", {
          prepared: { files_hash: other.files_hash },
        }),
      ],
      [
        "명시 여부가 다른 FormatRef",
        restoreOf(first, second.version, "r-3", {
          prepared: { format: REAL_FORMAT },
        }),
      ],
      [
        "다른 module의 FormatRef",
        restoreOf(first, second.version, "r-4", {
          prepared: {
            format: { ...EXPLICIT_FORMAT, module_hash: "e".repeat(64) },
          },
        }),
      ],
      [
        "파일 바이트 수",
        restoreOf(first, second.version, "r-5", { file: { bytes: 7 } }),
      ],
      [
        "다른 판의 파일을 가리키는 참조",
        restoreOf(first, second.version, "r-6", {
          file: {
            existing: {
              owner_kind: "document_version",
              owner_key: `${second.version}/a.md`,
              field: "file",
              hash: first.item.blob_hash,
              registered_seq: "1",
            },
          },
        }),
      ],
    ];
    const events = fixture.emitted.length;
    for (const [name, input] of cases) {
      const result = restore(fixture, input);
      assert(!result.ok, name);
      assertEquals(result.error.code, "invalid_input", name);
    }
    assertEquals(fixture.emitted.length, events);
    assertEquals(documentRow(fixture).latest, second.version);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R10: 없는 문서·다른 문서의 판은 not_found고 권한 밖 문서는 없는 문서와 같은 답이다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    // 다른 문서의 판을 골라도 이 문서에는 그 판이 없다.
    const foreignItem = await built("남의 문서 글");
    const foreign = await saved(
      fixture,
      null,
      foreignItem,
      "foreign",
      {},
      ids.other,
    );
    const crossed = restore(
      fixture,
      restoreOf(
        { version: foreign.version, item: foreignItem },
        second.version,
        "r-1",
      ),
    );
    assert(!crossed.ok);
    assertEquals(crossed.error.code, "not_found");
    const ghost = restore(fixture, {
      ...restoreOf(first, second.version, "r-2"),
      restore_version: "ver_01arz3ndektsv4rrffq69g5fb9",
    });
    assert(!ghost.ok);
    assertEquals(ghost.error.code, "not_found");
    // 없는 문서와 권한 밖 문서는 같은 답이다.
    const missing = "doc_01arz3ndektsv4rrffq69g5fb9";
    const baseInput = restoreOf(first, second.version, "r-3");
    const absent = restore(fixture, {
      ...baseInput,
      document: missing,
      prepared: { ...baseInput.prepared, document: missing },
    });
    assert(!absent.ok);
    assertEquals(absent.error.code, "not_found");
    fixture.use(() => err({ code: "forbidden", message: "out of scope" }));
    const hidden = restore(fixture, restoreOf(first, second.version, "r-4"));
    assert(!hidden.ok);
    assertEquals(hidden.error.code, absent.error.code);
    assertEquals(hidden.error.message, absent.error.message);
    // 판정 자체를 못 하면 없는 것으로 꾸미지 않는다.
    fixture.use(() => err({ code: "unavailable", message: "port down" }));
    const down = restore(fixture, restoreOf(first, second.version, "r-5"));
    assert(!down.ok);
    assertEquals(down.error.code, "unavailable");
    assertEquals(documentRow(fixture).latest, second.version);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R10: restore는 user와 요청된 revert의 machine만 하고 제목 보상은 machine만 보낸다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    const others = [
      userContext("coding_agent:cac_01arz3ndektsv4rrffq69g5fav"),
      userContext(`agent:${ids.run.replace("run_", "asg_")}`, ids.run),
      userContext(`app:${ids.app}`),
    ];
    for (const actor of others) {
      const result = restore(
        fixture,
        restoreOf(first, second.version, "r-1"),
        actor,
      );
      assert(!result.ok, actor.actor);
      assertEquals(result.error.code, "forbidden", actor.actor);
    }
    const titled = restore(
      fixture,
      restoreOf(first, second.version, "r-2", { input: { title: "옛 제목" } }),
    );
    assert(!titled.ok);
    assertEquals(titled.error.code, "invalid_input");
    // machine은 새 판과 함께 제목을 되돌린다: DocumentUpdated가 revision을 옮긴다.
    const events = fixture.emitted.length;
    const reverted = keep(restore(
      fixture,
      restoreOf(first, second.version, "r-3", { input: { title: "옛 제목" } }),
      userContext("machine"),
    ));
    assertEquals(reverted.status, "saved");
    assertEquals(
      fixture.emitted.slice(events).map((event) => event.type),
      ["DocumentSaved", "DocumentRestored", "DocumentUpdated"],
    );
    const document = documentRow(fixture);
    assertEquals(document.title, "옛 제목");
    assertEquals(document.latest, reverted.version);
    assertEquals(reverted.event_seq, document.revision);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R10: 보관한 문서의 restore는 conflict다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    fixture.sql.run("UPDATE documents SET status = 'archived' WHERE id = ?", [
      ids.doc,
    ]);
    const result = restore(fixture, restoreOf(first, second.version, "r-1"));
    assert(!result.ok);
    assertEquals(result.error.code, "conflict");
  } finally {
    fixture.close();
  }
});

// 원본 파일에 연결된 문서와 그 판 둘. 두 번째 판은 파일 관측이 확정한다.
async function linkedHistory(fixture: Fixture) {
  const first = await built("# 계획서\n\n## 개요\n처음 글\n");
  const second = await built("# 계획서\n\n## 개요\n고친 글\n");
  const observed = (item: Built, revision?: string) => ({
    source: {
      kind: "file",
      project: ids.project,
      path: PATH,
      original_hash: item.blob_hash,
      observed_at: AT,
    },
    file_basis: {
      kind: "project_file",
      project: ids.project,
      path: PATH,
      project_revision: "1",
      ...(revision === undefined ? { file_source: null } : {
        document_revision: revision,
        document_status: "active",
        file_source: {
          kind: "project_file",
          project: ids.project,
          path: PATH,
        },
      }),
      original_hash: item.blob_hash,
      observed_at: AT,
    },
  });
  const one = await saved(fixture, null, first, "obs-1", observed(first));
  const current = documentRow(fixture);
  const two = await saved(
    fixture,
    one.version,
    second,
    "obs-2",
    observed(second, current.revision),
  );
  return {
    first: { version: one.version, item: first },
    second: { version: two.version, item: second },
    observed,
  };
}

Deno.test("documents/versions#R13: 원본 연결 문서는 관측 근거 없는 직접 restore를 거절하고 연결이 맞는 관측 근거로만 확정한다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second, observed } = await linkedHistory(fixture);
    const events = fixture.emitted.length;
    // 근거 없는 restore는 파일을 쓰고 관측하는 길을 먼저 가야 한다.
    const direct = restore(fixture, restoreOf(first, second.version, "r-1"));
    assert(!direct.ok);
    assertEquals(direct.error.code, "conflict");
    assertEquals(fixture.emitted.length, events);
    // 사람이 쓴 파일의 관측 근거는 같은 연결의 파일이고 관측 바이트가 선택 판의 파일이다.
    const current = documentRow(fixture);
    const good = observed(first.item, current.revision);
    const done = keep(restore(
      fixture,
      restoreOf(first, second.version, "r-2", { prepared: good }),
    ));
    assertEquals(done.status, "saved");
    assertEquals(
      fixture.emitted.slice(events).map((event) => event.type),
      ["DocumentSaved", "DocumentRestored"],
    );
    const stored = JSON.parse(String(
      fixture.sql.get("SELECT source FROM versions WHERE id = ?", [
        done.version,
      ])?.["source"],
    )) as { kind: string; path: string; original_hash: string };
    assertEquals(stored.kind, "file");
    assertEquals(stored.path, PATH);
    assertEquals(stored.original_hash, first.item.blob_hash);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 다른 파일을 가리키거나 낡았거나 선택 판이 아닌 파일을 관측한 restore는 거절한다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second, observed } = await linkedHistory(fixture);
    const current = documentRow(fixture);
    const good = observed(first.item, current.revision);
    const cases: [string, string, Record<string, unknown>][] = [
      [
        "다른 경로",
        "conflict",
        {
          source: { ...good.source, path: "/work/other.md" },
          file_basis: { ...good.file_basis, path: "/work/other.md" },
        },
      ],
      [
        "낡은 문서 revision",
        "conflict",
        { file_basis: { ...good.file_basis, document_revision: "99" } },
      ],
      [
        "관측한 바이트가 선택 판이 아님",
        "invalid_input",
        {
          source: { ...good.source, original_hash: second.item.blob_hash },
          file_basis: {
            ...good.file_basis,
            original_hash: second.item.blob_hash,
          },
        },
      ],
      [
        "앱 source",
        "conflict",
        {
          source: {
            kind: "app",
            app: ids.app,
            release: "rel_01arz3ndektsv4rrffq69g5fav",
          },
        },
      ],
    ];
    const events = fixture.emitted.length;
    for (const [name, code, prepared] of cases) {
      const result = restore(
        fixture,
        restoreOf(first, second.version, `r-${name}`, {
          prepared: { ...good, ...prepared },
        }),
      );
      assert(!result.ok, name);
      assertEquals(result.error.code, code, name);
    }
    assertEquals(fixture.emitted.length, events);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 원본 연결이 없는 문서의 restore는 파일 source나 관측 근거를 받지 않는다", async () => {
  const fixture = versionFixture();
  try {
    const { first, second } = await history(fixture);
    const result = restore(
      fixture,
      restoreOf(first, second.version, "r-1", {
        prepared: {
          source: {
            kind: "file",
            project: ids.project,
            path: PATH,
            original_hash: first.item.blob_hash,
            observed_at: AT,
          },
        },
      }),
    );
    assert(!result.ok);
    assertEquals(result.error.code, "invalid_input");
  } finally {
    fixture.close();
  }
});
