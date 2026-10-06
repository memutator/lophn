// documents/file-tracking#R13: 두기가 파일을 쓰기 전부터 원본 연결까지 잡는 경로의 예약. 그 사이 같은
// 경로의 파일 관측 첫 저장은 conflict로 돌아가 새 문서를 만들지 못하고, 연결 뒤의 재관측은 이미
// 연결된 문서에 붙는다. 실제 core·worker 없이 예약과 writer 앞단, 두기 순서만 맞물려 본다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import type {
  ContentFile,
  Document,
  Project,
  Slug,
} from "../../packages/contracts/documents/mod.ts";
import {
  placeDocumentFile,
  type PlacementDeps,
} from "../../packages/documents/file-tracking/mod.ts";
import type { Writer } from "../../packages/platform/ledger/mod.ts";
import {
  createPlacementReservations,
  withPlacementReservation,
} from "./documents-placement.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const PROJECT = "prj_01kq12a1pha000000000000000";
const VERSION = "ver_01kq12a1pha000000000000001";
const ROOT = "/work/alpha";
const PATH = `${ROOT}/plan.md`;
const HASH = "ab".repeat(32);

type Store = {
  // ledger의 문서. 두기의 대상(DOC)과 관측이 만든 문서가 모두 들어간다.
  documents: Map<string, { source: string | null }>;
  // 관측 저장의 결과 기록.
  observed: string[];
};

// 파일 관측의 document.save를 흉내 낸다: 그 경로에 연결된 문서가 있으면 붙고(변화 없음), 없으면
// 새 문서를 만든다. 실제 core의 newFileSource와 같은 규칙이다(이미 연결된 경로는 새 문서가 아니다).
function innerWriter(store: Store): Writer {
  let minted = 0;
  return {
    command(_ctx: unknown, envelope: { command: string; input: unknown }) {
      if (envelope.command !== "document.save") {
        return Promise.resolve(ok({ result: null }));
      }
      const path = (envelope.input as { source: { path: string } | null })
        .source?.path;
      // 파일 관측이 아닌 저장은 예약과 상관없다.
      if (path === undefined) {
        return Promise.resolve(ok({ result: { status: "saved" } }));
      }
      const linked = [...store.documents.entries()].find(([, row]) =>
        row.source === path
      );
      if (linked !== undefined) {
        store.observed.push(`attached:${linked[0]}`);
        return Promise.resolve(ok({ result: { status: "unchanged" } }));
      }
      minted += 1;
      const id = `doc_observed_${minted}`;
      store.documents.set(id, { source: path });
      store.observed.push(`created:${id}`);
      return Promise.resolve(ok({ result: { status: "saved" } }));
    },
  } as unknown as Writer;
}

const observedSave = {
  command: "document.save",
  input: { source: { kind: "file", path: PATH }, file_basis: { path: PATH } },
  idempotency_key: "observed-1",
  compare: { base_version: null },
  prepared: [],
};
const machine = { actor: "machine" } as never;

function fixture(options: { reserved: boolean }) {
  const store: Store = {
    documents: new Map([[DOC, { source: null }]]),
    observed: [],
  };
  const reservations = createPlacementReservations();
  const wrapped = withPlacementReservation(
    innerWriter(store),
    options.reserved ? reservations : { has: () => false },
  );
  const injected: Result<unknown>[] = [];
  const file: ContentFile = {
    path: "plan.md",
    blob_hash: HASH,
    bytes: 4,
    media_type: "text/markdown",
    primary: true,
  };
  let revision = 3;
  let document: Document = {
    id: DOC,
    place: null,
    name: null,
    title: "Plan",
    file_source: null,
    latest_version: VERSION,
    revision: String(revision),
    status: "active",
  };
  const project: Project = {
    id: PROJECT,
    name: "alpha" as Slug,
    title: "Alpha",
    purpose: "",
    folders: [{ path: ROOT, description: "" }],
    tracking: {
      enabled: true,
      patterns: [{ effect: "include", glob: "**/*.md" }],
      use_gitignore: false,
    },
    revision: "5",
    status: "active",
  };
  const deps: PlacementDeps = {
    files: {
      // 파일이 생긴 직후, 원본 연결 전에 관측이 같은 경로를 본다.
      async writeNew() {
        injected.push(await wrapped.command(machine, observedSave as never));
        return ok({
          done: {
            outcome: "written" as const,
            beforePath: null,
            afterPath: PATH,
            beforeHash: null,
            writtenHash: HASH,
            observedHash: HASH,
            observedAt: "2026-10-06T00:00:00.000Z",
            changedAgain: false,
          },
          recording: "recorded" as const,
        });
      },
      exists: () => Promise.resolve(ok(false)),
      remove: () => Promise.resolve(err({ code: "internal", message: "x" })),
    },
    ledger: {
      document: () => Promise.resolve(ok(document)),
      project: () => Promise.resolve(ok(project)),
      latest: () => Promise.resolve(ok({ version: VERSION, files: [file] })),
      linked: () => Promise.resolve(ok(null)),
      placeName: () => Promise.resolve(ok("plan" as Slug)),
    } as unknown as PlacementDeps["ledger"],
    commands: {
      setSource(input) {
        const path = input.file_source?.kind === "project_file"
          ? input.file_source.path
          : null;
        // 이미 다른 문서가 쓰는 경로는 연결할 수 없다.
        const taken = [...store.documents.entries()].some(([id, row]) =>
          id !== DOC && row.source === path
        );
        if (taken) {
          return Promise.resolve(
            err({ code: "conflict", message: "file is already linked" }),
          );
        }
        store.documents.set(DOC, { source: path });
        revision += 1;
        document = {
          ...document,
          file_source: input.file_source,
          revision: String(revision),
        };
        return Promise.resolve(ok(document));
      },
      move() {
        revision += 1;
        return Promise.resolve(ok(document));
      },
      setTracking: () => Promise.resolve(ok(project)),
    },
    reserve: (path) => reservations.reserve(path),
  };
  return { store, deps, wrapped, injected, reservations };
}

const request = {
  actor: "user",
  requestKey: "place-1",
  document: DOC,
  project: PROJECT,
  path: PATH,
};

Deno.test("documents/file-tracking#R13: 쓰기와 원본 연결 사이에 끼어든 관측 첫 저장은 conflict라 문서와 연결이 정확히 하나다", async () => {
  const { store, deps, wrapped, injected, reservations } = fixture({
    reserved: true,
  });
  const placed = await placeDocumentFile(deps, request);
  assert(placed.ok);
  assertEquals(placed.value.source, { state: "done" });
  // 끼어든 관측은 새 문서를 만들지 못하고 conflict를 받았다.
  assertEquals(injected.length, 1);
  assert(!injected[0].ok);
  assertEquals(injected[0].error.code, "conflict");
  assertEquals(store.observed, []);
  // 연결이 끝나 예약을 놓았다.
  assertEquals(reservations.has(PATH), false);
  // 관측이 다시 보면 이미 연결된 문서에 붙는다. 새 문서는 없다.
  const retried = await wrapped.command(machine, observedSave as never);
  assert(retried.ok);
  assertEquals(store.observed, [`attached:${DOC}`]);
  assertEquals([...store.documents.keys()], [DOC]);
  assertEquals(store.documents.get(DOC)?.source, PATH);
});

Deno.test("documents/file-tracking#R13: 예약이 없으면 같은 끼어듦이 새 문서를 만들고 두기의 연결이 conflict로 실패한다", async () => {
  // 대조군: 앞단이 없으면 이 시험이 그 경쟁을 실제로 잡아낸다.
  const { store, deps, injected } = fixture({ reserved: false });
  const placed = await placeDocumentFile(deps, request);
  assert(placed.ok);
  assert(injected[0].ok);
  assertEquals(placed.value.source.state, "failed");
  assertEquals(store.documents.size, 2);
});

Deno.test("documents/file-tracking#R13: 예약은 그 경로의 파일 관측 저장에만 걸리고 겹쳐 잡은 만큼 놓아야 풀린다", async () => {
  const reservations = createPlacementReservations();
  const first = reservations.reserve(PATH);
  const second = reservations.reserve(PATH);
  assertEquals(reservations.has(PATH), true);
  assertEquals(reservations.has(`${ROOT}/other.md`), false);
  // 같은 경로를 두 번 잡아도 둘 다 놓아야 풀린다. 두 번 놓아도 한 번으로 센다.
  first();
  first();
  assertEquals(reservations.has(PATH), true);
  second();
  assertEquals(reservations.has(PATH), false);
  // 다른 경로의 저장과 관측이 아닌 command는 예약에 걸리지 않는다.
  const store: Store = { documents: new Map(), observed: [] };
  const held = createPlacementReservations();
  const wrapped = withPlacementReservation(innerWriter(store), held);
  const release = held.reserve(PATH);
  const other = await wrapped.command(
    machine,
    {
      ...observedSave,
      input: { source: { kind: "file", path: `${ROOT}/other.md` } },
    } as never,
  );
  assert(other.ok);
  const user = await wrapped.command(
    machine,
    { ...observedSave, input: { source: null } } as never,
  );
  assert(user.ok);
  release();
});
