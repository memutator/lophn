// documents/file-tracking#R7·R8·R9, documents/versions#R13: 파일 관측 하나가 준비 →
// machine document.save로 올라가고, 마지막 관측이 FileStatus 메모리에 남는다. 제출 본문은
// contracts의 schema로 검사한다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  documentPrepareInputSchema,
  preparedVersionSchema,
} from "../../../packages/contracts/documents/mod.ts";
import {
  createStatusRecorder,
  type ObservationSubmit,
} from "../../../packages/documents/file-tracking/mod.ts";
import {
  createObservationSubmit,
  mediaTypeOfPath,
  type ObservationLink,
  type ObservationPorts,
} from "./observation.ts";
import type { CoreClient } from "./submit.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const BASE = "ver_01arz3ndektsv4rrffq69g5fav";
const OLD = "ab".repeat(32);
const NEW = "cd".repeat(32);
const AT = "2026-10-06T00:00:00.000Z";

const LINK: ObservationLink = {
  project: PROJECT,
  project_revision: "3",
  document: DOC,
  base_version: BASE,
  document_revision: "5",
  file_source: { kind: "project_file", project: PROJECT, path: "/work/a.md" },
  title: "a",
  latest_hash: OLD,
};

function submission(read: ObservationSubmit["outcome"]): ObservationSubmit {
  return {
    candidate: {
      root: "/work",
      canonical: "/work/a.md",
      relative: "a.md",
      fact: "modified",
      lastSignalMs: 0,
      retries: 0,
    },
    basis: {
      project: PROJECT,
      projectRevision: "3",
      path: "/work/a.md",
      documentRevision: "5",
      active: true,
      archived: false,
      rootPresent: true,
    },
    outcome: read,
  };
}

const STABLE = submission({
  kind: "stable",
  read: {
    hash: NEW,
    bytes: new TextEncoder().encode("# a\n"),
    identity: {
      realPath: "/work/a.md",
      device: 1,
      inode: 2,
      size: 4,
      mtimeMs: 1,
    },
  },
});

function preparedVersion(body: { document: string; idempotency_key: string }) {
  return {
    document: body.document,
    base_version: BASE,
    files_hash: NEW,
    file_count: 1,
    primary_path: "a.md",
    content_hash: NEW,
    preparation_ref: "prep-list",
    idempotency_key: body.idempotency_key,
    format: { name: "document", module_hash: OLD, explicit: false },
    validation: {
      input_hash: NEW,
      module_hash: OLD,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    file_basis: {
      kind: "project_file",
      project: PROJECT,
      path: "/work/a.md",
      project_revision: "3",
      file_source: LINK.file_source,
      document_revision: "5",
      document_status: "active",
      original_hash: NEW,
      observed_at: AT,
    },
    source: {
      kind: "file",
      project: PROJECT,
      path: "/work/a.md",
      original_hash: NEW,
      observed_at: AT,
    },
  };
}

type Calls = { path: string; body: unknown }[];

function ports(
  calls: Calls,
  override: Partial<{
    prepare: () => ReturnType<CoreClient["call"]>;
    save: () => ReturnType<CoreClient["call"]>;
    blob: boolean;
  }> = {},
): ObservationPorts {
  return {
    client: {
      call(path, body) {
        calls.push({ path, body });
        if (path === "documents/prepare") {
          return override.prepare?.() ??
            Promise.resolve(ok(preparedVersion(body as never)));
        }
        return override.save?.() ?? Promise.resolve(ok({ status: "saved" }));
      },
    },
    prepareBlob: (bytes) =>
      override.blob === false
        ? Promise.resolve(err({ code: "unavailable", message: "blob" }))
        : Promise.resolve(ok({
          preparation: "prep-file",
          principal: "machine",
          purpose: "document_file",
          hash: NEW,
          size_bytes: bytes.length,
        })),
    link: () => Promise.resolve(ok(LINK)),
    status: createStatusRecorder(),
    nowIso: () => AT,
    newKey: () => "key-1",
  };
}

const TARGET = {
  kind: "project_file" as const,
  project: PROJECT,
  path: "/work/a.md",
};

Deno.test("documents/file-tracking#R7: 안정 관측은 준비 뒤 machine document.save로 제출되고 상태가 추적 중이다", async () => {
  const calls: Calls = [];
  const wired = ports(calls);
  const result = await createObservationSubmit(wired)(STABLE);
  assert(result.ok);
  assertEquals(calls.map((call) => call.path), [
    "documents/prepare",
    "documents/save",
  ]);
  // 본문은 contract schema를 통과한다.
  const parsed = documentPrepareInputSchema.safeParse(calls[0].body);
  assert(parsed.success, JSON.stringify(parsed.error?.issues));
  const save = calls[1].body as {
    input: unknown;
    compare: { base_version: string };
    prepared: string[];
  };
  assert(preparedVersionSchema.safeParse(save.input).success);
  assertEquals(save.compare, { base_version: BASE });
  assertEquals(save.prepared, ["prep-list"]);
  const status = wired.status.get(TARGET);
  assertEquals(status?.observedHash, NEW);
  assertEquals(status?.latestHash, NEW);
  assertEquals(status?.tracked, true);
});

Deno.test("documents/file-tracking#R9: 안정 확인 실패는 제출 없이 미확인으로 남는다", async () => {
  const calls: Calls = [];
  const wired = ports(calls);
  const result = await createObservationSubmit(wired)(
    submission({ kind: "unverified", reason: "file changed while reading" }),
  );
  assert(result.ok);
  assertEquals(calls.length, 0);
  assertEquals(wired.status.get(TARGET)?.unverified, true);
});

Deno.test("documents/file-tracking#R9: 준비 검사 실패는 상태에 남고 제출은 conflict 재관측 대상이다", async () => {
  const calls: Calls = [];
  const wired = ports(calls, {
    prepare: () =>
      Promise.resolve(err({ code: "invalid_input", message: "invalid" })),
  });
  const result = await createObservationSubmit(wired)(STABLE);
  assert(!result.ok);
  assertEquals(calls.map((call) => call.path), ["documents/prepare"]);
  assertEquals(wired.status.get(TARGET)?.validationFailed, true);
});

Deno.test("documents/file-tracking#R8: 확정 때 근거가 바뀌어 conflict면 최신 판 대기로 남고 다시 관측한다", async () => {
  const calls: Calls = [];
  const wired = ports(calls, {
    save: () => Promise.resolve(err({ code: "conflict", message: "basis" })),
  });
  const result = await createObservationSubmit(wired)(STABLE);
  assert(!result.ok);
  assertEquals(result.error.code, "conflict");
  const status = wired.status.get(TARGET);
  assertEquals(status?.observedHash, NEW);
  // 최신 판의 hash는 옛것이라 version_pending이다.
  assertEquals(status?.latestHash, OLD);
});

Deno.test("documents/file-tracking#R6: 원문 blob을 준비하지 못하면 core를 부르지 않고 실패한다", async () => {
  const calls: Calls = [];
  const result = await createObservationSubmit(ports(calls, { blob: false }))(
    STABLE,
  );
  assert(!result.ok);
  assertEquals(calls.length, 0);
});

Deno.test("documents/formats#R3: 확장자로 MIME을 정하고 모르면 일반 바이트다", () => {
  assertEquals(mediaTypeOfPath("a.md"), "text/markdown");
  assertEquals(mediaTypeOfPath("b.PDF"), "application/pdf");
  assertEquals(mediaTypeOfPath("c.bin"), "application/octet-stream");
});
