import { assertEquals } from "@std/assert";
import type {
  ContextValue,
  StoredViolation,
} from "../../../protocol/projects/mod.ts";
import { createContextApiCommands } from "./api/commands.ts";
import type {
  BundleRow,
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./api/state.ts";

const id = (prefix: string, n: number) => `${prefix}_${"0".repeat(25)}${n}`;
const MINE = id("prj", 1);
const OTHER = id("prj", 2);
const CTX = id("ctx", 1);
const BUNDLE = id("cbn", 1);
const CHECK = id("chk", 1);
const HASH = "a".repeat(64);

const context: ContextValue = {
  id: CTX,
  project: MINE,
  title: "Experiments",
  purpose: "Track experiments",
  status: "active",
  applied_bundle: BUNDLE,
  violation_mark: 0,
  revision: "1",
};

const applied: BundleRow = {
  id: BUNDLE,
  context: CTX,
  number: 1,
  parent: null,
  bundle_hash: HASH,
  status: "applied",
  check: CHECK,
  created_by: "user",
  revision: "1",
  content: {},
};

function setup(canWrite: (actor: string, project: string) => boolean) {
  const state: ContextApiState = {
    seq: 1,
    projects: new Map([
      [MINE, { id: MINE, archived: false }],
      [OTHER, { id: OTHER, archived: false }],
    ]),
    contexts: new Map([[CTX, context]]),
    bundles: new Map([[BUNDLE, applied]]),
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
  const recorded = new Map<string, readonly string[]>();
  let next = 100;
  const deps: ContextApiDeps = {
    now: () => "2026-10-16T00:00:00.000Z",
    newId: (prefix) => id(prefix, ++next % 10),
    hash: () => HASH,
    putBlob: () => ({ hash: HASH, size_bytes: 1 }),
    canWrite,
    recordedViolations: (ctx) => recorded.get(ctx) ?? [],
    keepViolations: (ctx, keys) => recorded.set(ctx, keys),
  };
  return { state, commands: createContextApiCommands(state, deps) };
}

const agent = (n: number): ContextApiActor => ({
  kind: "agent",
  actor: `agent:${id("ses", n)}`,
});

Deno.test("다른 project의 Project Manager는 context를 만들거나 고치거나 판을 올리지 못한다", () => {
  // ses 1은 MINE의 Project Manager, ses 2는 OTHER의 Project Manager다.
  const { state, commands } = setup((actor, project) =>
    actor === agent(1).actor ? project === MINE : project === OTHER
  );
  const draft = id("cbn", 2);
  state.bundles.set(draft, {
    ...applied,
    id: draft,
    number: null,
    parent: BUNDLE,
    bundle_hash: null,
    status: "draft",
    check: null,
    revision: "2",
  });
  const intruder = agent(2);
  const glossary = {
    id: id("trm", 1),
    context: CTX,
    term: "run",
    meaning: "one experiment run",
  };
  const attempts = [
    commands.contextCreate({
      actor: intruder,
      key: "k1",
      input: {
        id: id("ctx", 2),
        project: MINE,
        title: "New",
        purpose: "New purpose",
      },
      compare: {},
    }),
    commands.bundleSaveDraft({
      actor: intruder,
      key: "k2",
      input: { context: CTX, content: {} as never },
      compare: {},
    }),
    commands.bundleSubmit({
      actor: intruder,
      key: "k3",
      input: { bundle: draft },
      compare: {},
    }),
    commands.glossarySet({
      actor: intruder,
      key: "k4",
      input: glossary,
      compare: {},
    }),
  ];
  assertEquals(
    attempts.map((result) => !result.ok && result.error.code),
    ["forbidden", "forbidden", "forbidden", "forbidden"],
  );
  assertEquals(state.events, []);

  // 같은 project의 Project Manager는 쓸 수 있다.
  const owner = commands.glossarySet({
    actor: agent(1),
    key: "k5",
    input: glossary,
    compare: {},
  });
  assertEquals(owner.ok, true);
});

Deno.test("새 위반 키가 생길 때만 ContextViolationFound가 남는다", () => {
  const { state, commands } = setup(() => false);
  const worker: ContextApiActor = {
    kind: "machine",
    actor: "machine",
    scope: "context_worker",
  };
  const violation = (path: string): StoredViolation => ({
    context: CTX,
    bundle_hash: HASH,
    kind: "path_mismatch",
    rule: null,
    path,
    section: null,
    type: null,
    target: null,
    message: "path does not match",
  });
  let n = 0;
  const record = (paths: string[]) => {
    state.violations.set(CTX, paths.map(violation));
    return commands.recordViolations({
      actor: worker,
      key: `r${++n}`,
      input: { context: CTX, count: paths.length, bundle_hash: HASH },
      compare: {},
    });
  };
  const found = () =>
    state.events.filter((event) => event.type === "ContextViolationFound");

  assertEquals(record(["a.md"]).ok, true);
  assertEquals(found().length, 1);
  assertEquals(found()[0]!.subject, MINE);
  assertEquals(found()[0]!.payload, {
    project: MINE,
    context: CTX,
    check: CHECK,
  });

  // 같은 위반을 다시 기록해도 남지 않는다.
  record(["a.md"]);
  assertEquals(found().length, 1);

  // 고쳐진 위반 하나와 새 위반 하나가 겹쳐 개수가 같아도 새 위반이니 남는다.
  record(["b.md"]);
  assertEquals(found().length, 2);

  // 위반이 줄거나 고쳐지기만 하면 남지 않는다.
  record([]);
  assertEquals(found().length, 2);
  assertEquals(state.contexts.get(CTX)!.violation_mark, 0);
});
