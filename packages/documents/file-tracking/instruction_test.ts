import { assert, assertEquals, assertFalse } from "@std/assert";
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import { denoFileOps } from "./adapters/file-ops.ts";
import { createFileSerializer, type FileOps } from "./file-ops.ts";
import { writeFile } from "./files.ts";
import { fileReadPort, instructionReadPort } from "./fs.ts";
import {
  chunkObservationBasis,
  parseObservationBasis,
  parseObservationChunk,
} from "./basis.ts";
import {
  GLOBAL_INSTRUCTION_TARGET,
  type InstructionProject,
  instructionRegistrations,
  isUtf8,
  parseInstructionBasis,
} from "./instruction.ts";
import { observeInstructionFile } from "./instruction-work.ts";
import {
  type ObservationSubmit,
  readStably,
  type StableReadPort,
} from "./work.ts";

const HOME = "/home/p/.lophn";

function project(
  id: string,
  folders: string[],
  status: "active" | "archived" = "active",
): InstructionProject {
  return {
    id,
    revision: "7",
    status,
    folders: folders.map((path) => ({ path })),
  };
}

Deno.test("documents/file-tracking#R19: 등록은 전역 한 파일과 활성 project의 첫 폴더 바로 아래 LOPHN.md뿐이다", () => {
  const registrations = instructionRegistrations(HOME, [
    project("prj_a", ["/work/a", "/work/a2"]),
    project("prj_archived", ["/work/old"], "archived"),
    project("prj_empty", []),
  ]);
  assertEquals(registrations, [
    {
      instruction_target: GLOBAL_INSTRUCTION_TARGET,
      project: null,
      project_revision: null,
      instruction_revision: "1",
      path: `${HOME}/LOPHN.md`,
    },
    {
      instruction_target: "project:prj_a",
      project: "prj_a",
      project_revision: "7",
      instruction_revision: "7",
      path: "/work/a/LOPHN.md",
    },
  ]);
  // 부모 폴더·하위 폴더·AGENTS.md는 등록 경로가 아니다.
  const paths = registrations.map((entry) => entry.path);
  assertFalse(paths.includes("/work/LOPHN.md"));
  assertFalse(paths.includes("/work/a/docs/LOPHN.md"));
  assertFalse(paths.some((path) => path.endsWith("AGENTS.md")));
});

Deno.test("documents/file-tracking#R19: 지침 등록은 관측 근거 조각에 실리고 바뀌면 다시 보내며 모양이 틀리면 거절한다", () => {
  const instructions = instructionRegistrations(HOME, []).map((entry) => ({
    ...entry,
    link: null,
  }));
  const payload = { roots: [], folders: [], links: [], instructions };
  const chunks = chunkObservationBasis(undefined, payload);
  assertEquals(chunks.length, 1);
  const parsed = parseObservationChunk(JSON.parse(JSON.stringify(chunks[0])));
  assert(parsed.ok);
  assertEquals(parsed.value.instructions, instructions);
  // 같은 근거는 다시 보내지 않고, 지침 등록이 바뀌면 다시 보낸다.
  assertEquals(chunkObservationBasis(payload, payload), []);
  const changed = {
    ...payload,
    instructions: [{
      ...instructions[0]!,
      link: {
        document: "doc_x",
        document_revision: "3",
        status: "active" as const,
        latest_version: "ver_x",
        latest_hash: "ab".repeat(32),
        title: "Global instructions",
      },
    }],
  };
  assertEquals(chunkObservationBasis(payload, changed).length, 1);
  assert(parseObservationBasis({ ...payload, instructions }).ok);
  // project와 project_revision은 함께 null이거나 함께 있다.
  const broken = [{ ...instructions[0]!, project: "prj_a" }];
  assertFalse(parseInstructionBasis(broken).ok);
  assertFalse(parseInstructionBasis("nope").ok);
});

Deno.test("documents/file-tracking#R19: 지침 파일 바이트는 UTF-8이어야 한다", () => {
  assert(isUtf8(new TextEncoder().encode("# 지침\n")));
  assert(isUtf8(new Uint8Array()));
  assertFalse(isUtf8(new Uint8Array([0xff, 0xfe, 0x41])));
});

type Fake = {
  port: StableReadPort;
  opened: string[];
  submitted: ObservationSubmit[];
  missing: string[];
  stop: { stopped: boolean };
  nudge: { requested: boolean };
  ticks: number;
  now: number;
};

function fake(
  open: (path: string) => Result<Uint8Array>,
  maxTicks = 6,
  stepMs = 30_000,
): { fake: Fake; run: () => Promise<void> } {
  const state: Fake = {
    port: undefined as never,
    opened: [],
    submitted: [],
    missing: [],
    stop: { stopped: false },
    nudge: { requested: false },
    ticks: 0,
    now: 0,
  };
  const identity = {
    realPath: "/x",
    device: 1,
    inode: 1,
    size: 1,
    mtimeMs: 1,
  };
  state.port = {
    open(path) {
      state.opened.push(path);
      const body = open(path);
      if (!body.ok) return Promise.resolve(body);
      return Promise.resolve(ok({
        before: identity,
        read: () => Promise.resolve(body),
      }));
    },
    identity: () => Promise.resolve(ok(identity)),
    hash: (bytes) =>
      Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
  };
  return {
    fake: state,
    run: () =>
      observeInstructionFile({
        read: (path) => readStably(state.port, path),
        nowMs: () => state.now,
        submit(submission) {
          state.submitted.push(submission);
          return Promise.resolve(ok(undefined));
        },
        basisFor: (candidate) => ({
          project: "",
          projectRevision: "1",
          path: candidate.canonical,
          documentRevision: null,
          active: true,
          archived: false,
          rootPresent: true,
        }),
        missing: (candidate) => {
          state.missing.push(candidate.canonical);
        },
        stop: state.stop,
        nudge: state.nudge,
        waitTick() {
          state.ticks += 1;
          state.now += stepMs;
          if (state.ticks >= maxTicks) state.stop.stopped = true;
          return Promise.resolve();
        },
      }, { path: `${HOME}/LOPHN.md`, relative: "LOPHN.md" }),
  };
}

Deno.test("documents/file-tracking#R19: 지침 파일 관측은 등록된 exact 경로만 시작과 60초 주기로 읽는다", async () => {
  const { fake: state, run } = fake(() =>
    ok(new TextEncoder().encode("# rules"))
  );
  await run();
  // 시작 1번, 그 뒤 30초 tick이 60초·120초에 닿을 때 한 번씩. 그 밖의 경로는 열지 않는다.
  assertEquals(new Set(state.opened), new Set([`${HOME}/LOPHN.md`]));
  assertEquals(state.opened.length, 3);
  assertEquals(state.submitted.length, 3);
  const first = state.submitted[0]!;
  assertEquals(first.candidate.canonical, `${HOME}/LOPHN.md`);
  assertEquals(first.candidate.relative, "LOPHN.md");
  assertEquals(first.outcome.kind, "stable");
});

Deno.test("documents/file-tracking#R19 documents/file-tracking#R20: 사람이 쓴 직후(nudge)는 주기를 기다리지 않고 바로 다시 읽는다", async () => {
  const quiet = fake(() => ok(new TextEncoder().encode("a")), 2, 1_000);
  await quiet.run();
  assertEquals(quiet.fake.opened.length, 1);
  const nudged = fake(() => ok(new TextEncoder().encode("a")), 2, 1_000);
  nudged.fake.nudge.requested = true;
  await nudged.run();
  assertEquals(nudged.fake.opened.length, 2);
  assertFalse(nudged.fake.nudge.requested);
});

Deno.test("documents/file-tracking#R19 documents/file-tracking#R20: 파일이 없으면 판을 제출하지 않고 missing만 알리며 읽을 수 없는 파일은 unverified로 제출한다", async () => {
  const missing = fake(() =>
    err({ code: "not_found", message: "file is missing" })
  );
  await missing.run();
  assertEquals(missing.fake.submitted.length, 0);
  assertEquals(missing.fake.missing[0], `${HOME}/LOPHN.md`);
  const refused = fake(() =>
    err({ code: "invalid_input", message: "instruction file is a symlink" })
  );
  await refused.run();
  assertEquals(refused.fake.missing.length, 0);
  const outcome = refused.fake.submitted[0]!.outcome;
  assertEquals(outcome.kind, "unverified");
});

Deno.test("documents/file-tracking#R19: 실제 파일 port는 symlink·상위 폴더 symlink·폴더를 거절하고 일반 파일만 읽는다", async () => {
  const parent = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-instr-" }),
  );
  try {
    await Deno.writeTextFile(`${parent}/LOPHN.md`, "# global");
    const port = instructionReadPort(parent);
    const read = await port.open(`${parent}/LOPHN.md`);
    assert(read.ok);
    // 없는 파일은 not_found다.
    const absent = await port.open(`${parent}/none/LOPHN.md`);
    assert(!absent.ok);
    assertEquals(absent.error.code, "not_found");
    // 파일 symlink.
    await Deno.writeTextFile(`${parent}/real.md`, "x");
    await Deno.symlink(`${parent}/real.md`, `${parent}/link.md`);
    const link = await port.open(`${parent}/link.md`);
    assert(!link.ok);
    assertEquals(link.error.code, "invalid_input");
    // 상위 폴더가 symlink라 canonical 경로와 다르다.
    await Deno.mkdir(`${parent}/dir`);
    await Deno.writeTextFile(`${parent}/dir/LOPHN.md`, "# p");
    await Deno.symlink(`${parent}/dir`, `${parent}/dirlink`);
    const viaParent = await port.open(`${parent}/dirlink/LOPHN.md`);
    assert(!viaParent.ok);
    assertEquals(viaParent.error.code, "invalid_input");
    // 일반 파일이 아닌 대상.
    const folder = await port.open(`${parent}/dir`);
    assert(!folder.ok);
    assertEquals(folder.error.code, "invalid_input");
    // 일반 읽기 port는 이 검사를 하지 않는다(지침 port가 더한 검사다).
    const plain = await fileReadPort().open(`${parent}/link.md`);
    assert(plain.ok);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("documents/file-tracking#R20: 임시 폴더를 따로 준 쓰기는 대상 폴더에 임시 파일을 만들지 않고 미존재 CAS와 base_hash CAS를 따른다", async () => {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-instr-write-" }),
  );
  try {
    const target = `${root}/home`;
    const staging = `${root}/staging`;
    await Deno.mkdir(target);
    await Deno.mkdir(staging);
    const created: string[] = [];
    const base = denoFileOps();
    const ops: FileOps = {
      ...base,
      createTemp(path, mode) {
        created.push(path);
        return base.createTemp(path, mode);
      },
    };
    let counter = 0;
    const deps = {
      ops,
      serializer: createFileSerializer(),
      clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
      token: () => `t${++counter}`,
    };
    const sha = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    const write = (baseHash: string | null, text: string) =>
      writeFile(deps, {
        root: target,
        path: `${target}/LOPHN.md`,
        baseHash,
        content: (async function* () {
          yield new TextEncoder().encode(text);
        })(),
        contentHash: sha(text),
        tempRoot: staging,
      });
    // 파일이 없으면 최초 생성은 미존재 CAS다.
    const first = await write(null, "one");
    assert(first.ok, JSON.stringify(first));
    assertEquals(await Deno.readTextFile(`${target}/LOPHN.md`), "one");
    // 이미 있으면 다시 만들지 못한다.
    const again = await write(null, "other");
    assert(!again.ok);
    assertEquals(again.error.code, "conflict");
    // base_hash가 틀리면 덮지 않고, 맞으면 바뀐다.
    const stale = await write(sha("nope"), "two");
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    const next = await write(sha("one"), "two");
    assert(next.ok);
    assertEquals(await Deno.readTextFile(`${target}/LOPHN.md`), "two");
    // 임시 파일은 모두 staging에 만들었고 대상 폴더에는 대상 파일만 있다.
    assert(created.every((path) => path.startsWith(`${staging}/`)));
    const left: string[] = [];
    for await (const entry of Deno.readDir(target)) left.push(entry.name);
    assertEquals(left, ["LOPHN.md"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
