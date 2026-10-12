// 준비한 bundle의 release 확정(`release.prepare`)을 실제 core(임시 LOPHN_HOME)와 실제 apps supervisor·준비 자식으로
// 본다(apps/releases#R1, R5, R6). 확정은 접수한 coding agent의 ticket claim이 현재이고 같은 bundle hash의 app test가
// 통과로 기록된 때만 선다. Verification 행은 problems의 기록 표에 직접 심고(test runner는 problems 몫이다) 그 밖은 제품
// 조립 그대로다. 사람 데이터 root는 열지 않는다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import {
  openWorld,
  type World,
} from "../../packages/core/apps/runtime/world_test.ts";
import {
  installedHome,
  removeTree,
  scaffoldInto,
} from "../../packages/core/apps/packages/testing/mod.ts";
import { createLedgerRegistration as createProblemsRegistration } from "./problems.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { problemsTestDefinitions } from "./problems.ts";
import { ticketDefinitions } from "./tickets.ts";
import { call, command, inspect } from "./testing/approvals-fixture.ts";

const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const OTHER_BUNDLE = "e".repeat(64);

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

type Opened = {
  world: World;
  commit: string;
  coding: { token: string; connection: string };
  machine: string;
  dispose(): Promise<void>;
};

function withLedger(world: World, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    run(db);
  } finally {
    db.close();
  }
}

async function open(): Promise<Opened> {
  const world = await openWorld({
    supervisor: true,
    extend: {
      teams: [
        { createLedgerRegistration: createProblemsRegistration },
        { problemsTestDefinitions },
        { codingAgentConnectionDefinitions },
        { ticketDefinitions },
      ],
      teamModules: [
        new URL("./problems.ts", import.meta.url).href,
        new URL("./coding-agent.ts", import.meta.url).href,
        new URL("./tickets.ts", import.meta.url).href,
      ],
    },
  });
  const installed = await installedHome();
  const source = await Deno.makeTempDir({ prefix: "lophn-final-source-" });
  const dir = `${source}/app`;
  await scaffoldInto(installed, dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "dev@lophn.local"]);
  await git(dir, ["config", "user.name", "dev"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "init"]);
  const commit = await git(dir, ["rev-parse", "HEAD"]);
  const copied = await new Deno.Command("cp", {
    args: ["-r", `${installed.home}/sdk`, `${world.harness.dataRoot}/sdk`],
  }).output();
  assert(copied.success);
  await new Deno.Command("chmod", {
    args: ["-R", "u+rwX", `${world.harness.dataRoot}/sdk`],
  }).output();
  const user = await world.login("user", ["app.get", "app.connect_source"]);
  const got = await call(world.harness, "apps/get", user.token, {
    app: world.app,
  });
  assertEquals(got.status, 200, JSON.stringify(got.body));
  const connected = await call(
    world.harness,
    "apps/connect_source",
    user.token,
    command(
      { app: world.app, source_path: dir },
      {
        compare: {
          base_revision: (got.body["app"] as { revision: string }).revision,
        },
      },
    ),
  );
  assertEquals(connected.status, 200, JSON.stringify(connected.body));
  const coding = await world.login(
    "coding_agent",
    ["release.prepare_bundle", "release.preparation"],
    { conditions: { app: world.app } },
  );
  const machine = (await world.login("machine", [
    "release.prepare_bundle",
    "release.preparation",
  ])).token;
  const connection = coding.context.actor.slice("coding_agent:".length);
  // 이 연결이 쥔 ticket claim이다(claim 기한은 먼 미래).
  withLedger(world, (db) => {
    db.prepare(
      `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems,
         state, readiness, needs, cancel_reason, completion_seq, revision)
       values (?, ?, 'implementation', 't', 'w', 'y', '[]', '[]', '[]', 'claimed', 'ready',
         '[]', NULL, NULL, '1')`,
    ).run(TICKET, world.app);
    db.prepare(
      `insert into ticket_claims (ticket, connection, claim_seq, expires_at)
       values (?, ?, '3', '2099-01-01T00:00:00.000Z')`,
    ).run(TICKET, connection);
  });
  return {
    world,
    commit,
    coding: { token: coding.token, connection },
    machine,
    async dispose() {
      await new Deno.Command("chmod", {
        args: ["-R", "u+rwX", world.harness.dataRoot],
      }).output();
      await world.close();
      await removeTree(source);
      await installed.dispose();
    },
  };
}

const SOURCE = { ticket: TICKET, claim_seq: "3" };

async function accept(
  p: Opened,
  token: string,
  key: string,
  ticketSource?: { ticket: string; claim_seq: string },
) {
  return await call(
    p.world.harness,
    "releases/prepare_bundle",
    token,
    command({
      app: p.world.app,
      commit: p.commit,
      request_key: key,
      ...(ticketSource === undefined ? {} : { ticket_source: ticketSource }),
    }),
  );
}

async function poll(p: Opened, token: string, key: string) {
  return await call(
    p.world.harness,
    "releases/preparation",
    token,
    command({ app: p.world.app, request_key: key }),
  );
}

// 준비가 끝날 때까지 읽는다. 확정은 끝난 준비를 읽을 때 일어나므로 이 마지막 읽기 응답을 돌려준다.
async function settled(p: Opened, token: string, key: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const read = await poll(p, token, key);
    if (read.status !== 200 || read.body["status"] !== "preparing") return read;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("preparation did not settle");
}

let verifications = 0;

function seedVerification(
  p: Opened,
  bundleHash: string,
  result: "pass" | "fail",
): string {
  verifications += 1;
  const id = `vrf_01arz3ndektsv4rrffq69g5f${
    String(verifications).padStart(2, "0")
  }`;
  withLedger(p.world, (db) => {
    db.prepare(
      `insert into verifications (id, request_principal, request_key, request_hash, kind, app,
         target_bundle_hash, target_release, problem, basis_seq, before_release, after_release,
         ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution,
         result, reason, observations, recorded_seq, verification_canonical)
       values (?, 'runner-1', ?, ?, 'app_test', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
         NULL, NULL, '{}', '{}', ?, '', '[]', '1', '{}')`,
    ).run(id, `key-${id}`, "f".repeat(64), p.world.app, bundleHash, result);
  });
  return id;
}

function releases(p: Opened) {
  return inspect(
    p.world.harness,
    "SELECT id, bundle_hash, code_commit, ticket_source, created_by, status FROM releases WHERE app = ?",
    [p.world.app],
  );
}

Deno.test("apps/releases#R5, R6: 준비가 끝나도 같은 hash의 통과한 app test가 없으면 확정하지 않고, 통과로 기록된 뒤 읽으면 그 test와 claim 출처로 prepared release가 선다", async () => {
  const p = await open();
  try {
    assertEquals(
      (await accept(p, p.coding.token, "fin-1", SOURCE)).status,
      200,
    );
    const done = await settled(p, p.coding.token, "fin-1");
    assertEquals(done.status, 200, JSON.stringify(done.body));
    assertEquals(done.body["status"], "completed");
    const bundleHash = String(done.body["bundle_hash"]);
    // test 기록이 없다.
    assertEquals(releases(p).length, 0);
    // 실패와 다른 hash의 통과는 근거가 아니다.
    seedVerification(p, bundleHash, "fail");
    seedVerification(p, OTHER_BUNDLE, "pass");
    assertEquals((await poll(p, p.coding.token, "fin-1")).status, 200);
    assertEquals(releases(p).length, 0);

    const test = seedVerification(p, bundleHash, "pass");
    const again = await poll(p, p.coding.token, "fin-1");
    assertEquals(again.status, 200, JSON.stringify(again.body));
    const rows = releases(p);
    assertEquals(rows.length, 1);
    assertEquals(rows[0]["bundle_hash"], bundleHash);
    assertEquals(rows[0]["code_commit"], p.commit);
    assertEquals(rows[0]["status"], "prepared");
    assertEquals(
      inspect(
        p.world.harness,
        "SELECT verification FROM release_tests WHERE release = ?",
        [String(rows[0]["id"])],
      ).map((row) => row["verification"]),
      [test],
    );
    assertEquals(JSON.parse(String(rows[0]["ticket_source"])), SOURCE);
    assertEquals(rows[0]["created_by"], `coding_agent:${p.coding.connection}`);
    // 같은 준비를 다시 읽어도 release는 하나다.
    assertEquals((await poll(p, p.coding.token, "fin-1")).status, 200);
    // 새 request_key로 같은 bundle을 다시 준비해도 release를 더하지 않는다.
    assertEquals(
      (await accept(p, p.coding.token, "fin-2", SOURCE)).status,
      200,
    );
    assertEquals((await settled(p, p.coding.token, "fin-2")).status, 200);
    assertEquals(releases(p).length, 1);
    // 확정은 활성화가 아니다.
    const app = inspect(
      p.world.harness,
      "SELECT active_release FROM apps WHERE id = ?",
      [p.world.app],
    );
    assertEquals(app[0]["active_release"], null);
  } finally {
    await p.dispose();
  }
});

Deno.test("apps/releases#R6: 확정 때 claim이 더는 현재가 아니면 거절하고, ticket 출처 없는 접수(validate)는 통과한 test가 있어도 확정하지 않는다", async () => {
  const p = await open();
  try {
    // coding agent 접수는 claim이 현재일 때만 확정된다. 준비 사이에 claim이 풀렸다.
    assertEquals(
      (await accept(p, p.coding.token, "fin-3", SOURCE)).status,
      200,
    );
    const done = await settled(p, p.coding.token, "fin-3");
    const bundleHash = String(done.body["bundle_hash"]);
    withLedger(p.world, (db) => {
      db.prepare("delete from ticket_claims where ticket = ?").run(TICKET);
    });
    seedVerification(p, bundleHash, "pass");
    const refused = await poll(p, p.coding.token, "fin-3");
    assert(refused.status >= 400, JSON.stringify(refused.body));
    assertEquals(releases(p).length, 0);

    // ticket 없는 접수는 같은 bundle의 통과한 test가 있어도 release를 확정하지 않는다.
    assertEquals((await accept(p, p.machine, "fin-4")).status, 200);
    const plain = await settled(p, p.machine, "fin-4");
    assertEquals(plain.body["bundle_hash"], bundleHash);
    assertEquals(plain.status, 200, JSON.stringify(plain.body));
    assertEquals(releases(p).length, 0);
  } finally {
    await p.dispose();
  }
});
