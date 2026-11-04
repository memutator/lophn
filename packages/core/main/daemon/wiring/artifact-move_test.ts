import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import type {
  RequestContext,
  Sql,
  Tx,
} from "../../../../protocol/server/mod.ts";
import { domainsSchemaSteps } from "./domains-retire.ts";
import { conversationSchemaSteps } from "../../../lophn-agent/session/model.ts";
import { turnSchemaSteps } from "../../../lophn-agent/run-loop/schema.ts";
import { toolsSchemaSteps } from "../../../lophn-agent/tools/model.ts";
import {
  createRewindStore,
  createSessionRewindCommands,
  installRestore,
  planRewind,
  prepareRestore,
  revertSchemaSteps,
} from "../../../lophn-agent/session/rewind/mod.ts";
import { observeFiles } from "../../../lophn-agent/session/rewind/prepare.ts";
import { artifactMoveStep } from "./artifact-move.ts";

const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";

// 폴더 안 모든 file의 상대 경로와 내용이다. 두 번 돌려도 같은지 보는 데 쓴다.
async function snapshot(folder: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    out.push(
      ...(entry.isDirectory()
        ? await snapshot(join(folder, entry.name), `${path}/`)
        : [`${path}=${await readFile(join(folder, entry.name), "utf8")}`]),
    );
  }
  return out.sort();
}

// 사용자 data를 잃으면 안 된다: 같은 그릇 안 이름이 겹쳐도, artifact 안 하위 폴더가 있어도 file이 모두 남고, 다시 돌려도 아무것도 옮기지 않는다.
test("artifact 옮기기는 이름이 겹쳐도 file을 잃지 않고 다시 돌아도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-artifact-move-"));
  try {
    const db = new DatabaseSync(join(root, "lophn.db"));
    db.exec("pragma foreign_keys = off");
    for (const step of [
      ...domainsSchemaSteps,
      ...conversationSchemaSteps,
      ...turnSchemaSteps,
      ...toolsSchemaSteps,
      ...revertSchemaSteps,
    ]) {
      db.exec(step.sql);
    }
    // alpha·beta는 같은 project, gamma는 다른 project에 이미 같은 이름이 있고, delta는 보관한 앱의 것이다.
    const domain = db.prepare(
      `INSERT INTO domains (id, name, title, purpose, owner_kind, owner_id, revision, status)
       VALUES (?, ?, 't', '', ?, ?, '1', ?)`,
    );
    domain.run("dom_a", "alpha", "project", PRJ, "active");
    domain.run("dom_b", "beta", "project", PRJ, "active");
    domain.run("dom_c", "gamma", "project", OTHER, "active");
    domain.run("dom_d", "delta", "app", APP, "archived");
    db.close();
    const put = async (path: string, text: string) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, text);
    };
    for (const [dom, text] of [
      ["dom_a", "alpha"],
      ["dom_b", "beta"],
      ["dom_c", "gamma"],
      ["dom_d", "delta"],
    ]) {
      await put(
        join(root, "domains", dom, "artifacts/report/index.html"),
        text,
      );
      await put(
        join(root, "domains", dom, "artifacts/report/data/series.json"),
        `${text}-data`,
      );
    }
    await put(
      join(root, "domains/dom_b/artifacts/only-beta/index.html"),
      "only",
    );
    // 그릇에 다른 까닭으로 이미 있던 것은 덮이지 않는다.
    await put(
      join(root, "projects", OTHER, "artifacts/report/index.html"),
      "kept",
    );
    // 판 8 layout: 탭 key와 group이 가리키는 key가 모두 새 신원으로 바뀐다.
    await put(
      join(root, "shell/places", `${PRJ}.json`),
      JSON.stringify({
        schema_version: 8,
        active_desk: "_default",
        desks: {
          _default: {
            label: "Main",
            tabs: [
              {
                key: "artifact:dom_a:report",
                kind: "artifact",
                title: "report",
                domain: "dom_a",
                name: "report",
              },
              {
                key: "artifact:dom_b:report",
                kind: "artifact",
                title: "report",
                domain: "dom_b",
                name: "report",
              },
            ],
            selected_tab: "artifact:dom_b:report",
            groups: [
              {
                layout: {
                  dir: "row",
                  ratio: 0.5,
                  a: { tab: "artifact:dom_a:report" },
                  b: { tab: "artifact:dom_b:report" },
                },
                focus: "artifact:dom_b:report",
              },
            ],
            // domain을 모르는 탭은 그 탭만 빠진다.
            floats: [
              {
                tab: {
                  key: "artifact:dom_zzz:x",
                  kind: "artifact",
                  title: "x",
                  domain: "dom_zzz",
                  name: "x",
                },
                rect: { x: 0, y: 0, width: 1, height: 1 },
                minimized: false,
              },
            ],
            detached: [],
          },
        },
      }),
    );

    const first = await artifactMoveStep.run(root);
    assert.ok(first.ok);

    const projectFolder = join(root, "projects", PRJ, "artifacts");
    assert.deepStrictEqual(await snapshot(projectFolder), [
      "only-beta/index.html=only",
      "report-beta/data/series.json=beta-data",
      "report-beta/index.html=beta",
      "report/data/series.json=alpha-data",
      "report/index.html=alpha",
    ]);
    assert.deepStrictEqual(
      await snapshot(join(root, "projects", OTHER, "artifacts")),
      [
        "report-gamma/data/series.json=gamma-data",
        "report-gamma/index.html=gamma",
        "report/index.html=kept",
      ],
    );
    assert.deepStrictEqual(
      await snapshot(join(root, "apps", APP, "artifacts")),
      ["report/data/series.json=delta-data", "report/index.html=delta"],
    );
    // 옛 자리에는 artifact가 남지 않는다.
    assert.deepStrictEqual(await snapshot(join(root, "domains")), []);

    const layout = JSON.parse(
      await readFile(join(root, "shell/places", `${PRJ}.json`), "utf8"),
    );
    const key = (name: string) => `artifact:project:${PRJ}:${name}`;
    const desk = layout.desks._default;
    assert.equal(layout.schema_version, 9);
    assert.deepStrictEqual(
      desk.tabs.map((tab: Record<string, unknown>) => [
        tab["key"],
        tab["project"],
        tab["name"],
        tab["domain"],
      ]),
      [
        [key("report"), PRJ, "report", undefined],
        [key("report-beta"), PRJ, "report-beta", undefined],
      ],
    );
    assert.deepStrictEqual(desk.floats, []);
    assert.equal(desk.selected_tab, key("report-beta"));
    assert.equal(desk.groups[0].layout.b.tab, key("report-beta"));
    assert.equal(desk.groups[0].focus, key("report-beta"));

    const before = [
      await snapshot(join(root, "projects")),
      await snapshot(join(root, "apps")),
    ];
    const again = await artifactMoveStep.run(root);
    assert.ok(again.ok);
    assert.deepStrictEqual(
      [
        await snapshot(join(root, "projects")),
        await snapshot(join(root, "apps")),
      ],
      before,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const SESSION = "ses_00000000000000000000000001";
const user: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const text = (path: string) => readFile(path, "utf8").catch(() => null);

// 옛 모양의 rewind 기록(PM·App Engineer의 domain 폴더 root와 Operator의 domain `artifacts/` root)을 둔 ledger로 data step을 돌린 뒤,
// 진짜 복원 code로 되돌린다. 복원은 그릇의 `artifacts/<최종 이름>/`에 쓰고 이긴 쪽 artifact와 옛 domains 자리는 건드리지 않는다.
test("artifact 옮기기 뒤 옛 checkpoint를 되돌리면 최종 이름의 새 자리에 쓴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-artifact-rewind-"));
  const store = await mkdtemp(join(tmpdir(), "lophn-artifact-rewind-store-"));
  try {
    const file = join(root, "lophn.db");
    const db = new DatabaseSync(file);
    db.exec("pragma foreign_keys = off");
    for (const step of [
      ...domainsSchemaSteps,
      ...conversationSchemaSteps,
      ...turnSchemaSteps,
      ...toolsSchemaSteps,
      ...revertSchemaSteps,
    ]) {
      db.exec(step.sql);
    }
    const sqlOf = (target: DatabaseSync): Sql => ({
      run: (query, params) => target.prepare(query).run(...params),
      get: (query, params) => target.prepare(query).get(...params) as never,
      all: (query, params) => target.prepare(query).all(...params) as never,
    });
    const sql = sqlOf(db);
    for (const [id, name] of [
      ["dom_a", "alpha"],
      ["dom_b", "beta"],
    ]) {
      sql.run(
        `INSERT INTO domains (id, name, title, purpose, owner_kind, owner_id, revision, status)
         VALUES (?, ?, 't', '', 'project', ?, '1', 'active')`,
        [id, name, PRJ],
      );
    }
    sql.run(
      `insert into sessions (id, agent, project, place_kind, place_id, created_seq, state_seq)
       values (?, 'agt_1', ?, 'project', ?, 1, 1)`,
      [SESSION, PRJ, PRJ],
    );
    for (const [id, seq] of [
      ["msg_1", 1],
      ["msg_2", 2],
    ] as const) {
      sql.run(
        `insert into messages (id, session, from_kind, body, created_seq, created_at, state_seq)
         values (?, ?, 'human', ?, ?, '2026-10-16T00:00:00.000Z', ?)`,
        [id, SESSION, sha(id), seq, seq],
      );
      sql.run("insert into checkpoints (message, session) values (?, ?)", [
        id,
        SESSION,
      ]);
    }
    const rewind = createRewindStore(store);
    let seq = 0;
    const record = async (
      recordRoot: string,
      path: string,
      checkpoint: string,
      before: string | null,
      after: string,
    ) => {
      const blob =
        before === null
          ? null
          : (await rewind.put(SESSION, new TextEncoder().encode(before))).key;
      sql.run(
        `insert into rewind_files
           (tool_call, root, path, checkpoint, seq, before_exists, before_sha256, before_blob,
            before_size, after_exists, after_sha256, moved_from, reverted_by)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, null, null)`,
        [
          `tcl_${++seq}`,
          recordRoot,
          path,
          checkpoint,
          seq,
          before === null ? 0 : 1,
          before === null ? null : sha(before),
          blob,
          before === null ? null : before.length,
          sha(after),
        ],
      );
    };
    const put = async (path: string, body: string) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, body);
    };
    const domainA = join(root, "domains", "dom_a");
    const domainB = join(root, "domains", "dom_b");
    await put(join(domainA, "artifacts/report/index.html"), "alpha-new");
    await put(join(domainB, "artifacts/report/index.html"), "beta-new");
    await put(join(domainB, "artifacts/report/data/s.json"), "s-new");
    await put(join(domainB, "artifacts/notes/index.html"), "notes-new");
    // domain 폴더 root 모양: 이긴 쪽(alpha)과 이름이 바뀔 쪽(beta).
    await record(
      domainA,
      "artifacts/report/index.html",
      "msg_2",
      "alpha-old",
      "alpha-new",
    );
    await record(
      domainB,
      "artifacts/report/index.html",
      "msg_2",
      "beta-old",
      "beta-new",
    );
    // domain `artifacts/` root 모양.
    await record(
      join(domainB, "artifacts"),
      "report/data/s.json",
      "msg_2",
      "s-old",
      "s-new",
    );
    await record(
      join(domainB, "artifacts"),
      "notes/index.html",
      "msg_2",
      "notes-old",
      "notes-new",
    );
    // 지금은 없는 artifact와 artifact가 아닌 기록.
    await record(domainA, "artifacts/gone/index.html", "msg_1", null, "g");
    await record(domainA, "skills/x/SKILL.md", "msg_1", null, "k");
    db.close();

    const first = await artifactMoveStep.run(root);
    assert.ok(first.ok);
    const again = await artifactMoveStep.run(root);
    assert.ok(again.ok);

    const reopened = new DatabaseSync(file);
    reopened.exec("pragma foreign_keys = off");
    const after = sqlOf(reopened);
    const folder = join(root, "projects", PRJ, "artifacts");
    const rows = after
      .all("select tool_call, root, path from rewind_files order by seq", [])
      .map((row) => [row["root"], row["path"]]);
    assert.deepStrictEqual(rows, [
      [folder, "report/index.html"],
      [folder, "report-beta/index.html"],
      [folder, "report-beta/data/s.json"],
      [folder, "notes/index.html"],
      [folder, "gone/index.html"],
      [domainA, "skills/x/SKILL.md"],
    ]);

    const plan = planRewind(
      { sql: after },
      {
        observe: (files) => {
          const seen = new Map();
          for (const item of files) {
            for (const [path, found] of observeFiles(item.root, [item.path])) {
              seen.set(path, found);
            }
          }
          return seen;
        },
      },
      { session: SESSION, checkpoint: "msg_2", choice: "restore_all" },
    );
    assert.ok(plan.ok);
    const files = await prepareRestore({
      store: rewind,
      session: SESSION,
      judged: plan.value.judged,
      current: plan.value.current,
    });
    const tx = {
      sql: after,
      now: () => "2026-10-16T00:00:00.000Z",
      emit: () => 1,
    } as unknown as Tx;
    const commands = createSessionRewindCommands({
      effects: { summaryOk: () => true, cancelWaiting: () => ok(undefined) },
    });
    const done = commands.rewind.handle(
      tx,
      user,
      {
        id: "rwd_1",
        session: SESSION,
        checkpoint: "msg_2",
        choice: "restore_all",
        accept_remaining: true,
        preview_hash: plan.value.preview.preview_hash,
        summary_call: null,
        files,
        apps: [],
      } as never,
      {} as never,
    );
    assert.ok(done.ok);
    await installRestore({
      store: rewind,
      session: SESSION,
      judged: plan.value.judged,
      prepared: files,
    });
    reopened.close();

    assert.equal(await text(join(folder, "report/index.html")), "alpha-old");
    assert.equal(
      await text(join(folder, "report-beta/index.html")),
      "beta-old",
    );
    assert.equal(await text(join(folder, "report-beta/data/s.json")), "s-old");
    assert.equal(await text(join(folder, "notes/index.html")), "notes-old");
    // 이긴 쪽에는 beta의 기록이 닿지 않았다.
    assert.equal(
      await stat(join(folder, "report/data")).catch(() => null),
      null,
    );
    // 옛 자리에는 아무것도 쓰지 않았다.
    for (const old of [domainA, domainB]) {
      assert.equal(await stat(join(old, "artifacts")).catch(() => null), null);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});
