// 두기·빼기를 실제 command handler(project.set_tracking, document.move, document.set_source)와
// 실제 파일 시스템 위에서 돌린다. 순서 규칙은 placement_test.ts가 fake로 본다. 여기서는 각
// 단계가 실제 CAS·미리보기 일치·이름 예약·권한 판정을 통과하는지만 본다.
import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { ok, type Result } from "../../base/mod.ts";
import type {
  PreparedVersion,
  TrackingPreview,
} from "../../contracts/documents/mod.ts";
import { suggestName } from "../addressing/mod.ts";
import { createDocumentChangeCommands } from "../addressing/mod.ts";
import {
  createProjectCommands,
  loadProject,
  projectsSchemaSteps,
} from "../projects/mod.ts";
import {
  createSourceCommands,
  createVersionCommands,
  loadDocument,
  loadFiles,
  loadLatestVersion,
} from "../versions/mod.ts";
import {
  file,
  ids,
  keep,
  preparedInput,
  userContext,
  versionFixture,
} from "../versions/testing/mod.ts";
import { denoFileOps } from "./adapters/file-ops.ts";
import { createFileSerializer } from "./file-ops.ts";
import {
  placeDocumentFile,
  type PlacementCommands,
  type PlacementDeps,
  removeDocumentFile,
} from "./placement.ts";

const TEXT = "# Plan\n\nsaved before it became a file\n";
const encoder = new TextEncoder();
const hash = createHash("sha256").update(TEXT).digest("hex");

function setup(root: string) {
  const fixture = versionFixture();
  for (const step of projectsSchemaSteps) fixture.db.exec(step.sql);
  fixture.db.exec(
    `INSERT INTO projects (id, name, title, purpose, tracking_enabled, use_gitignore, revision, status)
     VALUES ('${ids.project}', 'notes', 'Notes', '', 1, 0, '1', 'active')`,
  );
  fixture.db.exec(
    `INSERT INTO project_folders (project, position, path, description)
     VALUES ('${ids.project}', 0, '${root}', '')`,
  );
  fixture.db.exec(
    `INSERT INTO project_tracking_patterns (project, position, effect, glob)
     VALUES ('${ids.project}', 0, 'include', '**/*.md')`,
  );
  // 저장된 원문의 hash는 실제 바이트의 hash다.
  const original = file(
    "plan.md",
    true,
    encoder.encode(TEXT).length,
    "text/markdown",
  );
  original.blob_hash = hash;
  original.content.blob.hash = hash;
  const saved = fixture.transaction((tx) =>
    createVersionCommands().save.handle(
      tx,
      userContext(),
      preparedInput(ids.doc, [original]) as unknown as PreparedVersion,
      { base_version: null },
    )
  );
  keep(saved);
  return fixture;
}

function depsOf(
  fixture: ReturnType<typeof versionFixture>,
): PlacementDeps {
  const user = userContext();
  const source = createSourceCommands().setSource;
  const move = createDocumentChangeCommands().move;
  const tracking = createProjectCommands().setTracking;
  const call = <T>(
    run: (
      tx: Parameters<typeof fixture.transaction>[0] extends (
        tx: infer Tx,
      ) => unknown ? Tx
        : never,
    ) => Result<T>,
  ) => Promise.resolve(fixture.transaction(run));
  const commands: PlacementCommands = {
    setTracking: (input, compare) =>
      call((tx) =>
        tracking.handle(tx, user, input as never, compare)
      ) as Promise<never>,
    move: (input, compare) =>
      call((tx) => move.handle(tx, user, input, compare)) as Promise<never>,
    setSource: (input, compare) =>
      call((tx) => source.handle(tx, user, input, compare)) as Promise<never>,
    recordFile: () => Promise.resolve(ok(undefined)),
  };
  let counter = 0;
  return {
    files: {
      ops: denoFileOps(),
      serializer: createFileSerializer(),
      clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
      token: () => `l${++counter}`,
    },
    commands,
    ledger: {
      document: (id) => Promise.resolve(loadDocument(fixture.sql, id)),
      project: (id) => Promise.resolve(loadProject(fixture.sql, id)),
      latest: (document) => {
        const version = loadLatestVersion(fixture.sql, document);
        if (!version.ok) return Promise.resolve(version);
        if (version.value === null) return Promise.resolve(ok(null));
        const files = loadFiles(fixture.sql, version.value.id);
        return Promise.resolve(
          files.ok
            ? ok({ version: version.value.id, files: files.value })
            : files,
        );
      },
      linked: (path) =>
        Promise.resolve(ok(
          (fixture.sql.get("SELECT id FROM documents WHERE source_path = ?", [
            path,
          ])?.["id"] as string | undefined) ?? null,
        )),
      async *content() {
        yield encoder.encode(TEXT);
      },
      placeName: (_place, document) =>
        Promise.resolve(ok(suggestName(document.title))),
      gitignore: () => Promise.resolve(ok([])),
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
    },
  };
}

async function withRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-placement-ledger-" }),
  );
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("documents/file-tracking#R13: 실제 command로 두면 파일·추적 규칙·자리·원본 연결이 각각 확정된다", async () => {
  await withRoot(async (root) => {
    const fixture = setup(root);
    try {
      const placed = await placeDocumentFile(depsOf(fixture), {
        actor: "user",
        requestKey: "req-1",
        document: ids.doc,
        project: ids.project,
        path: `${root}/plan.txt`,
      });
      assert(placed.ok);
      assertEquals(placed.value.tracking, { state: "done" });
      assertEquals(placed.value.move, { state: "done" });
      assertEquals(placed.value.source, { state: "done" });
      assertEquals(await Deno.readTextFile(`${root}/plan.txt`), TEXT);
      const document = loadDocument(fixture.sql, ids.doc);
      assert(document.ok && document.value !== null);
      assertEquals(document.value.file_source, {
        kind: "project_file",
        project: ids.project,
        path: `${root}/plan.txt`,
      });
      assertEquals(document.value.place, { kind: "project", id: ids.project });
      const project = loadProject(fixture.sql, ids.project);
      assert(project.ok && project.value !== null);
      assertEquals(project.value.tracking.patterns.at(-1), {
        effect: "include",
        glob: "plan.txt",
      });
      assertEquals(
        fixture.emitted.map((event) => event.type).slice(-3),
        ["ProjectTrackingChanged", "DocumentMoved", "DocumentSourceChanged"],
      );
      // 판은 늘지 않는다: 두기는 파일을 쓸 뿐 내용을 새로 저장하지 않는다.
      assertEquals(
        fixture.sql.all("SELECT id FROM versions WHERE document = ?", [
          ids.doc,
        ]).length,
        1,
      );
    } finally {
      fixture.close();
    }
  });
});

Deno.test("documents/file-tracking#R14: 실제 command로 빼면 같은 내용의 파일만 지우고 연결을 푼다", async () => {
  await withRoot(async (root) => {
    const fixture = setup(root);
    try {
      const deps = depsOf(fixture);
      const placed = await placeDocumentFile(deps, {
        actor: "user",
        requestKey: "req-1",
        document: ids.doc,
        project: ids.project,
        path: `${root}/plan.md`,
      });
      assert(placed.ok);
      // 사람이 고친 파일은 conflict로 남는다.
      await Deno.writeTextFile(`${root}/plan.md`, `${TEXT}human edit\n`);
      const refused = await removeDocumentFile(deps, {
        actor: "user",
        requestKey: "req-2",
        document: ids.doc,
        baseHash: hash,
      });
      assert(!refused.ok);
      assertEquals(refused.error.code, "conflict");
      assertEquals(
        await Deno.readTextFile(`${root}/plan.md`),
        `${TEXT}human edit\n`,
      );
      const stillLinked = loadDocument(fixture.sql, ids.doc);
      assert(stillLinked.ok && stillLinked.value !== null);
      assert(stillLinked.value.file_source !== null);
      // 바뀌지 않은 파일은 지우고 연결을 푼다.
      await Deno.writeTextFile(`${root}/plan.md`, TEXT);
      const removed = await removeDocumentFile(deps, {
        actor: "user",
        requestKey: "req-3",
        document: ids.doc,
        baseHash: hash,
      });
      assert(removed.ok);
      assertEquals(removed.value.file?.outcome, "deleted");
      assertEquals(removed.value.source, { state: "done" });
      const after = loadDocument(fixture.sql, ids.doc);
      assert(after.ok && after.value !== null);
      assertEquals(after.value.file_source, null);
      const names: string[] = [];
      for await (const entry of Deno.readDir(root)) names.push(entry.name);
      assertEquals(names, []);
      // 자리 되돌리기는 별도 단계고, 옛 이름 예약은 남긴다.
      assertEquals(removed.value.move, { state: "done" });
      assertEquals(after.value.place, null);
      assertEquals(after.value.name, null);
    } finally {
      fixture.close();
    }
  });
});
