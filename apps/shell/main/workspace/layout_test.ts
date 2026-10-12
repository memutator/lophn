// layout 저장·검증 테스트. shell/workspace#R6, R7, R8과 shell/desktop#R24다.
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  emptyLayout,
  parseLayoutFile,
  SCHEMA_VERSION,
  toLayoutFile,
  validateLayout,
} from "./layout.ts";
import {
  createLayoutStore,
  DIR_MODE,
  FILE_MODE,
  layoutPath,
} from "./layout-store.ts";

const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";

function sampleLayout() {
  return validateLayout({
    schema_version: SCHEMA_VERSION,
    project: PRJ,
    window_bounds: { x: 40, y: 40, width: 1280, height: 800 },
    last_space: "project",
    panes: [
      {
        tabs: [
          {
            kind: "document_editor",
            key: "t1",
            document: DOC,
            read_position: { section: "intro", scroll_offset: 120 },
          },
          { kind: "terminal", key: "t2", project_folder: "/repo/apps/api" },
        ],
        selected_tab: "t1",
      },
      {
        tabs: [{ kind: "document_editor", key: "t3", document: DOC }],
        selected_tab: "t3",
      },
    ],
    split_ratio: 0.6,
    focused_pane: 1,
    information_panel: { open: true, tab: "versions" },
  });
}

test("shell/workspace#R8: layout은 대상 참조·배치·읽던 위치만 담고 본문·credential·승인·출력·preview는 schema에 없다", () => {
  const result = sampleLayout();
  assert.ok(result.ok);
  if (!result.ok) return;
  const text = JSON.stringify(toLayoutFile(result.layout));
  for (
    const forbidden of [
      "content",
      "draft",
      "output",
      "credential",
      "token",
      "approval",
      "decision",
      "preview",
      "body",
    ]
  ) {
    assert.equal(
      text.includes(forbidden),
      false,
      `layout에 ${forbidden}이 들어 있으면 안 된다`,
    );
  }
  const value = result.layout;
  assert.deepEqual(Object.keys(value), [
    "schema_version",
    "project",
    "window_bounds",
    "last_space",
    "panes",
    "split_ratio",
    "focused_pane",
    "information_panel",
  ]);
});

test("shell/workspace#R8: 모르는 필드와 쓰기 kind 밖 참조는 거절한다", () => {
  assert.equal(validateLayout({ ...{} }).ok, false);
  const base = sampleLayout();
  assert.ok(base.ok);
  if (!base.ok) return;
  assert.equal(
    workspaceWith(base.layout, { extra: true }).ok,
    false,
    "strict가 아니면 모르는 필드가 통과한다",
  );
  const badTab = structuredClone(base.layout);
  (badTab.panes[0]!.tabs[0] as Record<string, unknown>).output =
    "terminal text";
  assert.equal(validateLayout(badTab).ok, false);
});

function workspaceWith(
  layout: Record<string, unknown>,
  patch: Record<string, unknown>,
): ReturnType<typeof validateLayout> {
  return validateLayout({ ...layout, ...patch });
}

test("shell/workspace#R7: 미지원 schema와 손상 파일은 안전한 오류다", () => {
  assert.equal(
    parseReason({ schema_version: 2, layout: {} }),
    "unsupported_schema",
  );
  assert.equal(
    parseReason({ schema_version: 1, layout: { broken: true } }),
    "corrupt",
  );
  assert.equal(parseReason("not json layout"), "corrupt");
});

function parseReason(value: unknown): string {
  const result = parseLayoutFile(value);
  return result.ok ? "ok" : result.reason ?? "corrupt";
}

test("shell/workspace#R6: layout.json은 창이 닫혀도 남아 복원에 쓰인다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-layout-test-"));
  try {
    const store = createLayoutStore(root);
    const first = await store.read();
    assert.ok(first.ok && first.value === null, "처음에는 파일이 없다");
    const sample = sampleLayout();
    assert.ok(sample.ok);
    if (!sample.ok) return;
    const write = await store.write(
      JSON.stringify(toLayoutFile(sample.layout)),
    );
    assert.ok(write.ok, `쓰기 실패: ${JSON.stringify(write)}`);
    const read = await store.read();
    assert.ok(read.ok && read.value?.ok);
    if (!read.ok || !read.value?.ok) return;
    assert.equal(read.value.layout.project, PRJ);
    assert.equal(read.value.layout.split_ratio, 0.6);
    assert.equal(read.value.layout.focused_pane, 1);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("shell/workspace#R6: layout.json은 원자 교체로 쓰고 폴더 0700 파일 0600이다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-layout-mode-"));
  try {
    const store = createLayoutStore(root);
    const sample = sampleLayout();
    assert.ok(sample.ok);
    if (!sample.ok) return;
    const first = await store.write(
      JSON.stringify(toLayoutFile(sample.layout)),
    );
    assert.ok(first.ok);
    const dirStat = await stat(join(root, "shell"));
    assert.equal(dirStat.mode & 0o777, DIR_MODE, "폴더는 0700이다");
    const fileStat = await stat(layoutPath(root));
    assert.equal(fileStat.mode & 0o777, FILE_MODE, "파일은 0600이다");
    // temp 파일이 남지 않는다.
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(root, "shell"));
    assert.deepEqual(files, ["layout.json"]);
    // 다시 쓰면 원자 교체가 되고 이전 내용이 남지 않는다.
    const second = structuredClone(sample.layout);
    second.split_ratio = 0.4;
    const again = await store.write(JSON.stringify(toLayoutFile(second)));
    assert.ok(again.ok);
    const raw = JSON.parse(await readFile(layoutPath(root), "utf8"));
    assert.equal(raw.layout.split_ratio, 0.4);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("shell/workspace#R6: 쓰기 실패 때 기존 파일을 그대로 둔다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-layout-fail-"));
  try {
    const sample = sampleLayout();
    assert.ok(sample.ok);
    if (!sample.ok) return;
    const file = layoutPath(root);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(toLayoutFile(sample.layout)));
    const store = createLayoutStore(root, {
      rename: () =>
        Promise.reject(Object.assign(new Error("no"), { code: "EACCES" })),
    });
    const result = await store.write("{}");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "unwritable");
    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.layout.project, PRJ, "기존 파일이 남는다");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("shell/workspace#R7: 빈 layout은 안전한 기본값을 가진다", () => {
  const empty = emptyLayout(PRJ);
  assert.ok(validateLayout(empty).ok);
  assert.equal(empty.split_ratio, 0.5);
  assert.deepEqual(empty.panes, [{ tabs: [], selected_tab: null }]);
  assert.deepEqual(empty.information_panel, { open: false, tab: "info" });
});

test("shell/workspace#R14 [ctx-I37]: 옛 document_viewer 탭은 자리표시 없이 건너뛰고 나머지 탭의 순서와 선택을 지킨다", () => {
  const raw = (selected: string) => ({
    schema_version: SCHEMA_VERSION,
    layout: {
      schema_version: SCHEMA_VERSION,
      project: PRJ,
      window_bounds: { x: 0, y: 0, width: 1280, height: 800 },
      last_space: "project",
      panes: [{
        tabs: [
          { kind: "document_editor", key: "a", document: DOC },
          {
            kind: "document_viewer",
            key: "old",
            document: DOC,
            version: "ver_01h455vb4pex5v6nkc6gd5fdw1",
          },
          { kind: "terminal", key: "b", project_folder: "work" },
        ],
        selected_tab: selected,
      }],
      split_ratio: 0.5,
      focused_pane: 0,
      information_panel: { open: false, tab: "info" },
    },
  });
  const kept = parseLayoutFile(raw("b"));
  assert.ok(kept.ok);
  if (!kept.ok) return;
  assert.deepEqual(
    kept.layout.panes[0]!.tabs.map((tab) => tab.key),
    ["a", "b"],
  );
  assert.equal(kept.layout.panes[0]!.selected_tab, "b");
  // 선택이 건너뛴 탭이었으면 첫 남은 탭으로 옮긴다.
  const moved = parseLayoutFile(raw("old"));
  assert.ok(moved.ok);
  if (!moved.ok) return;
  assert.equal(moved.layout.panes[0]!.selected_tab, "a");
  // 저장 전 검증(validateLayout)은 모르는 kind를 받지 않는다.
  assert.equal(validateLayout(raw("b").layout).ok, false);
});
