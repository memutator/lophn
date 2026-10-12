// documents/file-tracking#R19·R20, documents/versions#R19: 등록된 지침 파일의 관측이 준비 → machine
// document.save로 올라가고, 마지막 관측이 FileStatus 메모리에 남고, 일반 root 관측은 지침 파일을
// 건드리지 않는다. 사람의 지침 파일 쓰기는 exact 등록 경로만 푼다. 제출 본문은 contracts의 schema로
// 검사한다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok } from "../../../../base/mod.ts";
import {
  documentPrepareInputSchema,
  preparedVersionSchema,
} from "../../../../protocol/projects/mod.ts";
import {
  createStatusRecorder,
  type ObservationInstructionBasis,
  type ObservationSubmit,
} from "../mod.ts";
import {
  createInstructionSubmit,
  instructionBasisFromStore,
  type InstructionObservationPorts,
  poolInstructionRead,
  reportInstructionMissing,
  skipInstructionFiles,
} from "./observation.ts";
import { acceptFileOp } from "./file-requests.ts";
import { createByteInbox } from "./byte-inbox.ts";
import { PREPARATION_OPS } from "../mod.ts";
import { createBasisStore } from "./basis.ts";
import { createLocator } from "./files-locate.ts";
import { createRootObservers } from "./observers.ts";
import type { CoreClient } from "./submit.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const NEW_DOC = "doc_01arz3ndektsv4rrffq69g5faw";
const BASE = "ver_01arz3ndektsv4rrffq69g5fav";
const OLD = "ab".repeat(32);
const NEW = "cd".repeat(32);
const AT = "2026-10-06T00:00:00.000Z";
const HOME = "/home/p/.lophn";
const GLOBAL = `${HOME}/LOPHN.md`;

const REGISTERED: ObservationInstructionBasis = {
  instruction_target: "global",
  project: null,
  project_revision: null,
  instruction_revision: "1",
  path: GLOBAL,
  link: null,
};

const LINKED: ObservationInstructionBasis = {
  ...REGISTERED,
  link: {
    document: DOC,
    document_revision: "5",
    status: "active",
    latest_version: BASE,
    latest_hash: OLD,
    title: "Global instructions",
  },
};

const TARGET = {
  kind: "instruction_file" as const,
  instruction_target: "global",
  project: null,
  path: GLOBAL,
};

function store(...entries: ObservationInstructionBasis[]) {
  const basis = createBasisStore();
  basis.apply({
    begin: true,
    full: true,
    roots: [],
    folders: [],
    instructions: entries,
    upsert: [],
    remove: [],
    more: false,
  });
  return basis;
}

function stable(bytes: Uint8Array, hash = NEW): ObservationSubmit {
  return {
    candidate: {
      root: GLOBAL,
      canonical: GLOBAL,
      relative: "LOPHN.md",
      fact: "modified",
      lastSignalMs: 0,
      retries: 0,
    },
    basis: {
      project: "",
      projectRevision: "1",
      path: GLOBAL,
      documentRevision: null,
      active: true,
      archived: false,
      rootPresent: true,
    },
    outcome: {
      kind: "stable",
      read: {
        hash,
        bytes,
        identity: {
          realPath: GLOBAL,
          device: 1,
          inode: 2,
          size: bytes.length,
          mtimeMs: 1,
        },
      },
    },
  };
}

const TEXT = new TextEncoder().encode("# rules\n");

type Calls = { path: string; body: unknown }[];

function preparedVersion(body: { document: string; idempotency_key: string }) {
  return {
    document: body.document,
    base_version: null,
    files_hash: NEW,
    file_count: 1,
    primary_path: "LOPHN.md",
    content_hash: NEW,
    preparation_ref: "prep-list",
    files: [{
      path: "LOPHN.md",
      blob_hash: NEW,
      bytes: 8,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: "prep-file",
    }],
    idempotency_key: body.idempotency_key,
    metadata: { title: "Global instructions", place: null, name: null },
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
      kind: "instruction_file",
      instruction_target: "global",
      project: null,
      path: GLOBAL,
      instruction_revision: "1",
      project_revision: null,
      file_source: null,
      original_hash: NEW,
      observed_at: AT,
    },
    source: {
      kind: "instruction_file",
      instruction_target: "global",
      project: null,
      path: GLOBAL,
      original_hash: NEW,
      observed_at: AT,
    },
  };
}

function ports(
  calls: Calls,
  entry: ObservationInstructionBasis | undefined,
  override: { blob?: boolean } = {},
): InstructionObservationPorts {
  return {
    client: {
      call(path, body) {
        calls.push({ path, body });
        return path === "documents/prepare"
          ? Promise.resolve(ok(preparedVersion(body as never)))
          : Promise.resolve(ok({ status: "saved" }));
      },
    } as CoreClient,
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
    store: entry === undefined ? store() : store(entry),
    status: createStatusRecorder(),
    nowIso: () => AT,
    newKey: () => "key-1",
    newDocumentId: () => NEW_DOC,
  };
}

Deno.test("documents/file-tracking#R19 documents/versions#R19: 처음 관측한 전역 지침 파일은 place·name 없는 새 문서와 instruction_file 원본으로 제출된다", async () => {
  const calls: Calls = [];
  const wired = ports(calls, REGISTERED);
  const result = await createInstructionSubmit(wired)(stable(TEXT));
  assert(result.ok);
  assertEquals(calls.map((call) => call.path), [
    "documents/prepare",
    "documents/save",
  ]);
  const prepare = calls[0]!.body as {
    document: string;
    base_version: string | null;
    metadata: { place: unknown; name: unknown };
    source: { kind: string; instruction_target: string; project: unknown };
    file_basis: { kind: string; file_source: unknown };
  };
  assert(documentPrepareInputSchema.safeParse(prepare).success);
  assertEquals(prepare.document, NEW_DOC);
  assertEquals(prepare.base_version, null);
  assertEquals(prepare.metadata.place, null);
  assertEquals(prepare.metadata.name, null);
  assertEquals(prepare.source.kind, "instruction_file");
  assertEquals(prepare.source.instruction_target, "global");
  assertEquals(prepare.source.project, null);
  assertEquals(prepare.file_basis.kind, "instruction_file");
  assertEquals(prepare.file_basis.file_source, null);
  const save = calls[1]!.body as {
    input: unknown;
    compare: { base_version: string | null };
  };
  assert(preparedVersionSchema.safeParse(save.input).success);
  assertEquals(save.compare, { base_version: null });
  const status = wired.status.get(TARGET);
  assertEquals(status?.tracked, true);
  assertEquals(status?.observedHash, NEW);
  assertEquals(status?.latestHash, NEW);
});

Deno.test("documents/file-tracking#R19 documents/versions#R19: 이미 연결된 지침 문서의 외부 편집은 그 문서의 base_version과 문서 판을 근거로 새 판이 된다", async () => {
  const calls: Calls = [];
  const result = await createInstructionSubmit(ports(calls, LINKED))(
    stable(TEXT),
  );
  assert(result.ok);
  const prepare = calls[0]!.body as {
    document: string;
    base_version: string;
    file_basis: {
      file_source: { instruction_target: string };
      document_revision: string;
    };
  };
  assertEquals(prepare.document, DOC);
  assertEquals(prepare.base_version, BASE);
  assertEquals(prepare.file_basis.file_source.instruction_target, "global");
  assertEquals(prepare.file_basis.document_revision, "5");
  assertEquals(
    (calls[1]!.body as { compare: unknown }).compare,
    { base_version: BASE },
  );
});

Deno.test("documents/file-tracking#R19: 같은 내용이면 제출하지 않고 UTF-8이 아니거나 읽지 못하면 판 없이 상태만 남긴다", async () => {
  const same = ports([], LINKED);
  assert((await createInstructionSubmit(same)(stable(TEXT, OLD))).ok);
  assertEquals(same.status.get(TARGET)?.latestHash, OLD);
  const calls: Calls = [];
  const binary = ports(calls, REGISTERED);
  const bad = await createInstructionSubmit(binary)(
    stable(new Uint8Array([0xff, 0xfe, 0x41])),
  );
  assert(bad.ok);
  assertEquals(calls.length, 0);
  assertEquals(binary.status.get(TARGET)?.validationFailed, true);
  const refused = ports(calls, REGISTERED);
  const unverified = stable(TEXT);
  unverified.outcome = {
    kind: "unverified",
    reason: "instruction file owner differs",
  };
  assert((await createInstructionSubmit(refused)(unverified)).ok);
  assertEquals(calls.length, 0);
  assertEquals(refused.status.get(TARGET)?.unverified, true);
  const blob = ports(calls, REGISTERED, { blob: false });
  assert(!(await createInstructionSubmit(blob)(stable(TEXT))).ok);
  assertEquals(calls.length, 0);
});

Deno.test("documents/file-tracking#R19: 등록에서 사라진 파일의 늦은 제출은 not_found고 보관 문서에는 판을 만들지 않는다", async () => {
  const calls: Calls = [];
  const gone = await createInstructionSubmit(ports(calls, undefined))(
    stable(TEXT),
  );
  assert(!gone.ok);
  assertEquals(gone.error.code, "not_found");
  const archived = ports(calls, {
    ...LINKED,
    link: { ...LINKED.link!, status: "archived" },
  });
  assert((await createInstructionSubmit(archived)(stable(TEXT))).ok);
  assertEquals(calls.length, 0);
  assertEquals(archived.status.get(TARGET)?.unverified, true);
});

Deno.test("documents/file-tracking#R19 documents/file-tracking#R20: 파일이 없으면 첫 저장 전에는 추적 중이 아니고 연결 문서가 있으면 source_missing이다", () => {
  const first = ports([], REGISTERED);
  reportInstructionMissing(first, stable(TEXT).candidate);
  const missing = first.status.get(TARGET);
  assertEquals(missing?.missing, true);
  assertEquals(missing?.tracked, false);
  const linked = ports([], LINKED);
  reportInstructionMissing(linked, stable(TEXT).candidate);
  assertEquals(linked.status.get(TARGET)?.tracked, true);
  assertEquals(linked.status.get(TARGET)?.missing, true);
  assertEquals(linked.status.get(TARGET)?.latestHash, OLD);
});

Deno.test("documents/file-tracking#R19: 일반 root 관측은 등록된 지침 파일을 project 문서로 만들지 않는다", async () => {
  const seen: string[] = [];
  const inner = (submission: ObservationSubmit) => {
    seen.push(submission.candidate.canonical);
    return Promise.resolve(ok(undefined));
  };
  const wrapped = skipInstructionFiles(inner, store(REGISTERED));
  await wrapped(stable(TEXT));
  const other = stable(TEXT);
  other.candidate.canonical = "/work/a.md";
  await wrapped(other);
  assertEquals(seen, ["/work/a.md"]);
});

Deno.test("documents/file-tracking#R19: 제출 근거는 등록과 연결 문서의 판을 비교한다", () => {
  const check = instructionBasisFromStore(store(LINKED));
  const basis = check(stable(TEXT).candidate);
  assertEquals(basis.documentRevision, "5");
  assertEquals(basis.rootPresent, true);
  const dropped = instructionBasisFromStore(store())(stable(TEXT).candidate);
  assertEquals(dropped.rootPresent, false);
});

Deno.test("documents/file-tracking#R19: 지침 loop는 등록된 파일마다 하나이고 등록이 사라지면 멈추며 일반 root loop와 따로다", () => {
  const basis = store(REGISTERED);
  const started: string[] = [];
  const observers = createRootObservers({
    store: basis,
    observe: () => Promise.resolve(),
    deps: {} as never,
    instruction: {
      deps: {} as never,
      observe(deps, request) {
        started.push(request.path);
        return new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (deps.stop?.stopped) {
              clearInterval(timer);
              resolve();
            }
          }, 5);
        });
      },
    },
  });
  observers.sync();
  observers.sync();
  assertEquals(started, [GLOBAL]);
  assertEquals(observers.runningInstructions(), [GLOBAL]);
  assertEquals(observers.running(), []);
  // 등록 밖 경로의 nudge는 아무것도 하지 않는다.
  observers.nudge("/elsewhere/LOPHN.md");
  basis.apply({
    begin: true,
    full: true,
    roots: [],
    folders: [],
    instructions: [],
    upsert: [],
    remove: [],
    more: false,
  });
  observers.sync();
  assertEquals(observers.runningInstructions(), []);
  observers.stopAll();
});

function locator(...entries: ObservationInstructionBasis[]) {
  const made: string[] = [];
  const built = createLocator({
    dataRoot: HOME,
    basis: {
      folders: () => [{ project: PROJECT, path: "/work/a" }],
      instructions: () => entries,
    },
    ops: {
      realPath: (path) => Promise.resolve(path),
      makeDirectory: (path) => {
        made.push(path);
        return Promise.resolve();
      },
    },
  });
  return { built, made };
}

Deno.test("documents/file-tracking#R19 documents/file-tracking#R20: 지침 파일 목표는 exact 등록 경로·대상·층만 풀고 전역 파일의 임시 폴더는 staging이다", async () => {
  const projectEntry: ObservationInstructionBasis = {
    instruction_target: `project:${PROJECT}`,
    project: PROJECT,
    project_revision: "4",
    instruction_revision: "4",
    path: "/work/a/LOPHN.md",
    link: null,
  };
  const { built, made } = locator(REGISTERED, projectEntry);
  const global = await built.locate(TARGET);
  assert(global.ok);
  assertEquals(global.value.location, {
    root: HOME,
    path: GLOBAL,
    temp_root: `${HOME}/documents/staging`,
  });
  assertEquals(made, [`${HOME}/documents`, `${HOME}/documents/staging`]);
  const scoped = await built.locate({
    kind: "instruction_file",
    instruction_target: `project:${PROJECT}`,
    project: PROJECT,
    path: "/work/a/LOPHN.md",
  });
  assert(scoped.ok);
  assertEquals(scoped.value.location, {
    root: "/work/a",
    path: "/work/a/LOPHN.md",
  });
  // 등록에 없는 경로·AGENTS.md·다른 대상·다른 층의 project는 모두 같은 invalid_input이다.
  for (
    const target of [
      { ...TARGET, path: `${HOME}/other.md` },
      { ...TARGET, path: `${HOME}/AGENTS.md` },
      { ...TARGET, path: "/work/a/LOPHN.md" },
      { ...TARGET, instruction_target: "project:prj_other" },
      {
        kind: "instruction_file" as const,
        instruction_target: `project:${PROJECT}`,
        project: "prj_other",
        path: "/work/a/LOPHN.md",
      },
    ]
  ) {
    const rejected = await built.locate(target);
    assertFalse(rejected.ok);
    assertEquals(rejected.error.code, "invalid_input");
  }
  const none = await locator().built.locate(TARGET);
  assertFalse(none.ok);
});

async function readOp(
  home: string,
  path: string,
  channel = 7,
): Promise<
  { result: Awaited<ReturnType<typeof acceptFileOp>>; sent: Uint8Array[] }
> {
  const sent: Uint8Array[] = [];
  const result = await acceptFileOp(
    {
      type: "worker_request",
      request_id: "r1",
      op: PREPARATION_OPS.readInstruction,
      payload: { path, data_root: home, channel },
    } as never,
    createByteInbox(),
    undefined,
    {
      send(_channel, bytes) {
        sent.push(bytes);
        return Promise.resolve();
      },
    },
  );
  return { result, sent };
}

Deno.test("documents/file-tracking#R19: 준비 worker의 지침 읽기는 안정 읽기한 hash·바이트를 byte frame으로 보내고 symlink·폴더·없는 파일·큰 파일을 구별한다", async () => {
  const home = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-instr-read-" }),
  );
  try {
    await Deno.writeTextFile(`${home}/LOPHN.md`, "# 지침\n");
    const ok1 = await readOp(home, `${home}/LOPHN.md`);
    const done = await ok1.result!;
    assert(done.ok);
    const value = done.value as { kind: string; hash: string; bytes: number };
    assertEquals(value.kind, "stable");
    assertEquals(value.bytes, new TextEncoder().encode("# 지침\n").length);
    assertEquals(ok1.sent.length, 1);
    assertEquals(new TextDecoder().decode(ok1.sent[0]), "# 지침\n");
    // 빈 파일은 부재가 아니다. 보낼 바이트가 없다.
    await Deno.writeTextFile(`${home}/empty.md`, "");
    const empty = await (await readOp(home, `${home}/empty.md`)).result!;
    assert(empty.ok);
    assertEquals((empty.value as { bytes: number }).bytes, 0);
    // 없는 파일은 not_found, symlink·폴더는 invalid_input이다.
    const missing = await (await readOp(home, `${home}/none.md`)).result!;
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
    await Deno.symlink(`${home}/LOPHN.md`, `${home}/link.md`);
    const link = await (await readOp(home, `${home}/link.md`)).result!;
    assert(!link.ok);
    assertEquals(link.error.code, "invalid_input");
    await Deno.mkdir(`${home}/dir`);
    const dir = await (await readOp(home, `${home}/dir`)).result!;
    assert(!dir.ok);
    assertEquals(dir.error.code, "invalid_input");
    // 한 frame에 들어오지 않는 파일은 판을 만들 수 없어 미확인이다.
    await Deno.writeFile(`${home}/big.md`, new Uint8Array(300 * 1024).fill(65));
    const big = await readOp(home, `${home}/big.md`);
    const bigDone = await big.result!;
    assert(bigDone.ok);
    assertEquals((bigDone.value as { kind: string }).kind, "unverified");
    assertEquals(big.sent.length, 0);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/file-tracking#R19: coordinator는 준비 worker의 지침 읽기 응답을 안정 읽기 결과로 받는다", async () => {
  const bytes = new TextEncoder().encode("# rules\n");
  const seen: unknown[] = [];
  const read = poolInstructionRead({
    request(request) {
      seen.push(
        typeof request.payload === "function"
          ? request.payload(0, 9)
          : request.payload,
      );
      return Promise.resolve(ok({
        payload: {
          kind: "stable",
          hash: NEW,
          identity: {
            realPath: GLOBAL,
            device: 1,
            inode: 2,
            size: bytes.length,
            mtimeMs: 3,
          },
          bytes: bytes.length,
        },
        bytes,
      }));
    },
  }, HOME);
  const stableRead = await read(GLOBAL);
  assert(stableRead.ok);
  assertEquals(stableRead.value.kind, "stable");
  assertEquals(seen, [{ path: GLOBAL, data_root: HOME, channel: 9 }]);
  const unverified = await poolInstructionRead({
    request: () =>
      Promise.resolve(ok({
        payload: { kind: "unverified", reason: "file changed while reading" },
        bytes: new Uint8Array(),
      })),
  }, HOME)(GLOBAL);
  assert(unverified.ok);
  assertEquals(unverified.value.kind, "unverified");
  const missing = await poolInstructionRead({
    request: () =>
      Promise.resolve(err({ code: "not_found", message: "file is missing" })),
  }, HOME)(GLOBAL);
  assert(!missing.ok);
  assertEquals(missing.error.code, "not_found");
});
