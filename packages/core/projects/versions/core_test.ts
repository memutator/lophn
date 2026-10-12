// documents/versions#R1·R8·R9: 실제 core에서 문서를 만들고 판을 더한 뒤 read로 읽는다.
// 데이터 root는 harness가 만든 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { type CoreHarness, createCoreHarness } from "../../testing/core.ts";
import type { TeamModule } from "../../main/daemon/registration.ts";
import { createLedgerRegistration } from "../register.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const HASH = "ab".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

function prepared(base: string | null, key: string, content = HASH) {
  return {
    document: DOC,
    base_version: base,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: content,
    preparation_ref: `prep-${key}`,
    files: [{
      path: "a.md",
      blob_hash: HASH,
      bytes: 10,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: `prep-file-${key}`,
    }],
    idempotency_key: key,
    ...(base === null
      ? { metadata: { title: "Notes", place: null, name: null } }
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

async function open(): Promise<{ harness: CoreHarness; token: string }> {
  const opened = await createCoreHarness({
    teams,
    teamModules: [new URL("../register.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const issued = await harness.credential({
    actor: "user",
    principal: "user-1",
    scope: {
      operations: [
        "document.save",
        "document.list",
        "document.get",
        "document.history",
      ],
      targets: {},
    },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  for (const key of ["create", "second"]) {
    const noted = await harness.notePrepared(
      {
        preparation: `prep-${key}`,
        principal: "user-1",
        purpose: "document_files",
        hash: HASH,
        size_bytes: 0,
      },
      Date.UTC(2024, 0, 1),
    );
    assert(noted.ok, noted.ok ? "" : noted.error.message);
    const notedFile = await harness.notePrepared(
      {
        preparation: `prep-file-${key}`,
        principal: "user-1",
        purpose: "document_file",
        hash: HASH,
        size_bytes: 10,
      },
      Date.UTC(2024, 0, 1),
    );
    assert(notedFile.ok, notedFile.ok ? "" : notedFile.error.message);
  }
  return { harness, token: issued.value.token };
}

function post(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("documents/versions#R1 #R8 #R9: core에서 문서를 만들고 판을 더한 뒤 list·get·history로 읽는다", async () => {
  const { harness, token } = await open();
  try {
    const created = await post(harness, "documents/save", {
      input: prepared(null, "create"),
      idempotency_key: "create",
      compare: { base_version: null },
      prepared: ["prep-create"],
    }, token);
    const createdText = await created.text();
    assertEquals(created.status, 200, createdText);
    const first = JSON.parse(createdText) as {
      status: string;
      version: string;
      reference: { document: string; version: string; section: string | null };
    };
    assertEquals(first.status, "saved");
    assertEquals(first.reference, {
      document: DOC,
      version: first.version,
      section: null,
    });

    const listed = await post(
      harness,
      "documents/list",
      { status: "active" },
      token,
    );
    const listedText = await listed.text();
    assertEquals(listed.status, 200, listedText);
    const page = JSON.parse(listedText) as {
      documents: {
        document: { id: string };
        latest_version: { id: string; saved_by: string };
      }[];
    };
    assertEquals(page.documents.length, 1);
    assertEquals(page.documents[0].document.id, DOC);
    assertEquals(page.documents[0].latest_version.id, first.version);
    assertEquals(page.documents[0].latest_version.saved_by, "user");

    const got = await post(
      harness,
      "documents/get",
      { document: DOC, version: first.version },
      token,
    );
    const gotText = await got.text();
    assertEquals(got.status, 200, gotText);
    const detail = JSON.parse(gotText) as {
      version: { number: number; content_hash: string };
    };
    assertEquals(detail.version.number, 1);
    assertEquals(detail.version.content_hash, HASH);

    const NEXT = "cd".repeat(32);
    const added = await post(harness, "documents/save", {
      input: prepared(first.version, "second", NEXT),
      idempotency_key: "second",
      compare: { base_version: first.version },
      prepared: ["prep-second"],
    }, token);
    const addedText = await added.text();
    assertEquals(added.status, 200, addedText);
    const second = JSON.parse(addedText) as { status: string; version: string };
    assertEquals(second.status, "saved");
    assert(second.version !== first.version);

    const history = await post(
      harness,
      "documents/history",
      { document: DOC },
      token,
    );
    const historyText = await history.text();
    assertEquals(history.status, 200, historyText);
    const versions =
      (JSON.parse(historyText) as { versions: { id: string }[] }).versions;
    assertEquals(versions.map((version) => version.id), [
      first.version,
      second.version,
    ]);
  } finally {
    await harness.close();
  }
});
