// documents/versions#R20 documents/file-tracking#R20: 실제 core에서 preset 지침 첨부 문서를 coding agent가
// 저장하려 하면 forbidden이다. lophn-agent가 등록한 InstructionAttachments 판정 port가 같은 Tx에서
// 현재 preset 판을 읽는다. 데이터 root는 harness가 만든 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const HASH = "ab".repeat(32);
const NEXT = "cd".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const PRESET = "pst_01arz3ndektsv4rrffq69g5fav";

function prepared(base: string | null, key: string, content: string) {
  return {
    document: DOC,
    base_version: base,
    files_hash: HASH,
    file_count: 1,
    primary_path: "LOPHN.md",
    content_hash: content,
    preparation_ref: `prep-${key}`,
    files: [{
      path: "LOPHN.md",
      blob_hash: HASH,
      bytes: 10,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: `prep-file-${key}`,
    }],
    idempotency_key: key,
    ...(base === null
      ? { metadata: { title: "Rules", place: null, name: null } }
      : {}),
    format: { name: "document", module_hash: HASH, explicit: false },
    validation: {
      input_hash: content,
      module_hash: HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  };
}

async function note(harness: CoreHarness, principal: string, key: string) {
  for (
    const [ref, purpose, size] of [
      [`prep-${key}`, "document_files", 0],
      [`prep-file-${key}`, "document_file", 10],
    ] as const
  ) {
    const noted = await harness.notePrepared(
      {
        preparation: ref,
        principal,
        purpose,
        hash: HASH,
        size_bytes: size,
      },
      Date.UTC(2024, 0, 1),
    );
    assert(noted.ok, noted.ok ? "" : noted.error.message);
  }
}

function post(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
) {
  return fetch(`http://127.0.0.1:${harness.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

// 그 문서를 지침으로 붙인 preset 판 하나를 ledger에 직접 둔다(preset 생성 command는 이 시험의 대상이 아니다).
function attachPreset(harness: CoreHarness, document: string) {
  const db = new DatabaseSync(`${harness.dataRoot}/lophn.db`);
  try {
    const definition = JSON.stringify({
      instructions: [{ document, order: 0 }],
    });
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `insert into presets (id, kind, origin, name, name_key, prompt, revision)
       values (?, 'operator', 'user', 'Rules', 'rules', 'prompt', 1)`,
    ).run(PRESET);
    db.prepare(
      `insert into preset_revisions (preset_id, revision, definition, definition_hash,
         prompt_hash, decided_by, proposed_by, reason, created_at)
       values (?, 1, ?, ?, ?, 'user', 'user', 'test', '2024-01-01T00:00:00.000Z')`,
    ).run(PRESET, definition, HASH, HASH);
  } finally {
    db.close();
  }
}

Deno.test("documents/versions#R20 documents/file-tracking#R20: 실제 core에서 preset 지침 첨부 문서의 coding agent 저장은 forbidden이고 첨부가 없으면 저장된다", async () => {
  const opened = await createCoreHarness({
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const user = await harness.credential({
      actor: "user",
      principal: "user-1",
      scope: { operations: ["document.save"], targets: {} },
      conditions: {},
    });
    assert(user.ok);
    const coding = await harness.credential({
      actor: "coding_agent",
      principal: "cac_01arz3ndektsv4rrffq69g5fav",
      scope: { operations: ["document.save"], targets: {} },
      conditions: {},
    });
    assert(coding.ok, coding.ok ? "" : coding.error.message);
    await note(harness, "user-1", "create");
    await note(harness, "cac_01arz3ndektsv4rrffq69g5fav", "agent-free");
    await note(harness, "cac_01arz3ndektsv4rrffq69g5fav", "agent-attached");

    const created = await post(harness, "documents/save", {
      input: prepared(null, "create", HASH),
      idempotency_key: "create",
      compare: { base_version: null },
      prepared: ["prep-create", "prep-file-create"],
    }, user.value.token);
    const createdText = await created.text();
    assertEquals(created.status, 200, createdText);
    const first = JSON.parse(createdText) as { version: string };

    const save = (key: string, base: string, content: string) =>
      post(harness, "documents/save", {
        input: prepared(base, key, content),
        idempotency_key: key,
        compare: { base_version: base },
        prepared: [`prep-${key}`, `prep-file-${key}`],
      }, coding.value.token);

    // 첨부가 없으면 coding agent의 일반 저장이다. 거절 원인이 자격 범위가 아님을 보인다.
    const free = await save("agent-free", first.version, NEXT);
    const freeText = await free.text();
    assertEquals(free.status, 200, freeText);
    const second = JSON.parse(freeText) as { version: string };

    attachPreset(harness, DOC);
    const refused = await save(
      "agent-attached",
      second.version,
      "ef".repeat(32),
    );
    const refusedText = await refused.text();
    assertEquals(refused.status, 403, refusedText);
  } finally {
    await harness.close();
  }
});
