// documents/addressing#T9: 실제 core에서 문서를 움직이고 이름을 바꾼 뒤 옛 address로 해석한다.
// 데이터 root는 harness가 만든 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const HASH = "ab".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

function prepared(key: string, place: unknown, name: string | null) {
  return {
    document: DOC,
    base_version: null,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: HASH,
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
    metadata: { title: "Notes", place, name },
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
  };
}

async function open(): Promise<{ harness: CoreHarness; token: string }> {
  const opened = await createCoreHarness({
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const issued = await harness.credential({
    actor: "user",
    principal: "user-1",
    scope: {
      operations: [
        "project.create",
        "document.save",
        "document.move",
        "document.rename",
        "document.resolve",
        "document.list",
      ],
      targets: {},
    },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  const noted = await harness.notePrepared(
    {
      preparation: "prep-create",
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
      preparation: "prep-file-create",
      principal: "user-1",
      purpose: "document_file",
      hash: HASH,
      size_bytes: 10,
    },
    Date.UTC(2024, 0, 1),
  );
  assert(notedFile.ok, notedFile.ok ? "" : notedFile.error.message);
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

Deno.test("documents/addressing#R1 #R6 #R8 #R9: core에서 move·rename 뒤 옛 address로 현재 참조를 읽는다", async () => {
  const { harness, token } = await open();
  try {
    // 프로젝트를 만든다. place 예약은 project create에서 더해진다.
    const projectId = "prj_01arz3ndektsv4rrffq69g5fav";
    const createdProject = await post(harness, "projects/create", {
      input: {
        id: projectId,
        name: "mahas",
        title: "Notes",
        purpose: "",
        folders: [{
          path: `${harness.dataRoot}/project-folder`,
          description: "",
        }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: "project-1",
      compare: {},
      prepared: [],
    }, token);
    const projectText = await createdProject.text();
    assertEquals(createdProject.status, 200, projectText);

    // 문서를 만든다.
    const saved = await post(harness, "documents/save", {
      input: prepared("create", { kind: "project", id: projectId }, "report"),
      idempotency_key: "create",
      compare: { base_version: null },
      prepared: ["prep-create"],
    }, token);
    const savedText = await saved.text();
    assertEquals(saved.status, 200, savedText);
    const first = JSON.parse(savedText) as {
      status: string;
      version: string;
      event_seq: string;
    };
    assertEquals(first.status, "saved");
    // create 흐름은 createdSeq(documentCreated emit seq)를 revision으로 남긴다.
    // save는 두 event를 내므로 event_seq는 savedSeq다. 저장된 row의 revision을 inspect한다.
    const { DatabaseSync } = await import("node:sqlite");
    const ledger = new DatabaseSync(`${harness.dataRoot}/lophn.db`, {
      readOnly: true,
    });
    const current = ledger
      .prepare("SELECT revision FROM documents WHERE id = ?")
      .get(DOC) as { revision: string } | undefined;
    assert(current);
    const revision = current.revision;
    ledger.close();

    // rename을 보낸다.
    const renamed = await post(harness, "documents/rename", {
      input: { document: DOC, name: "weekly" },
      idempotency_key: "rename-1",
      compare: { base_revision: revision },
      prepared: [],
    }, token);
    const renamedText = await renamed.text();
    assertEquals(renamed.status, 200, renamedText);

    // 옛 address로 해석한다.
    const resolved = await post(harness, "documents/resolve", {
      reference: {
        place: "mahas",
        document: "report",
        section: null,
        version: null,
      },
    }, token);
    const resolvedText = await resolved.text();
    assertEquals(resolved.status, 200, resolvedText);
    const page = JSON.parse(resolvedText) as {
      resolved: {
        document: string;
        redirected: boolean;
        current_reference: {
          place: string;
          document: string;
          section: string | null;
          version: number;
        };
      };
    };
    assertEquals(page.resolved.document, DOC);
    assertEquals(page.resolved.redirected, true);
    assertEquals(page.resolved.current_reference, {
      place: "mahas",
      document: "weekly",
      section: null,
      version: 1,
    });
  } finally {
    await harness.close();
  }
});
