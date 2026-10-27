// 운영 앱 process의 sandbox 경계를 실제 Deno process 하나로 확인한다. flag는 제품이 쓰는 `appFlags`와
// `socketFlags`가 만든 그대로이고 임시 폴더 밖 사람의 data root는 열지 않는다(env 전체 지정, 임시 HOME).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { appFlags, socketFlags } from "./flags.ts";

const PROBE = `
const paths = JSON.parse(Deno.args[0]);
const result = {};
async function attempt(name, work) {
  try {
    await work();
    result[name] = "ok";
  } catch (error) {
    result[name] = error instanceof Deno.errors.NotCapable
      ? "denied"
      : "error:" + (error && error.message);
  }
}
// 자기 socket은 듣고 연결할 수 있다. 같은 경로 이름이라도 다른 경로는 열지 못한다.
async function listenAndConnect(path) {
  const listener = Deno.listen({ transport: "unix", path });
  try {
    const connection = await Deno.connect({ transport: "unix", path });
    connection.close();
  } finally {
    listener.close();
  }
}
await attempt("read bundle", () => Deno.readTextFile(paths.bundleFile));
await attempt("read data", () => Deno.readTextFile(paths.dataFile));
await attempt("write database", () => Deno.writeTextFile(paths.database, "changed"));
await attempt("create database journal", () => Deno.writeTextFile(paths.journal, "new"));
await attempt("list data", async () => { for await (const _ of Deno.readDir(paths.dataDir)) {} });
await attempt("write other data file", () => Deno.writeTextFile(paths.dataFile, "changed"));
await attempt("create other data file", () => Deno.writeTextFile(paths.dataNew, "new"));
await attempt("write bundle", () => Deno.writeTextFile(paths.bundleFile, "tampered"));
await attempt("read source", () => Deno.readTextFile(paths.sourceFile));
await attempt("read other app db", () => Deno.readTextFile(paths.otherDb));
await attempt("write other app db", () => Deno.writeTextFile(paths.otherDb, "x"));
await attempt("read log", () => Deno.readTextFile(paths.logFile));
await attempt("read platform db", () => Deno.readTextFile(paths.platformDb));
await attempt("read credential", () => Deno.readTextFile(paths.credentialFile));
await attempt("write credential", () => Deno.writeTextFile(paths.credentialFile, "x"));
await attempt("list platform root", async () => { for await (const _ of Deno.readDir(paths.platformRoot)) {} });
await attempt("read parent traversal", () => Deno.readTextFile(paths.dataDir + "/../../other/data/other.db"));
await attempt("env credential", () => { Deno.env.get("LOPHN_CREDENTIAL"); });
await attempt("subprocess", async () => { await new Deno.Command("true").output(); });
await attempt("own control socket", () => listenAndConnect(paths.controlSocket));
await attempt("own broker socket", () => listenAndConnect(paths.brokerSocket));
await attempt("other app control socket", async () => {
  (await Deno.connect({ transport: "unix", path: paths.otherControlSocket })).close();
});
await attempt("any other unix socket", async () => {
  (await Deno.connect({ transport: "unix", path: paths.strayUnixSocket })).close();
});
await attempt("loopback tcp", async () => {
  (await Deno.connect({ hostname: "127.0.0.1", port: paths.tcpPort })).close();
});
console.log(JSON.stringify(result));
`;

const ALLOWED = [
  "read bundle",
  "read data",
  "write database",
  "create database journal",
  "list data",
  "own control socket",
  "own broker socket",
];

const BLOCKED = [
  "write other data file",
  "create other data file",
  "write bundle",
  "read source",
  "read other app db",
  "write other app db",
  "read log",
  "read platform db",
  "read credential",
  "write credential",
  "list platform root",
  "read parent traversal",
  "env credential",
  "subprocess",
  "other app control socket",
  "any other unix socket",
  "loopback tcp",
];

test("운영 앱 process는 자기 bundle과 data 폴더 밖, 다른 앱의 socket, platform 자원, 자격 파일에 닿지 못하고 자기 두 socket만 쓴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-sandbox-"));
  const make = async (path: string, text: string) => {
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await writeFile(path, text);
  };
  // 닿으면 안 되는 socket이 실제로 듣고 있어야 거절이 연결 실패와 구별된다.
  const otherControlSocket = `${root}/run/other-a.sock`;
  const strayUnixSocket = `${root}/stray/x.sock`;
  await mkdir(`${root}/run`, { recursive: true });
  await mkdir(`${root}/stray`, { recursive: true });
  const listeners = [
    Deno.listen({ transport: "unix", path: otherControlSocket }),
    Deno.listen({ transport: "unix", path: strayUnixSocket }),
    Deno.listen({ transport: "tcp", hostname: "127.0.0.1", port: 0 }),
  ];
  try {
    const tcpPort = (listeners[2].addr as Deno.NetAddr).port;
    const paths = {
      bundleFile: `${root}/apps/self/bundle/main.ts`,
      dataDir: `${root}/apps/self/data`,
      dataFile: `${root}/apps/self/data/own.db`,
      dataNew: `${root}/apps/self/data/new.db`,
      database: `${root}/apps/self/data/app.sqlite`,
      journal: `${root}/apps/self/data/app.sqlite-journal`,
      sourceFile: `${root}/apps/self/source/src/app.ts`,
      otherDb: `${root}/apps/other/data/other.db`,
      logFile: `${root}/logs/app.log`,
      platformDb: `${root}/platform/ledger.db`,
      platformRoot: `${root}/platform`,
      credentialFile: `${root}/home/.ssh/id_ed25519`,
      brokerSocket: `${root}/run/b.sock`,
      controlSocket: `${root}/run/a.sock`,
      otherControlSocket,
      strayUnixSocket,
      tcpPort,
    };
    await make(paths.bundleFile, PROBE);
    await make(paths.dataFile, "own");
    await make(paths.database, "db");
    await make(paths.sourceFile, "source");
    await make(paths.otherDb, "other");
    await make(paths.logFile, "log");
    await make(paths.platformDb, "platform");
    await make(paths.credentialFile, "credential");

    const sockets = {
      brokerSocket: paths.brokerSocket,
      controlSocket: paths.controlSocket,
    };
    // supervisor가 띄울 때와 같다: appFlags 위에 시작마다 정한 socket flag를 더한다.
    const flags = appFlags(
      [],
      { bundle: `${root}/apps/self/bundle`, data: paths.dataDir },
      { ports: [tcpPort] },
      [
        `${root}/apps/self/source`,
        `${root}/apps/other`,
        `${root}/logs`,
        `${root}/platform`,
        `${root}/home/.ssh`,
      ],
    );
    assert.ok(flags.ok);
    const socketArgs = socketFlags(sockets);
    assert.ok(socketArgs.ok);

    // env를 통째로 정해 넘긴다: 부모 환경이 child로 새지 않아야 한다.
    const output = spawnSync(
      Deno.execPath(),
      [
        "run",
        ...flags.value.args,
        ...socketArgs.value,
        paths.bundleFile,
        JSON.stringify(paths),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          HOME: `${root}/home`,
          PATH: process.env.PATH ?? "",
          DENO_DIR: process.env.DENO_DIR ?? `${root}/deno`,
          // 환경의 credential은 읽을 수 없어야 한다.
          LOPHN_CREDENTIAL: "secret",
        },
      },
    );
    assert.ok(
      output.error === undefined && output.status === 0,
      `probe failed: ${
        output.error?.message ?? new TextDecoder().decode(output.stderr)
      }`,
    );
    const result: Record<string, string> = JSON.parse(
      new TextDecoder().decode(output.stdout).trim(),
    );

    for (const name of ALLOWED) {
      assert.deepStrictEqual(result[name], "ok", name);
    }
    for (const name of BLOCKED) {
      assert.deepStrictEqual(result[name], "denied", name);
    }
    // 거절한 쓰기는 파일에 닿지 않았다.
    assert.deepStrictEqual(await readFile(paths.otherDb, "utf8"), "other");
    assert.deepStrictEqual(
      await readFile(paths.credentialFile, "utf8"),
      "credential",
    );
    assert.deepStrictEqual(await readFile(paths.bundleFile, "utf8"), PROBE);
    assert.deepStrictEqual(await readFile(paths.dataFile, "utf8"), "own");
  } finally {
    for (const listener of listeners) listener.close();
    await rm(root, { recursive: true });
  }
});
