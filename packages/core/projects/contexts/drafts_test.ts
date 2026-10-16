import { assert, assertEquals } from "@std/assert";
import type {
  BundleContent,
  BundleSummary,
  ContextValue,
} from "../../../protocol/projects/mod.ts";
import { createContextApiCommands } from "./api/commands.ts";
import { createContextApiReads } from "./api/reads.ts";
import type {
  BundleRow,
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./api/state.ts";
import { createContextDrafts, createContextFolders } from "./folders.ts";
import { createContextFiles } from "./ledger/files.ts";

const id = (prefix: string, n: number) => `${prefix}_${"0".repeat(25)}${n}`;
const PROJECT = id("prj", 1);
const CTX = id("ctx", 1);
const APPLIED = id("cbn", 1);
const HASH = "a".repeat(64);
const manager: ContextApiActor = {
  kind: "agent",
  actor: `agent:${id("ses", 1)}`,
};

const appliedContent: BundleContent = {
  schema: 1,
  contract: {
    types: [{
      name: "Note",
      summary: "A note",
      visibility: "private",
      source: { kind: "docs", paths: ["notes/*.md"] },
      key: "path",
      fields: [{
        name: "path",
        from: { kind: "path", capture: "path" },
        value_type: "string",
        required: true,
        visibility: "private",
      }],
      relations: [],
      rules: [],
    }],
  },
  searches: [],
  saved_views: [],
  examples: [],
};

// 임시 폴더에 실제 파일로 초안 폴더를 돌린다. adapter처럼 command 뒤에 flush한다.
function setup() {
  const root = Deno.makeTempDirSync();
  const drafts = createContextDrafts(
    createContextFolders(root),
    createContextFiles(),
  );
  const context: ContextValue = {
    id: CTX,
    project: PROJECT,
    title: "Notes",
    purpose: "Keep notes",
    status: "active",
    applied_bundle: APPLIED,
    violation_mark: 0,
    revision: "1",
  };
  const applied: BundleRow = {
    id: APPLIED,
    context: CTX,
    number: 1,
    parent: null,
    bundle_hash: HASH,
    status: "applied",
    check: id("chk", 1),
    created_by: "user",
    revision: "1",
    content: appliedContent as unknown as Record<string, unknown>,
  };
  const state: ContextApiState = {
    seq: 1,
    projects: new Map([[PROJECT, { id: PROJECT, archived: false }]]),
    contexts: new Map([[CTX, context]]),
    bundles: new Map([[APPLIED, applied]]),
    checks: new Map(),
    views: new Map(),
    glossary: new Map(),
    events: [],
    replays: new Map(),
    violations: new Map(),
    entities: new Map(),
    indexFailing: new Set(),
    appReaders: new Map(),
  };
  let next = 100;
  const deps: ContextApiDeps = {
    now: () => "2026-10-16T00:00:00.000Z",
    newId: (prefix) => id(prefix, ++next % 10),
    hash: () => HASH,
    putBlob: () => ({ hash: HASH, size_bytes: 1 }),
    canWrite: () => true,
    drafts,
    recordedViolations: () => [],
    keepViolations: () => undefined,
  };
  const commands = createContextApiCommands(state, deps);
  const reads = createContextApiReads(state, {
    execute: () => [],
    now: deps.now,
    canWrite: deps.canWrite,
    drafts,
  });
  const fileOf = (bundle: string) =>
    `${drafts.folder(PROJECT, CTX, bundle)}/bundle.json`;
  const exists = (path: string) => {
    try {
      Deno.statSync(path);
      return true;
    } catch {
      return false;
    }
  };
  const cleanup = () => Deno.removeSync(root, { recursive: true });
  return { state, commands, reads, drafts, fileOf, exists, cleanup };
}

function openDraft(t: ReturnType<typeof setup>): BundleSummary["id"] {
  const opened = t.commands.bundleOpenDraft({
    actor: manager,
    key: crypto.randomUUID(),
    input: { context: CTX },
    compare: {},
  });
  assert(opened.ok);
  t.drafts.flush();
  return opened.value.bundle;
}

function run(body: (t: ReturnType<typeof setup>) => void) {
  const t = setup();
  try {
    body(t);
  } finally {
    t.cleanup();
  }
}

Deno.test("잘못된 bundle.json은 test가 실패 보고를 주고 판이 되지 못한다", () =>
  run((t) => {
    const draft = openDraft(t);
    // 새 초안은 적용된 판의 내용으로 시작한다.
    assertEquals(
      JSON.parse(Deno.readTextFileSync(t.fileOf(draft))),
      appliedContent,
    );

    // types가 비어 BundleContent가 아니다.
    Deno.writeTextFileSync(
      t.fileOf(draft),
      JSON.stringify({ schema: 1, contract: { types: [] } }),
    );
    const tested = t.reads.bundleTestDraft({
      actor: manager,
      input: { bundle: draft },
    });
    assert(tested.ok);
    assertEquals(tested.value.report.status, "failed");
    assert(tested.value.report.findings.length >= 1);

    const events = t.state.events.length;
    const submitted = t.commands.bundleSubmit({
      actor: manager,
      key: "submit",
      input: { bundle: draft },
      compare: {},
    });
    assert(!submitted.ok);
    assertEquals(submitted.error.code, "invalid_input");
    assertEquals(t.state.events.length, events);
    assertEquals(t.state.bundles.get(draft)!.status, "draft");
    assertEquals(t.state.checks.size, 0);
    assert(t.exists(t.fileOf(draft)));
  }));

Deno.test("초안이 열려 있는 동안에도 적용된 판을 쓰고 제출하거나 버리면 폴더가 사라진다", () =>
  run((t) => {
    const contract = () => {
      const read = t.reads.contextContract({
        actor: manager,
        input: { context: CTX },
      });
      assert(read.ok);
      return read.value;
    };

    // 버린다.
    const first = openDraft(t);
    assertEquals(contract().bundle, APPLIED);
    assert(t.exists(t.fileOf(first)));
    const discarded = t.commands.bundleDiscardDraft({
      actor: manager,
      key: "discard",
      input: { bundle: first },
      compare: { base_revision: t.state.bundles.get(first)!.revision },
    });
    assert(discarded.ok);
    t.drafts.flush();
    assert(!t.exists(t.drafts.folder(PROJECT, CTX, first)));

    // 제출한다.
    const second = openDraft(t);
    Deno.writeTextFileSync(t.fileOf(second), JSON.stringify(appliedContent));
    const submitted = t.commands.bundleSubmit({
      actor: manager,
      key: "submit",
      input: { bundle: second },
      compare: {},
    });
    assert(submitted.ok);
    assertEquals(submitted.value.status, "checking");
    t.drafts.flush();
    assert(!t.exists(t.drafts.folder(PROJECT, CTX, second)));
    // 검사가 끝나기 전에도 적용된 판은 그대로다.
    assertEquals(contract().bundle, APPLIED);
  }));
