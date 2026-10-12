// context API 시험용 가짜 상태 builder다. 메모리 상태 위에서 command와 읽기를 시험한다.
// 구현이 ledger 표에 옮겨도 시험이 보는 값(결과, event, 순서)은 같아야 한다.
import { createHash } from "node:crypto";
import { canonicalize, type Result } from "../../../base/mod.ts";
import type {
  BundleSummary,
  CheckReport,
  ContextValue,
  GlossaryEntry,
  SavedViewValue,
  StoredViolation,
} from "../../../contracts/documents/mod.ts";
import type {
  BlobReference,
  BundleRow,
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
  EntityRow,
} from "./state.ts";

// ---------- ID ----------

// 소문자 Crockford base32에 없는 글자를 피한 8진수 꼬리로 ID를 만든다.
export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g${n.toString(8).padStart(4, "0")}`;
}

export const ids = {
  project: id("prj", 1),
  otherProject: id("prj", 2),
  context: id("ctx", 1),
  otherContext: id("ctx", 2),
  missingContext: id("ctx", 99),
  bundle: id("cbn", 1),
  spareBundle: id("cbn", 50),
  spareBundle2: id("cbn", 51),
  missingBundle: id("cbn", 99),
  check: id("chk", 1),
  missingCheck: id("chk", 99),
  view: id("viw", 1),
  missingView: id("viw", 99),
  entry: id("trm", 1),
  missingEntry: id("trm", 99),
  run: id("run", 1),
};

// ---------- actor ----------

export const actors = {
  user: { kind: "user", actor: "user" } as ContextApiActor,
  engineer: {
    kind: "agent",
    actor: `agent:${id("asg", 1)}`,
    role: "context_engineer",
  } as ContextApiActor,
  otherAgent: {
    kind: "agent",
    actor: `agent:${id("asg", 2)}`,
    role: "other",
  } as ContextApiActor,
  worker: {
    kind: "machine",
    actor: "machine",
    scope: "context_worker",
  } as ContextApiActor,
  // agent runtime의 machine 자격: run 시작 전 재료로 context.list·get·contract만 읽는다.
  runtime: {
    kind: "machine",
    actor: "machine",
    scope: "agent_runtime",
  } as ContextApiActor,
  otherMachine: {
    kind: "machine",
    actor: "machine",
    scope: "other",
  } as ContextApiActor,
  codingAgent: {
    kind: "coding_agent",
    actor: `coding_agent:${id("cac", 1)}`,
  } as ContextApiActor,
};

// ---------- 결과 확인 ----------

export function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected ok, got ${result.error.code}: ${result.error.message}`,
    );
  }
  return result.value;
}

export function errorCode(result: Result<unknown>): string {
  return result.ok ? "ok" : result.error.code;
}

// ---------- 상태 ----------

export function newState(): ContextApiState {
  return {
    seq: 100,
    projects: new Map([
      [ids.project, { id: ids.project, archived: false }],
      [ids.otherProject, { id: ids.otherProject, archived: false }],
    ]),
    contexts: new Map(),
    bundles: new Map(),
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
}

// event 없이 상태를 심을 때 쓰는 revision이다.
export function bump(state: ContextApiState): string {
  state.seq += 1;
  return String(state.seq);
}

export const T0 = "2026-10-12T00:00:00.000Z";

export function testDeps() {
  let n = { cbn: 0, chk: 0, viw: 0, run: 0 };
  let clock = 0;
  const blobs = new Map<string, unknown>();
  const runs: {
    context: string;
    evidence: BlobReference;
    violations: readonly StoredViolation[];
    run: string;
  }[] = [];
  const hash = (value: unknown) =>
    createHash("sha256").update(canonicalize(value)).digest("hex");
  const deps: ContextApiDeps = {
    now() {
      clock += 1;
      return new Date(Date.parse(T0) + clock * 1000).toISOString();
    },
    // 시험이 심는 ID(1~)와 겹치지 않게 100번부터 센다.
    newId(prefix) {
      n = { ...n, [prefix]: n[prefix] + 1 };
      return id(prefix, 100 + n[prefix]);
    },
    hash,
    putBlob(value) {
      const reference = {
        hash: hash(value),
        size_bytes: new TextEncoder().encode(canonicalize(value)).length,
      };
      blobs.set(reference.hash, value);
      return reference;
    },
    startHandOffRun(request) {
      const run = id("run", 100 + runs.length + 1);
      runs.push({ ...request, run });
      return run;
    },
  };
  return { deps, blobs, runs, hash };
}
export type TestDeps = ReturnType<typeof testDeps>;

// ---------- BundleContent 자료 ----------

const field = (name: string, from: unknown, extra: object = {}) => ({
  name,
  from,
  value_type: "string",
  ...extra,
});

// 유효한 가장 작은 묶음: type 하나, 검색 하나, 그 검색을 부르는 saved view 정의 하나.
// 검색 `experiments_by_status`는 value 입력 `status`(여럿, 선택)를 받고 board 결과다.
export function minimalContent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: 1,
    contract: {
      types: [{
        name: "Experiment",
        summary: "One run comparing arms on scenarios",
        visibility: "public",
        source: {
          kind: "series",
          pattern: "eval/experiments/exp-{n:03}-*.md",
          order: "natural",
        },
        key: "id",
        fields: [
          field("id", { kind: "path", capture: "n" }),
          field("status", { kind: "frontmatter", key: "status" }, {
            value_type: "enum",
            values: ["planned", "running", "done"],
          }),
        ],
        relations: [],
        rules: [{
          id: "status-required",
          kind: "required_field",
          params: { field: "status" },
          message: "Every experiment says its status",
        }],
      }],
    },
    searches: [{
      name: "experiments_by_status",
      title: "Experiments by status",
      inputs: [{
        name: "status",
        label: "Status",
        type: "value",
        of: "Experiment.status",
        many: true,
        required: false,
      }],
      query: {
        from: "Experiment",
        where: { path: "status", op: "in", value: { input: "status" } },
        follow: [],
        sort: [],
        group: null,
      },
      result: { kind: "board", columns: [], board_by: "status", page_size: 30 },
    }, {
      name: "experiment_by_key",
      title: "One experiment",
      inputs: [{
        name: "experiment",
        label: "Experiment",
        type: "entity",
        of: "Experiment",
        many: false,
        required: true,
      }, {
        name: "note",
        label: "Note",
        type: "text",
        many: false,
        required: false,
      }],
      query: {
        from: "Experiment",
        where: { path: "key", op: "eq", value: { input: "experiment" } },
        follow: [],
        sort: [],
        group: null,
      },
      result: {
        kind: "table",
        columns: [{ label: "Status", path: "status" }],
        page_size: 2,
      },
    }],
    saved_views: [{
      name: "Running experiments",
      search: "experiments_by_status",
      inputs: { status: ["running"] },
    }],
    examples: [],
    ...overrides,
  };
}

// 후보를 시험하는 묶음: minimalContent의 type에 title·round·tags field를 더하고, 입력을 종류별로 가진
// 검색 `experiment_picker`를 둔다(value: status·title·round·tag, entity: experiment, range·text).
export function optionsContent(): Record<string, unknown> {
  const base = minimalContent();
  const [type] = (base.contract as { types: Record<string, unknown>[] }).types;
  const input = (name: string, type: string, of?: string, many = false) => ({
    name,
    label: name,
    type,
    ...(of === undefined ? {} : { of }),
    many,
    required: false,
  });
  return minimalContent({
    contract: {
      types: [{
        ...type,
        fields: [
          ...(type!.fields as unknown[]),
          field("title", { kind: "frontmatter", key: "title" }),
          field("round", { kind: "frontmatter", key: "round" }, {
            value_type: "number",
          }),
          field("tags", { kind: "frontmatter", key: "tags" }, {
            value_type: "list",
            item_type: "string",
          }),
        ],
      }],
    },
    searches: [{
      name: "experiment_picker",
      title: "Picker",
      inputs: [
        input("status", "value", "Experiment.status", true),
        input("title", "value", "Experiment.title"),
        input("round", "value", "Experiment.round"),
        input("tag", "value", "Experiment.tags", true),
        input("experiment", "entity", "Experiment"),
        input("window", "range", "Experiment.round"),
        input("note", "text"),
      ],
      query: {
        from: "Experiment",
        where: null,
        follow: [],
        sort: [],
        group: null,
      },
      result: {
        kind: "table",
        columns: [{ label: "Status", path: "status" }],
        page_size: 30,
      },
    }],
    saved_views: [],
  });
}

export function evalContent(): Record<string, unknown> {
  return JSON.parse(
    Deno.readTextFileSync(
      new URL("../testdata/eval-project.contract.json", import.meta.url),
    ),
  );
}

// ---------- 심기 ----------

export function seedContext(
  state: ContextApiState,
  overrides: Partial<ContextValue> = {},
): ContextValue {
  const context: ContextValue = {
    id: ids.context,
    project: ids.project,
    title: "Experiments",
    purpose: "Track experiments and findings",
    status: "drafting",
    applied_bundle: null,
    violation_mark: 0,
    revision: bump(state),
    ...overrides,
  };
  state.contexts.set(context.id, context);
  return context;
}

export function seedBundle(
  state: ContextApiState,
  overrides: Partial<BundleRow> = {},
): BundleRow {
  const bundle: BundleRow = {
    id: ids.bundle,
    context: ids.context,
    number: null,
    parent: null,
    bundle_hash: null,
    status: "draft",
    check: null,
    created_by: actors.engineer.actor,
    revision: bump(state),
    content: minimalContent(),
    ...overrides,
  } as BundleRow;
  state.bundles.set(bundle.id, bundle);
  return bundle;
}

export function seedCheck(
  state: ContextApiState,
  overrides: Partial<CheckReport> = {},
): CheckReport {
  const check: CheckReport = {
    id: ids.check,
    context: ids.context,
    bundle: ids.bundle,
    status: "running",
    snapshot_hash: null,
    findings: [],
    violation_count: null,
    started_at: T0,
    finished_at: null,
    ...overrides,
  };
  state.checks.set(check.id, check);
  return check;
}

// 이미 적용된(또는 물러난) 번호 있는 판과 통과한 검사를 심는다.
export function seedNumbered(
  state: ContextApiState,
  t: TestDeps,
  options: {
    n: number;
    // 판 번호와 별개로 ID를 가르는 자리. context가 여럿일 때 쓴다(기본은 n).
    slot?: number;
    status: "applied" | "superseded" | "failed" | "checking";
    context?: string;
    content?: Record<string, unknown>;
    parent?: string | null;
  },
): BundleRow {
  const content = options.content ?? minimalContent();
  const bundleId = id("cbn", options.slot ?? options.n);
  const checkId = id("chk", options.slot ?? options.n);
  const failed = options.status === "failed";
  const running = options.status === "checking";
  const hash = t.hash(content);
  seedCheck(state, {
    id: checkId,
    context: options.context ?? ids.context,
    bundle: bundleId,
    status: running ? "running" : failed ? "failed" : "passed",
    snapshot_hash: running ? null : "c".repeat(64),
    findings: failed
      ? [{ kind: "example_mismatch", target: "examples/0", detail: "mismatch" }]
      : [],
    violation_count: running ? null : 0,
    finished_at: running ? null : T0,
  });
  return seedBundle(state, {
    id: bundleId,
    context: options.context ?? ids.context,
    number: options.n,
    parent: options.parent ?? null,
    bundle_hash: hash,
    status: options.status,
    check: checkId,
    content,
  });
}

// 첫 판이 적용된 active context를 심는다. 판 번호는 1이다.
export function seedActive(
  state: ContextApiState,
  t: TestDeps,
  options: {
    context?: Partial<ContextValue>;
    content?: Record<string, unknown>;
    n?: number;
    slot?: number;
  } = {},
): { context: ContextValue; bundle: BundleRow } {
  const bundle = seedNumbered(state, t, {
    n: options.n ?? 1,
    slot: options.slot,
    status: "applied",
    context: options.context?.id,
    content: options.content,
  });
  const context = seedContext(state, {
    status: "active",
    applied_bundle: bundle.id,
    ...options.context,
  });
  return { context, bundle };
}

export function seedView(
  state: ContextApiState,
  overrides: Partial<SavedViewValue> = {},
): SavedViewValue {
  const view: SavedViewValue = {
    id: ids.view,
    context: ids.context,
    name: "Running experiments",
    search: "experiments_by_status",
    inputs: { status: ["running"] },
    origin: "user",
    revision: bump(state),
    ...overrides,
  };
  state.views.set(view.id, view);
  return view;
}

export function seedEntry(
  state: ContextApiState,
  overrides: Partial<GlossaryEntry> = {},
): GlossaryEntry {
  const entry: GlossaryEntry = {
    id: ids.entry,
    context: ids.context,
    term: "Run",
    meaning: "One trial of an arm",
    set_by: "user",
    updated_at: T0,
    revision: bump(state),
    ...overrides,
  };
  state.glossary.set(entry.id, entry);
  return entry;
}

export function violation(
  overrides: Partial<StoredViolation> = {},
): StoredViolation {
  return {
    context: ids.context,
    bundle_hash: "a".repeat(64),
    kind: "rule",
    rule: "Experiment.status-required",
    type: "Experiment",
    path: "eval/experiments/exp-004-nostatus.md",
    section: null,
    target: null,
    message: "Every experiment says its status",
    ...overrides,
  };
}

export function seedViolations(
  state: ContextApiState,
  violations: StoredViolation[],
  context = ids.context,
) {
  state.violations.set(context, violations);
}

export function entity(
  type: string,
  key: string,
  fields: Record<string, unknown> = {},
  more: Partial<EntityRow> = {},
): EntityRow {
  return {
    type,
    key,
    path: `eval/experiments/exp-${key}-x.md`,
    section: null,
    fields: { id: key, ...fields },
    ...more,
  };
}

export function summaryOf(row: BundleRow): BundleSummary {
  const { content: _content, ...summary } = row;
  return summary;
}

// 마지막으로 낸 event type들(오래된 것부터)이다.
export function eventTypes(state: ContextApiState, from = 0): string[] {
  return state.events.slice(from).map((event) => event.type);
}
