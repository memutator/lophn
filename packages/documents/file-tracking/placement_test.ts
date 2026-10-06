import { assert, assertEquals, assertFalse } from "@std/assert";
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  ContentFile,
  Document,
  FileSource,
  PlaceRef,
  Project,
  Slug,
  TrackingPreview,
} from "../../contracts/documents/mod.ts";
import { denoFileOps } from "./adapters/file-ops.ts";
import { createFileSerializer, type FileOps } from "./file-ops.ts";
import {
  gitignoreChain,
  placeDocumentFile,
  type PlacementCommands,
  type PlacementDeps,
  type PlacementLedger,
  removeDocumentFile,
} from "./placement.ts";

const encoder = new TextEncoder();
const USER = "user";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const VERSION = "ver_01arz3ndektsv4rrffq69g5fav";
const TEXT = "# Plan\n\nlatest version bytes\n";

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

type World = {
  root: string;
  document: Document;
  project: Project;
  files: ContentFile[];
  // 저장 바이트. 기본은 files[0].blob_hash가 가리키는 TEXT다.
  stored: string;
  linkedPaths: Map<string, string>;
  gitignore: string | null;
  calls: string[];
  seq: number;
  // command 직전에 부르는 훅. 그 사이 끼어드는 다른 변경을 만든다.
  before: (call: string) => void;
  fail: Map<string, { code: "conflict" | "forbidden"; message: string }>;
  revisionsSeen: Map<string, string>;
};

function documentOf(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC,
    place: null,
    name: null,
    title: "Plan",
    file_source: null,
    latest_version: VERSION,
    revision: "3",
    status: "active",
    ...overrides,
  };
}

function worldAt(
  root: string,
  overrides: { tracking?: Partial<Project["tracking"]> } = {},
): World {
  return {
    root,
    document: documentOf(),
    project: {
      id: PROJECT,
      name: "notes" as Slug,
      title: "Notes",
      purpose: "",
      folders: [{ path: root, description: "" }],
      tracking: {
        enabled: true,
        patterns: [{ effect: "include", glob: "**/*.md" }],
        use_gitignore: true,
        ...overrides.tracking,
      },
      revision: "5",
      status: "active",
    },
    files: [{
      path: "plan.md",
      blob_hash: sha(TEXT),
      bytes: encoder.encode(TEXT).length,
      media_type: "text/markdown",
      primary: true,
    }],
    stored: TEXT,
    linkedPaths: new Map(),
    gitignore: null,
    calls: [],
    seq: 10,
    before: () => {},
    fail: new Map(),
    revisionsSeen: new Map(),
  };
}

function ledgerOf(world: World): PlacementLedger {
  return {
    document: (id) =>
      Promise.resolve(ok(id === world.document.id ? world.document : null)),
    project: (id) =>
      Promise.resolve(ok(id === world.project.id ? world.project : null)),
    latest: () =>
      Promise.resolve(
        ok({ version: VERSION, files: world.files }),
      ),
    linked: (path) => Promise.resolve(ok(world.linkedPaths.get(path) ?? null)),
    async *content() {
      const bytes = encoder.encode(world.stored);
      for (let at = 0; at < bytes.length; at += 7) {
        yield bytes.subarray(at, at + 7);
      }
    },
    placeName: () => Promise.resolve(ok("plan" as Slug)),
    gitignore: (_root, relative) =>
      Promise.resolve(
        ok(
          world.gitignore === null ? [] : [{
            directory: "",
            text: world.gitignore,
          }],
        ),
      ).then((value) => {
        void relative;
        return value;
      }),
    previewTracking: (request) =>
      Promise.resolve(ok<TrackingPreview>({
        project: request.project,
        base_revision: request.baseRevision,
        folders: [...request.folders],
        tracking: request.tracking,
        observed_at: "2026-10-06T00:00:00.000Z",
        entries: [],
        complete: true,
        next_cursor: null,
      })),
  };
}

// command는 요청의 compare를 현재 revision과 대조한다(실제 command의 CAS와 같다).
function commandsOf(world: World): PlacementCommands {
  const bump = () => String(++world.seq);
  const guard = <T>(
    name: string,
    base: string,
    current: string,
    apply: () => T,
  ): Result<T> => {
    world.before(name);
    world.calls.push(name);
    world.revisionsSeen.set(name, base);
    const forced = world.fail.get(name);
    if (forced !== undefined) return err(forced);
    // 훅이 revision을 올렸을 수 있으므로 호출 시점의 값으로 대조한다.
    const now = name === "setTracking"
      ? world.project.revision
      : world.document.revision;
    void current;
    if (base !== now) {
      return err({ code: "conflict", message: "revision changed" });
    }
    return ok(apply());
  };
  return {
    setTracking: (input, compare) =>
      Promise.resolve(guard("setTracking", compare.base_revision, "", () => {
        world.project = {
          ...world.project,
          tracking: input.tracking,
          revision: bump(),
        };
        return world.project;
      })),
    move: (input, compare) =>
      Promise.resolve(guard("move", compare.base_revision, "", () => {
        world.document = {
          ...world.document,
          place: input.place as PlaceRef | null,
          name: input.name,
          revision: bump(),
        };
        return world.document;
      })),
    setSource: (input, compare) =>
      Promise.resolve(guard("setSource", compare.base_revision, "", () => {
        world.document = {
          ...world.document,
          file_source: input.file_source as FileSource | null,
          revision: bump(),
        };
        return world.document;
      })),
    recordFile: (entry) => {
      world.calls.push(`record:${entry.operation}`);
      return Promise.resolve(ok(undefined));
    },
  };
}

function depsOf(world: World, ops: FileOps = denoFileOps()): PlacementDeps {
  let counter = 0;
  return {
    files: {
      ops,
      serializer: createFileSerializer(),
      clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
      token: () => `p${++counter}`,
    },
    ledger: ledgerOf(world),
    commands: commandsOf(world),
  };
}

async function withWorld(
  run: (world: World, root: string) => Promise<void>,
  overrides: { tracking?: Partial<Project["tracking"]> } = {},
): Promise<void> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-placement-" }),
  );
  try {
    await run(worldAt(root, overrides), root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function placing(world: World, path: string, actor = USER) {
  return {
    actor,
    requestKey: "req-1",
    document: DOC,
    project: PROJECT,
    path: `${world.root}/${path}`,
  };
}

async function names(root: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(root)) found.push(entry.name);
  return found.sort();
}

Deno.test("documents/file-tracking#R13: 두기는 최신 판 바이트를 새 파일로 쓴 뒤 추적·자리·원본 연결을 이 순서로 각각 확정한다", async () => {
  await withWorld(async (world, root) => {
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "notes/plan.txt"),
    );
    // 패턴(**/*.md) 밖 경로다. 폴더가 없으면 만들지 않으므로 먼저 둔다.
    assert(!placed.ok);
    assertEquals(placed.error.code, "invalid_input");
    assertEquals(world.calls, []);
    await Deno.mkdir(`${root}/notes`);
    const done = await placeDocumentFile(
      depsOf(world),
      placing(world, "notes/plan.txt"),
    );
    assert(done.ok);
    assertEquals(done.value.file.outcome, "written");
    assertEquals(done.value.file.writtenHash, sha(TEXT));
    assertEquals(done.value.recording, "recorded");
    assertEquals(done.value.tracking, { state: "done" });
    assertEquals(done.value.move, { state: "done" });
    assertEquals(done.value.source, { state: "done" });
    assertEquals(world.calls, [
      "record:write",
      "setTracking",
      "move",
      "setSource",
    ]);
    // 파일 바이트는 최신 판 그대로고 임시 파일은 남지 않는다.
    assertEquals(await Deno.readTextFile(`${root}/notes/plan.txt`), TEXT);
    assertEquals(await names(`${root}/notes`), ["plan.txt"]);
    assertEquals(world.document.file_source, {
      kind: "project_file",
      project: PROJECT,
      path: `${root}/notes/plan.txt`,
    });
    assertEquals(world.document.place, { kind: "project", id: PROJECT });
    assertEquals(world.document.name, "plan");
  });
});

Deno.test("documents/projects#R12: 패턴 밖 파일은 그 파일 하나의 include가 적용되고 패턴 안 파일은 규칙을 바꾸지 않는다", async () => {
  await withWorld(async (world, root) => {
    const outside = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.txt"),
    );
    assert(outside.ok);
    assertEquals(outside.value.tracking, { state: "done" });
    assertEquals(world.project.tracking.patterns, [
      { effect: "include", glob: "**/*.md" },
      { effect: "include", glob: "plan.txt" },
    ]);
    assertEquals(world.project.tracking.use_gitignore, true);
    assertEquals(world.project.tracking.enabled, true);
    // 패턴 안 파일은 규칙을 건드리지 않는다.
    const before = world.project;
    world.document = documentOf();
    world.calls.length = 0;
    const inside = await placeDocumentFile(
      depsOf(world),
      placing(world, "other.md"),
    );
    assert(inside.ok);
    assertEquals(inside.value.tracking.state, "skipped");
    assertEquals(world.project, before);
    assertFalse(world.calls.includes("setTracking"));
    assertEquals(await names(root), ["other.md", "plan.txt"]);
  });
});

Deno.test("documents/projects#R12: 추적이 꺼진 프로젝트에 두는 요청은 conflict고 파일도 연결도 만들지 않는다", async () => {
  await withWorld(async (world, root) => {
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!placed.ok);
    assertEquals(placed.error.code, "conflict");
    assertEquals(await names(root), []);
    assertEquals(world.calls, []);
    assertEquals(world.document.file_source, null);
  }, { tracking: { enabled: false } });
});

Deno.test("documents/projects#R12: .gitignore가 가리는 파일은 include를 더해도 추적되지 않으므로 파일을 만들기 전에 conflict다", async () => {
  await withWorld(async (world, root) => {
    world.gitignore = "plan.md\n";
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!placed.ok);
    assertEquals(placed.error.code, "conflict");
    assertEquals(await names(root), []);
    assertEquals(world.calls, []);
  });
});

Deno.test("documents/file-tracking#R13: 확인과 생성 사이에 만들어진 파일은 덮지 않고 연결도 하지 않는다", async () => {
  await withWorld(async (world, root) => {
    const real = denoFileOps();
    // 확인(대상 없음)을 지나 임시 파일을 만들 때 다른 프로그램이 같은 이름을 만든다.
    const ops: FileOps = {
      ...real,
      createTemp: async (path, mode) => {
        await Deno.writeTextFile(`${root}/plan.md`, "someone else");
        return await real.createTemp(path, mode);
      },
    };
    const placed = await placeDocumentFile(
      depsOf(world, ops),
      placing(world, "plan.md"),
    );
    assert(!placed.ok);
    assertEquals(placed.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/plan.md`), "someone else");
    assertEquals(await names(root), ["plan.md"]);
    assertEquals(world.calls, []);
    assertEquals(world.document.file_source, null);
  });
});

Deno.test("documents/file-tracking#R13: 이미 있는 파일 위에 두는 요청은 덮지 않고 conflict다", async () => {
  await withWorld(async (world, root) => {
    await Deno.writeTextFile(`${root}/plan.md`, "already here");
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!placed.ok);
    assertEquals(placed.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/plan.md`), "already here");
    assertEquals(world.calls, []);
  });
});

Deno.test("documents/file-tracking#R13: 저장 바이트가 판이 기록한 hash와 다르면 파일을 설치하지 않는다", async () => {
  await withWorld(async (world, root) => {
    world.stored = "corrupted bytes";
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!placed.ok);
    assertEquals(placed.error.code, "invalid_input");
    assertEquals(await names(root), []);
    assertEquals(world.calls, []);
  });
});

Deno.test("documents/file-tracking#R13: 연결 확정이 실패해도 파일은 남고 실패한 단계와 건너뛴 단계가 따로 보인다", async () => {
  await withWorld(async (world, root) => {
    world.fail.set("setSource", {
      code: "conflict",
      message: "file is already linked to a document",
    });
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(placed.ok);
    assertEquals(placed.value.file.outcome, "written");
    assertEquals(placed.value.recording, "recorded");
    assertEquals(placed.value.tracking.state, "skipped");
    assertEquals(placed.value.move, { state: "done" });
    assertEquals(placed.value.source, {
      state: "failed",
      error: {
        code: "conflict",
        message: "file is already linked to a document",
      },
    });
    assertEquals(await Deno.readTextFile(`${root}/plan.md`), TEXT);
    assertEquals(world.document.file_source, null);
  });
});

Deno.test("documents/file-tracking#R13: 앞 단계가 실패하면 뒤 단계는 시도하지 않고 파일은 그대로 둔다", async () => {
  await withWorld(async (world, root) => {
    world.fail.set("move", { code: "conflict", message: "name is reserved" });
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(placed.ok);
    assertEquals(placed.value.move.state, "failed");
    assertEquals(placed.value.source, { state: "not_attempted" });
    assertFalse(world.calls.includes("setSource"));
    assertEquals(await names(root), ["plan.md"]);
  });
});

Deno.test("documents/file-tracking#R13: 각 연결 단계는 그 순간의 현재 revision으로 확정한다", async () => {
  await withWorld(async (world) => {
    // 앞 단계가 프로젝트·문서 revision을 올린 뒤 다음 단계는 처음 읽은 값이 아니라 지금 값으로 확정한다.
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.txt"),
    );
    assert(placed.ok);
    assertEquals(placed.value.tracking, { state: "done" });
    assertEquals(placed.value.move, { state: "done" });
    assertEquals(placed.value.source, { state: "done" });
    // 처음 문서 revision은 3, move가 12로 올렸고 source는 그 12로 확정했다.
    assertEquals(world.revisionsSeen.get("setTracking"), "5");
    assertEquals(world.revisionsSeen.get("move"), "3");
    assertEquals(world.revisionsSeen.get("setSource"), "12");
  });
  await withWorld(async (world) => {
    // move가 막 읽은 revision 뒤에 다른 변경이 끼면 그 단계는 conflict로 멈추고 파일은 남는다.
    world.before = (call) => {
      if (call === "setSource") {
        world.document = { ...world.document, revision: "99" };
      }
    };
    const placed = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(placed.ok);
    assertEquals(placed.value.move, { state: "done" });
    assertEquals(placed.value.source.state, "failed");
    assertEquals(world.document.file_source, null);
  });
});

Deno.test("documents/file-tracking#R13: user만 두고 빼며 범위 밖 경로·없는 대상은 같은 invalid_input이다", async () => {
  await withWorld(async (world, root) => {
    for (
      const actor of [
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        "app:app_01arz3ndektsv4rrffq69g5fav",
        "machine",
      ]
    ) {
      const placed = await placeDocumentFile(
        depsOf(world),
        placing(world, "plan.md", actor),
      );
      assert(!placed.ok, actor);
      assertEquals(placed.error.code, "forbidden", actor);
    }
    assertEquals(await names(root), []);
    assertEquals(world.calls, []);
    const messages = new Set<string>();
    for (
      const path of [
        "/elsewhere/plan.md",
        `${root}-other/plan.md`,
        `${root}/.git/plan.md`,
        `${root}/missing-dir/plan.md`,
        root,
      ]
    ) {
      const placed = await placeDocumentFile(depsOf(world), {
        ...placing(world, "x"),
        path,
      });
      assert(!placed.ok, path);
      assertEquals(placed.error.code, "invalid_input", path);
      messages.add(placed.error.message);
    }
    assertEquals(messages.size, 1);
    assertEquals(await names(root), []);
  });
});

Deno.test("documents/file-tracking#R13: 이미 연결된 문서·첨부가 있는 판·다른 문서가 쓰는 경로는 두지 않는다", async () => {
  await withWorld(async (world, root) => {
    world.document = documentOf({
      file_source: {
        kind: "project_file",
        project: PROJECT,
        path: `${root}/old.md`,
      },
    });
    const linked = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!linked.ok);
    assertEquals(linked.error.code, "conflict");
    world.document = documentOf();
    world.files = [
      ...world.files,
      {
        path: "cover.png",
        blob_hash: sha("png"),
        bytes: 3,
        media_type: "image/png",
        primary: false,
      },
    ];
    const attached = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!attached.ok);
    assertEquals(attached.error.code, "invalid_input");
    world.files = world.files.slice(0, 1);
    world.linkedPaths.set(`${root}/plan.md`, "doc_other");
    const taken = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!taken.ok);
    assertEquals(taken.error.code, "conflict");
    world.document = documentOf({ status: "archived" });
    world.linkedPaths.clear();
    const archived = await placeDocumentFile(
      depsOf(world),
      placing(world, "plan.md"),
    );
    assert(!archived.ok);
    assertEquals(archived.error.code, "conflict");
    assertEquals(await names(root), []);
    assertEquals(world.calls, []);
  });
});

Deno.test("documents/file-tracking#R16: 디스크가 받지 못하면 unavailable이고 파일도 연결도 남지 않는다", async () => {
  await withWorld(async (world, root) => {
    const real = denoFileOps();
    const ops: FileOps = {
      ...real,
      createTemp: () => {
        throw Object.assign(new Error("read only"), { code: "EROFS" });
      },
    };
    const placed = await placeDocumentFile(
      depsOf(world, ops),
      placing(world, "plan.md"),
    );
    assert(!placed.ok);
    assertEquals(placed.error.code, "unavailable");
    assertEquals(await names(root), []);
    assertEquals(world.calls, []);
  });
});

// 빼기 ────────────────────────────────────────────────────────────────

async function linkedWorld(
  world: World,
  root: string,
  disk: string = TEXT,
): Promise<string> {
  const path = `${root}/plan.md`;
  await Deno.writeTextFile(path, disk);
  world.document = documentOf({
    place: { kind: "project", id: PROJECT },
    name: "plan" as Slug,
    file_source: { kind: "project_file", project: PROJECT, path },
  });
  return path;
}

function removing(world: World, baseHash: string = sha(TEXT), actor = USER) {
  void world;
  return { actor, requestKey: "req-2", document: DOC, baseHash };
}

Deno.test("documents/file-tracking#R14: 디스크 내용이 최신 판과 같으면 파일을 지우고 연결을 풀고 자리를 되돌린다", async () => {
  await withWorld(async (world, root) => {
    await linkedWorld(world, root);
    const removed = await removeDocumentFile(depsOf(world), removing(world));
    assert(removed.ok);
    assertEquals(removed.value.file?.outcome, "deleted");
    assertEquals(removed.value.file?.beforeHash, sha(TEXT));
    assertEquals(removed.value.recording, "recorded");
    assertEquals(removed.value.source, { state: "done" });
    assertEquals(removed.value.move, { state: "done" });
    assertEquals(world.calls, ["record:delete", "setSource", "move"]);
    assertEquals(await names(root), []);
    assertEquals(world.document.file_source, null);
    assertEquals(world.document.place, null);
    assertEquals(world.document.name, null);
  });
});

Deno.test("documents/file-tracking#R14: 파일을 고친 뒤 되돌리면 conflict고 파일과 연결은 그대로다", async () => {
  await withWorld(async (world, root) => {
    const path = await linkedWorld(world, root, "edited by the human");
    const removed = await removeDocumentFile(depsOf(world), removing(world));
    assert(!removed.ok);
    assertEquals(removed.error.code, "conflict");
    assertEquals(await Deno.readTextFile(path), "edited by the human");
    assertEquals(world.calls, []);
    assert(world.document.file_source !== null);
    assert(world.document.place !== null);
  });
});

Deno.test("documents/file-tracking#R14: 확인 뒤 지우기 직전에 고쳐져도 지우지 않는다", async () => {
  await withWorld(async (world, root) => {
    const path = await linkedWorld(world, root);
    const real = denoFileOps();
    // 시작 대조를 지난 뒤(삭제 직전 재검사 전에) 다른 프로그램이 파일을 고친다.
    let touched = false;
    const ops: FileOps = {
      ...real,
      lstat: async (target) => {
        const stat = await real.lstat(target);
        if (!touched && target === path && stat !== undefined) {
          const reads = reading;
          if (reads > 0) {
            touched = true;
            await Deno.writeTextFile(path, "changed at the last moment!");
          }
        }
        return stat;
      },
      read: (target) => {
        reading += 1;
        return real.read(target);
      },
    };
    let reading = 0;
    const removed = await removeDocumentFile(
      depsOf(world, ops),
      removing(world),
    );
    assert(!removed.ok);
    assertEquals(removed.error.code, "conflict");
    assertEquals(await Deno.readTextFile(path), "changed at the last moment!");
    assertEquals(world.calls, []);
  });
});

Deno.test("documents/file-tracking#R14: 사람이 확인한 내용이 최신 판의 원문이 아니면 지우지 않는다", async () => {
  await withWorld(async (world, root) => {
    const path = await linkedWorld(world, root);
    const removed = await removeDocumentFile(
      depsOf(world),
      removing(world, sha("some older content")),
    );
    assert(!removed.ok);
    assertEquals(removed.error.code, "conflict");
    assertEquals(await Deno.readTextFile(path), TEXT);
    assertEquals(world.calls, []);
  });
});

Deno.test("documents/file-tracking#R14: 이미 없는 파일은 지울 것 없이 연결을 풀고 자리를 되돌린다", async () => {
  await withWorld(async (world, root) => {
    const path = await linkedWorld(world, root);
    await Deno.remove(path);
    const removed = await removeDocumentFile(depsOf(world), removing(world));
    assert(removed.ok);
    assertEquals(removed.value.file, null);
    assertEquals(removed.value.recording, "not_requested");
    assertEquals(removed.value.source, { state: "done" });
    assertEquals(removed.value.move, { state: "done" });
    assertEquals(world.calls, ["setSource", "move"]);
  });
});

Deno.test("documents/file-tracking#R14: 지운 뒤 연결 해제가 실패하면 지운 사실과 실패한 단계가 따로 보이고 자리 되돌리기는 시도하지 않는다", async () => {
  await withWorld(async (world, root) => {
    await linkedWorld(world, root);
    world.fail.set("setSource", {
      code: "conflict",
      message: "document revision changed",
    });
    const removed = await removeDocumentFile(depsOf(world), removing(world));
    assert(removed.ok);
    assertEquals(removed.value.file?.outcome, "deleted");
    assertEquals(removed.value.source.state, "failed");
    assertEquals(removed.value.move, { state: "not_attempted" });
    assertEquals(await names(root), []);
    // 연결은 자동으로 사라지지 않는다.
    assert(world.document.file_source !== null);
  });
});

Deno.test("documents/file-tracking#R14: 연결되지 않은 문서와 user가 아닌 요청은 거절한다", async () => {
  await withWorld(async (world, root) => {
    const path = await linkedWorld(world, root);
    for (
      const actor of [
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        "machine",
      ]
    ) {
      const removed = await removeDocumentFile(
        depsOf(world),
        removing(world, sha(TEXT), actor),
      );
      assert(!removed.ok, actor);
      assertEquals(removed.error.code, "forbidden", actor);
    }
    assertEquals(await Deno.readTextFile(path), TEXT);
    world.document = documentOf();
    const unlinked = await removeDocumentFile(depsOf(world), removing(world));
    assert(!unlinked.ok);
    assertEquals(unlinked.error.code, "conflict");
    assertEquals(world.calls, []);
  });
});

Deno.test("documents/file-tracking#R13: gitignoreChain은 경로의 상위 디렉터리마다 .gitignore를 모은다", async () => {
  const asked: string[] = [];
  const rules = await gitignoreChain(
    {
      gitignore: (_root, directory) => {
        asked.push(directory);
        return Promise.resolve(ok(directory === "a" ? "secret.md\n" : null));
      },
    },
    "/work",
    "a/b/plan.md",
  );
  assert(rules.ok);
  assertEquals(asked, ["", "a", "a/b"]);
  assertEquals(rules.value, [{ directory: "a", text: "secret.md\n" }]);
  const top = await gitignoreChain(
    {
      gitignore: () => Promise.resolve(ok(null)),
    },
    "/work",
    "plan.md",
  );
  assert(top.ok);
  assertEquals(top.value, []);
});
