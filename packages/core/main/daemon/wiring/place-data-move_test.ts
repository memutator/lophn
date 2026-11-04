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
import { domainsSchemaSteps } from "../../../domains/schema.ts";
import { dropDomainsFieldStep } from "../../../lophn-agent/agents/domains-field-step.ts";
import { parseAgentFile } from "../../../lophn-agent/agents/definition-file.ts";
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
import { placeDataMoveStep } from "./place-data-move.ts";

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

async function put(path: string, text: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`;

function openLedger(file: string) {
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
  return db;
}

const sqlOf = (target: DatabaseSync): Sql => ({
  run: (query, params) => target.prepare(query).run(...params),
  get: (query, params) => target.prepare(query).get(...params) as never,
  all: (query, params) => target.prepare(query).all(...params) as never,
});

// 사용자 data를 잃으면 안 된다: 같은 그릇 안 이름이 겹쳐도, skill 안 하위 폴더가 있어도, 대상에 이미 있어도,
// 보관한 domain이어도 file이 모두 남고, 다시 돌려도 아무것도 옮기지 않는다.
test("skill과 DOMAIN.md 옮기기는 이름이 겹쳐도 file을 잃지 않고 다시 돌아도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-place-data-move-"));
  try {
    const db = openLedger(join(root, "lophn.db"));
    // alpha·beta는 같은 project, gamma는 다른 project(대상에 이름이 이미 있다), delta는 보관한 domain의 앱이다.
    const domain = db.prepare(
      `INSERT INTO domains (id, name, title, purpose, owner_kind, owner_id, revision, status)
       VALUES (?, ?, 't', '', ?, ?, '1', ?)`,
    );
    domain.run("dom_a", "alpha", "project", PRJ, "active");
    domain.run("dom_b", "beta", "project", PRJ, "active");
    domain.run("dom_c", "gamma", "project", OTHER, "active");
    domain.run("dom_d", "delta", "app", APP, "archived");
    db.close();
    const d = (dom: string, path: string) => join(root, "domains", dom, path);
    await put(d("dom_a", "skills/util/SKILL.md"), skill("util", "alpha"));
    await put(d("dom_a", "skills/util/notes.md"), "alpha-notes");
    await put(d("dom_a", "skills/util/refs/deep/a.md"), "alpha-deep");
    await put(
      d("dom_a", "skills/only-alpha/SKILL.md"),
      skill("only-alpha", "o"),
    );
    await put(d("dom_a", "DOMAIN.md"), "alpha doc");
    await put(d("dom_a", "kinds.yaml"), "alpha kinds");
    await put(d("dom_b", "skills/util/SKILL.md"), skill("util", "beta"));
    await put(d("dom_b", "skills/util/refs/b.md"), "beta-ref");
    await put(d("dom_b", "DOMAIN.md"), "beta doc");
    await put(d("dom_c", "skills/util/SKILL.md"), skill("util", "gamma"));
    await put(d("dom_c", "DOMAIN.md"), "gamma doc");
    await put(d("dom_d", "skills/util/SKILL.md"), skill("util", "delta"));
    await put(d("dom_d", "DOMAIN.md"), "delta doc");
    // 그릇에 다른 까닭으로 이미 있던 것은 덮이지 않는다. gamma의 skill은 두 이름이 다 차서 제자리에 남는다.
    await put(
      join(root, "projects", OTHER, "skills/util/SKILL.md"),
      skill("util", "kept"),
    );
    await put(
      join(root, "projects", OTHER, "skills/util-gamma/SKILL.md"),
      skill("util-gamma", "kept2"),
    );
    // 이미 옮겨 둔 문서가 있으면 덮지 않는다.
    await put(
      join(root, "projects", PRJ, "old-domains/alpha/kinds.yaml"),
      "kept kinds",
    );

    const first = await placeDataMoveStep.run(root);
    assert.ok(first.ok);

    assert.deepStrictEqual(
      await snapshot(join(root, "projects", PRJ, "skills")),
      [
        `only-alpha/SKILL.md=${skill("only-alpha", "o")}`,
        `util-beta/SKILL.md=${skill("util", "beta").replace("name: util", "name: util-beta")}`,
        "util-beta/refs/b.md=beta-ref",
        `util/SKILL.md=${skill("util", "alpha")}`,
        "util/notes.md=alpha-notes",
        "util/refs/deep/a.md=alpha-deep",
      ].sort(),
    );
    assert.deepStrictEqual(
      await snapshot(join(root, "projects", OTHER, "skills")),
      [
        `util-gamma/SKILL.md=${skill("util-gamma", "kept2")}`,
        `util/SKILL.md=${skill("util", "kept")}`,
      ],
    );
    assert.deepStrictEqual(await snapshot(join(root, "apps", APP, "skills")), [
      `util/SKILL.md=${skill("util", "delta")}`,
    ]);
    assert.deepStrictEqual(
      await snapshot(join(root, "projects", PRJ, "old-domains")),
      [
        "alpha/DOMAIN.md=alpha doc",
        "alpha/kinds.yaml=kept kinds",
        "beta/DOMAIN.md=beta doc",
      ],
    );
    assert.deepStrictEqual(
      await snapshot(join(root, "apps", APP, "old-domains")),
      ["delta/DOMAIN.md=delta doc"],
    );
    // 못 옮긴 것은 제자리에 남는다: gamma의 skill, 덮이지 않으려고 둔 alpha의 kinds.yaml.
    assert.deepStrictEqual(
      await snapshot(join(root, "domains")),
      [
        "dom_a/kinds.yaml=alpha kinds",
        `dom_c/skills/util/SKILL.md=${skill("util", "gamma")}`,
      ].sort(),
    );
    assert.deepStrictEqual(
      await snapshot(join(root, "projects", OTHER, "old-domains")),
      ["gamma/DOMAIN.md=gamma doc"],
    );

    const before = [
      await snapshot(join(root, "projects")),
      await snapshot(join(root, "apps")),
      await snapshot(join(root, "domains")),
    ];
    const again = await placeDataMoveStep.run(root);
    assert.ok(again.ok);
    assert.deepStrictEqual(
      [
        await snapshot(join(root, "projects")),
        await snapshot(join(root, "apps")),
        await snapshot(join(root, "domains")),
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

// 옛 모양의 rewind 기록(domain 폴더 root)을 둔 ledger로 data step을 돌린 뒤 진짜 복원 code로 되돌린다. 복원은
// 그릇의 `skills/<최종 이름>/`과 `old-domains/<domain 이름>/`에 쓰고 `domains/`나 그릇 root에는 쓰지 않는다.
test("skill 옮기기 뒤 옛 checkpoint를 되돌리면 최종 이름의 새 자리에 쓴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-place-data-rewind-"));
  const store = await mkdtemp(join(tmpdir(), "lophn-place-data-store-"));
  try {
    const file = join(root, "lophn.db");
    const db = openLedger(file);
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
    const domainA = join(root, "domains", "dom_a");
    const domainB = join(root, "domains", "dom_b");
    // 이긴 쪽(alpha)과 이름이 바뀔 쪽(beta)의 skill, beta의 문서.
    await put(join(domainA, "skills/util/notes.md"), "a-new");
    await put(join(domainA, "skills/util/SKILL.md"), skill("util", "a"));
    await put(join(domainB, "skills/util/refs/b.md"), "b-new");
    await put(join(domainB, "skills/util/SKILL.md"), skill("util", "b"));
    await put(join(domainB, "DOMAIN.md"), "doc-new");
    await put(join(domainA, "artifacts/page/index.html"), "page");
    await record(domainA, "skills/util/notes.md", "msg_2", "a-old", "a-new");
    await record(domainB, "skills/util/refs/b.md", "msg_2", "b-old", "b-new");
    await record(domainB, "DOMAIN.md", "msg_2", "doc-old", "doc-new");
    // 지금은 없는 skill과, skill이 아닌 기록.
    await record(domainA, "skills/gone/SKILL.md", "msg_1", null, "g");
    await record(domainA, "artifacts/page/index.html", "msg_1", null, "page");
    db.close();

    const first = await placeDataMoveStep.run(root);
    assert.ok(first.ok);
    const again = await placeDataMoveStep.run(root);
    assert.ok(again.ok);

    const reopened = new DatabaseSync(file);
    reopened.exec("pragma foreign_keys = off");
    const after = sqlOf(reopened);
    const skills = join(root, "projects", PRJ, "skills");
    const oldBeta = join(root, "projects", PRJ, "old-domains", "beta");
    const rows = after
      .all("select tool_call, root, path from rewind_files order by seq", [])
      .map((row) => [row["root"], row["path"]]);
    assert.deepStrictEqual(rows, [
      [skills, "util/notes.md"],
      [skills, "util-beta/refs/b.md"],
      [oldBeta, "DOMAIN.md"],
      [skills, "gone/SKILL.md"],
      [domainA, "artifacts/page/index.html"],
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

    assert.equal(await text(join(skills, "util/notes.md")), "a-old");
    assert.equal(await text(join(skills, "util-beta/refs/b.md")), "b-old");
    assert.equal(await text(join(oldBeta, "DOMAIN.md")), "doc-old");
    // 이긴 쪽에는 beta의 기록이 닿지 않았다.
    assert.equal(await stat(join(skills, "util/refs")).catch(() => null), null);
    // 옛 자리와 그릇 root에는 아무것도 쓰지 않았다.
    assert.equal(await stat(join(domainA, "skills")).catch(() => null), null);
    assert.equal(await stat(join(domainB, "skills")).catch(() => null), null);
    assert.equal(await text(join(domainB, "DOMAIN.md")), null);
    const container = join(root, "projects", PRJ);
    assert.deepStrictEqual((await readdir(container)).sort(), [
      "old-domains",
      "skills",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});

// 정의 schema가 `domains`를 더 받지 않으므로, 칸이 차 있던 정의 file은 step 뒤에 진짜 reader로 읽혀야 한다. 못 읽으면 그 agent가 사라진다.
test("domains 칸이 차 있던 정의 file이 step 뒤에 읽힌다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-drop-domains-"));
  try {
    const agent = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as never;
    const path = join(root, "agents", `${agent}.md`);
    const original =
      "---\nname: Reviewer\ndomains:\n  - dom_a\n  - dom_b\nskills_off:\n  - noisy\nskip: true\n---\nHello\n";
    await put(path, original);
    assert.ok(!parseAgentFile(original, { agent }).ok);
    // lophn의 정의는 칸이 domains뿐일 수 있다.
    await put(join(root, "agents", "lophn.md"), "---\ndomains: [dom_a]\n---\n");
    // 칸이 없는 정의와 깨진 정의는 그대로다.
    const plain = "---\nname: Plain\n---\nbody\n";
    await put(join(root, "agents", "agt_01hzzzzzzzzzzzzzzzzzzzzzzb.md"), plain);

    assert.ok((await dropDomainsFieldStep.run(root)).ok);
    const read = parseAgentFile((await text(path))!, { agent });
    assert.ok(read.ok);
    assert.deepStrictEqual(read.value, {
      name: "Reviewer",
      skills_off: ["noisy"],
      skip: true,
      body: "Hello",
    });
    const lophn = parseAgentFile(
      (await text(join(root, "agents", "lophn.md")))!,
      {
        agent: "lophn" as never,
      },
    );
    assert.ok(lophn.ok);
    assert.equal(
      await text(join(root, "agents", "agt_01hzzzzzzzzzzzzzzzzzzzzzzb.md")),
      plain,
    );
    assert.ok((await dropDomainsFieldStep.run(root)).ok);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
