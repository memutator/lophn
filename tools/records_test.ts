import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkPlatformNotes } from "./check-sdk-notes.ts";
import {
  CAPABILITY_SURFACE_MODULES,
  type PlatformNoteContext,
  validateChangePlatformNote,
} from "./records.ts";

test("cutoff 이후 역량 표면 modules 항목은 platform_note가 없으면 실패하고 내부 module은 통과한다", () => {
  for (const prefix of CAPABILITY_SURFACE_MODULES) {
    assert.equal(
      validateChangePlatformNote({
        id: "new-feature",
        version: "0.23.156",
        modules: [prefix],
      }).length,
      1,
    );
  }

  // 하위 module path와 semver 자릿수 증가(0.23.1000 > 0.23.155), 0.23.155의 다른 id도 잡는다.
  assert.equal(
    validateChangePlatformNote({
      id: "sync-change",
      version: "0.23.1000",
      modules: ["packages/protocol/apps/sync"],
    }).length,
    1,
  );
  assert.equal(
    validateChangePlatformNote({
      id: "other-at-cutoff",
      version: "0.23.155",
      modules: ["packages/sdk"],
    }).length,
    1,
  );

  // 역량 표면 밖 module과 prefix 경계가 다른 path는 통과한다.
  assert.deepStrictEqual(
    validateChangePlatformNote({
      id: "internal-fix",
      version: "0.23.156",
      modules: ["packages/core/main", "packages/shell", "packages/sdk-extra"],
    }),
    [],
  );
});

test("0.23.155 workflow-p4-host-sdk와 그 이전 판은 platform_note 없이 통과한다", () => {
  assert.deepStrictEqual(
    validateChangePlatformNote({
      id: "workflow-p4-host-sdk",
      version: "0.23.155",
      modules: ["packages/protocol", "packages/sdk"],
    }),
    [],
  );
  assert.deepStrictEqual(
    validateChangePlatformNote({
      id: "legacy-change",
      version: "0.23.154",
      modules: ["packages/cli"],
    }),
    [],
  );
  assert.deepStrictEqual(
    validateChangePlatformNote({
      id: "older-minor",
      version: "0.22.999",
      modules: ["packages/core/workflows"],
    }),
    [],
  );
});

test("platform_note는 none 또는 kebab-case slug만 받고 manifest가 있으면 등록·파일 존재를 본다", () => {
  for (const bad of [
    "",
    "BadSlug",
    "bad_slug",
    "a--b",
    "-a",
    "a-",
    123,
    null,
  ]) {
    assert.equal(
      validateChangePlatformNote({
        id: "new-feature",
        version: "0.23.156",
        modules: ["packages/sdk"],
        platform_note: bad,
      }).length,
      1,
      `expected failure for ${String(bad)}`,
    );
  }

  assert.deepStrictEqual(
    validateChangePlatformNote({
      id: "new-feature",
      version: "0.23.156",
      modules: ["packages/sdk"],
      platform_note: "none",
    }),
    [],
  );
  assert.deepStrictEqual(
    validateChangePlatformNote(
      {
        id: "new-feature",
        version: "0.23.156",
        modules: ["packages/sdk"],
        platform_note: "durable-workflows-and-flow-2",
      },
      { noteIds: null, hasNoteFile: () => false },
    ),
    [],
  );

  const ctx: PlatformNoteContext = {
    noteIds: new Set(["durable-workflows-and-flow-2"]),
    hasNoteFile: (slug) => slug === "durable-workflows-and-flow-2",
  };
  assert.deepStrictEqual(
    validateChangePlatformNote(
      {
        id: "new-feature",
        version: "0.23.156",
        modules: ["packages/sdk"],
        platform_note: "durable-workflows-and-flow-2",
      },
      ctx,
    ),
    [],
  );
  assert.equal(
    validateChangePlatformNote(
      {
        id: "new-feature",
        version: "0.23.156",
        modules: ["packages/sdk"],
        platform_note: "unlisted-note",
      },
      ctx,
    ).length,
    2,
  );
});

test("checkPlatformNotes는 manifest가 없으면 통과하고 있으면 id·header·고아 파일을 검사한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-platform-notes-"));
  const updateDir = `${root}/packages/core/agent-workspaces/skills/update`;
  const notesDir = `${updateDir}/notes`;
  try {
    // manifest가 아직 없으면 건너뛴다.
    assert.deepStrictEqual(await checkPlatformNotes(root), []);

    await mkdir(notesDir, { recursive: true });
    await writeFile(
      `${updateDir}/platform-notes.json`,
      JSON.stringify(["flow-2", "phone-files"]),
    );
    await writeFile(
      `${notesDir}/flow-2.md`,
      "# Flow 2\n\nBreaking: yes. Must migrate.\nAreas: workflow, project\n",
    );
    await writeFile(
      `${notesDir}/phone-files.md`,
      "# Phone files\n\nBreaking: no\nAreas: app, home\n",
    );
    assert.deepStrictEqual(await checkPlatformNotes(root), []);

    // 중복·잘못된 id, 빠진 파일, 잘못된 Breaking/Areas, 고아 파일을 잡는다.
    await writeFile(
      `${updateDir}/platform-notes.json`,
      JSON.stringify(["flow-2", "flow-2", "Bad_Id", "missing-note"]),
    );
    await writeFile(
      `${notesDir}/flow-2.md`,
      "# Flow 2\n\nBreaking: maybe\nAreas: unknown-area\n",
    );
    const issues = await checkPlatformNotes(root);
    assert.ok(issues.some((i) => i.message.includes("중복된 note id")));
    assert.ok(issues.some((i) => i.message.includes("kebab-case")));
    assert.ok(issues.some((i) => i.message.includes("메모 파일이 없다")));
    assert.ok(issues.some((i) => i.message.includes("Breaking:")));
    assert.ok(issues.some((i) => i.message.includes("Areas는")));
    assert.ok(
      issues.some(
        (i) =>
          i.where.endsWith("phone-files.md") && i.message.includes("고아 메모"),
      ),
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
