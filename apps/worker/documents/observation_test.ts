// documents/file-tracking#R7·R8·R9, documents/versions#R13: 파일 관측 하나가 준비 →
// machine document.save로 올라가고, 마지막 관측이 FileStatus 메모리에 남는다. 제출 본문은
// contracts의 schema로 검사한다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  documentPrepareInputSchema,
  preparedVersionSchema,
} from "../../../packages/protocol/projects/mod.ts";
import {
  createStatusRecorder,
  type ObservationSubmit,
} from "../../../packages/core/projects/file-tracking/mod.ts";
import {
  basisFromStore,
  childBlobPort,
  createObservationSubmit,
  linkFromStore,
  mediaTypeOfPath,
  type ObservationLink,
  type ObservationPorts,
  retryOnNewBasis,
  sharePreparedBlob,
  titleOfPath,
} from "./observation.ts";
import { createBasisStore } from "./basis.ts";
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
  status: "active",
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
    files: [{
      path: "a.md",
      blob_hash: NEW,
      bytes: 4,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: "prep-file",
    }],
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
          principal: "machine:documents",
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
  assertEquals(save.prepared, ["prep-list", "prep-file"]);
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

Deno.test("documents/formats#R4 documents/formats#R5: 저장 결과의 warning은 파일 상태에 남고 판은 확정된다", async () => {
  const calls: Calls = [];
  const wired = ports(calls, {
    save: () =>
      Promise.resolve(ok({
        status: "saved",
        warnings: [{
          severity: "warning",
          code: "duplicate_anchor",
          message: "anchor repeated",
        }],
      })),
  });
  const result = await createObservationSubmit(wired)(STABLE);
  assert(result.ok);
  const status = wired.status.get(TARGET);
  assertEquals(status?.validationFailed, false);
  assertEquals(status?.latestHash, NEW);
  assertEquals(status?.details, "duplicate_anchor: anchor repeated");
  wired.link = () => Promise.resolve(ok({ ...LINK, latest_hash: NEW }));
  const again = await createObservationSubmit(wired)(STABLE);
  assert(again.ok);
  assertEquals(calls.map((call) => call.path), [
    "documents/prepare",
    "documents/save",
  ]);
  assertEquals(
    wired.status.get(TARGET)?.details,
    "duplicate_anchor: anchor repeated",
  );
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

Deno.test("documents/file-tracking#R6: 원문 blob은 자식 session의 document_file 준비로 core에 간다", async () => {
  const seen: { purpose: string; sizeBytes: number }[] = [];
  const port = childBlobPort({
    prepareBlob(input) {
      seen.push({ purpose: input.purpose, sizeBytes: input.sizeBytes });
      return Promise.resolve(ok({
        preparation: "p",
        principal: "machine:documents",
        purpose: input.purpose,
        hash: NEW,
        size_bytes: input.sizeBytes,
      }));
    },
  });
  const result = await port(new Uint8Array(7));
  assert(result.ok);
  assertEquals(seen, [{ purpose: "document_file", sizeBytes: 7 }]);
});

Deno.test("documents/file-tracking#R10: 최신 판과 같은 내용이면 준비·저장 요청 없이 추적 중으로 남는다", async () => {
  const calls: Calls = [];
  const wired = ports(calls);
  wired.link = () => Promise.resolve(ok({ ...LINK, latest_hash: NEW }));
  const result = await createObservationSubmit(wired)(STABLE);
  assert(result.ok);
  assertEquals(calls.length, 0);
  const status = wired.status.get(TARGET);
  assertEquals(status?.observedHash, NEW);
  assertEquals(status?.latestHash, NEW);
});

Deno.test("documents/file-tracking#R8: 보관된 문서에는 새 판을 확정하지 않고 상태만 남긴다", async () => {
  const calls: Calls = [];
  const wired = ports(calls);
  wired.link = () => Promise.resolve(ok({ ...LINK, status: "archived" }));
  const result = await createObservationSubmit(wired)(STABLE);
  assert(result.ok);
  assertEquals(calls.length, 0);
  const status = wired.status.get(TARGET);
  assertEquals(status?.unverified, true);
  assertEquals(status?.details, "document archived");
});

function storeWith(
  links: {
    path: string;
    status?: "active" | "archived";
    latest_hash?: string | null;
  }[],
) {
  const store = createBasisStore();
  store.apply({
    begin: true,
    full: true,
    roots: [{
      root: "/work",
      project: PROJECT,
      project_revision: "3",
      patterns: [],
      use_gitignore: false,
    }],
    folders: [{ project: PROJECT, path: "/work" }],
    upsert: links.map((link) => ({
      project: PROJECT,
      path: link.path,
      document: DOC,
      document_revision: "5",
      status: link.status ?? "active",
      latest_version: BASE,
      latest_hash: link.latest_hash === undefined ? OLD : link.latest_hash,
      title: "a",
    })),
    remove: [],
    more: false,
  });
  return store;
}

Deno.test("documents/versions#R13: 연결된 경로는 그 문서의 최신 판에 이어 제출하고 연결 없는 파일은 새 문서가 된다", async () => {
  const store = storeWith([{ path: "/work/a.md" }]);
  const link = linkFromStore(store, () => "doc_new");
  const linked = await link(STABLE);
  assert(linked.ok);
  assertEquals(linked.value.document, DOC);
  assertEquals(linked.value.base_version, BASE);
  assertEquals(linked.value.document_revision, "5");
  assertEquals(linked.value.file_source, LINK.file_source);
  // 연결이 없는 파일은 base_version 없이 새 문서 ID를 받는다.
  const other = submission(STABLE.outcome);
  other.candidate = {
    ...other.candidate,
    canonical: "/work/sub/b.md",
    relative: "sub/b.md",
  };
  const fresh = await link(other);
  assert(fresh.ok);
  assertEquals(fresh.value.document, "doc_new");
  assertEquals(fresh.value.base_version, null);
  assertEquals(fresh.value.file_source, null);
  assertEquals(fresh.value.title, "b");
});

Deno.test("documents/file-tracking#R8: 근거에서 사라진 root의 제출은 늦은 것이다", async () => {
  const store = createBasisStore();
  const link = linkFromStore(store, () => "doc_new");
  const result = await link(STABLE);
  assert(!result.ok);
  assertEquals(result.error.code, "not_found");
});

Deno.test("documents/file-tracking#R7: 제출 근거는 근거 store의 project 판과 문서 판·보관 상태다", () => {
  const store = storeWith([
    { path: "/work/a.md" },
    { path: "/work/old.md", status: "archived" },
  ]);
  const basisFor = basisFromStore(store);
  const candidate = STABLE.candidate;
  assertEquals(basisFor(candidate), STABLE.basis);
  const archived = basisFor({
    ...candidate,
    canonical: "/work/old.md",
    relative: "old.md",
  });
  assertEquals(archived.archived, true);
  assertEquals(archived.active, false);
  const none = basisFor({ ...candidate, root: "/elsewhere" });
  assertEquals(none.rootPresent, false);
});

Deno.test("documents/formats#R3: 새 문서의 제목은 마지막 확장자를 뺀 파일 이름이다", () => {
  assertEquals(titleOfPath("notes/plan.v2.md"), "plan.v2");
  assertEquals(titleOfPath("README"), "README");
  assertEquals(titleOfPath(".hidden"), ".hidden");
});

Deno.test("documents/file-tracking#R7: conflict면 새 근거가 반영된 뒤 한 번 더 제출한다", async () => {
  const store = createBasisStore();
  let attempts = 0;
  const submit = retryOnNewBasis(
    () => {
      attempts += 1;
      return Promise.resolve(
        attempts === 1
          ? err({ code: "conflict", message: "stale" })
          : ok(undefined),
      );
    },
    store,
    1_000,
  );
  const pending = submit(STABLE);
  // 첫 제출이 conflict를 받은 뒤 새 근거가 온다.
  await new Promise((resolve) => setTimeout(resolve, 10));
  store.apply({
    begin: true,
    full: true,
    roots: [],
    folders: [],
    upsert: [],
    remove: [],
    more: false,
  });
  const result = await pending;
  assert(result.ok);
  assertEquals(attempts, 2);
});

Deno.test("documents/file-tracking#R7: 새 근거가 오지 않으면 conflict를 그대로 돌려주고 다시 제출하지 않는다", async () => {
  let attempts = 0;
  const submit = retryOnNewBasis(
    () => {
      attempts += 1;
      return Promise.resolve(err({ code: "conflict", message: "stale" }));
    },
    createBasisStore(),
    20,
  );
  const result = await submit(STABLE);
  assert(!result.ok);
  assertEquals(result.error.code, "conflict");
  assertEquals(attempts, 1);
});

Deno.test("documents/file-tracking#R7: conflict가 아닌 실패는 다시 제출하지 않는다", async () => {
  let attempts = 0;
  const submit = retryOnNewBasis(
    () => {
      attempts += 1;
      return Promise.resolve(err({ code: "unavailable", message: "down" }));
    },
    createBasisStore(),
    20,
  );
  const result = await submit(STABLE);
  assert(!result.ok);
  assertEquals(attempts, 1);
});

Deno.test("documents/versions#R5: 같은 바이트를 동시에 준비하면 한 번만 보내고 끝난 뒤에는 새로 보낸다", async () => {
  let prepared = 0;
  let fail = true;
  const share = sharePreparedBlob(async (bytes, hash) => {
    prepared += 1;
    await Promise.resolve();
    if (fail) return err({ code: "unavailable", message: "blob" });
    return ok({
      preparation: `prep-${prepared}`,
      principal: "machine:documents",
      purpose: "document_file",
      hash,
      size_bytes: bytes.length,
    });
  });
  const bytes = new Uint8Array(3);
  const hash = "c".repeat(64);
  const [one, two] = await Promise.all([
    share(bytes, hash),
    share(bytes, hash),
  ]);
  assert(!one.ok && !two.ok);
  assertEquals(prepared, 1);
  // 실패도 끝나면 남지 않아 다음 시도가 새로 보낸다. 다른 hash는 따로 간다.
  fail = false;
  const [three, four, other] = await Promise.all([
    share(bytes, hash),
    share(bytes, hash),
    share(new Uint8Array(4), "d".repeat(64)),
  ]);
  assert(three.ok && four.ok && other.ok);
  assertEquals(three.value, four.value);
  assertEquals(prepared, 3);
  const later = await share(bytes, hash);
  assert(later.ok);
  assertEquals(prepared, 4);
});
