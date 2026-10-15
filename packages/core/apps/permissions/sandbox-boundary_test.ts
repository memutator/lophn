// 운영 앱 process의 sandbox 경계를 실제 Deno process 하나로 확인한다. flag는 제품이 쓰는 `appFlags`와
// `socketFlags`가 만든 그대로이고 임시 폴더 밖 사람의 data root는 열지 않는다(clearEnv, 임시 HOME).
import { assert, assertEquals } from "@std/assert";
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

Deno.test("운영 앱 process는 자기 bundle과 data 폴더 밖, 다른 앱의 socket, platform 자원, 자격 파일에 닿지 못하고 자기 두 socket만 쓴다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-sandbox-" });
  const make = async (path: string, text: string) => {
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, text);
  };
  // 닿으면 안 되는 socket이 실제로 듣고 있어야 거절이 연결 실패와 구별된다.
  const otherControlSocket = `${root}/run/other-a.sock`;
  const strayUnixSocket = `${root}/stray/x.sock`;
  await Deno.mkdir(`${root}/run`, { recursive: true });
  await Deno.mkdir(`${root}/stray`, { recursive: true });
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
    assert(flags.ok);
    const socketArgs = socketFlags(sockets);
    assert(socketArgs.ok);

    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        ...flags.value.args,
        ...socketArgs.value,
        paths.bundleFile,
        JSON.stringify(paths),
      ],
      stdout: "piped",
      stderr: "piped",
      clearEnv: true,
      env: {
        HOME: `${root}/home`,
        PATH: Deno.env.get("PATH") ?? "",
        DENO_DIR: Deno.env.get("DENO_DIR") ?? `${root}/deno`,
        // 환경의 credential은 읽을 수 없어야 한다.
        LOPHN_CREDENTIAL: "secret",
      },
    }).output();
    assert(
      output.success,
      `probe failed: ${new TextDecoder().decode(output.stderr)}`,
    );
    const result: Record<string, string> = JSON.parse(
      new TextDecoder().decode(output.stdout).trim(),
    );

    for (const name of ALLOWED) assertEquals(result[name], "ok", name);
    for (const name of BLOCKED) assertEquals(result[name], "denied", name);
    // 거절한 쓰기는 파일에 닿지 않았다.
    assertEquals(await Deno.readTextFile(paths.otherDb), "other");
    assertEquals(await Deno.readTextFile(paths.credentialFile), "credential");
    assertEquals(await Deno.readTextFile(paths.bundleFile), PROBE);
    assertEquals(await Deno.readTextFile(paths.dataFile), "own");
  } finally {
    for (const listener of listeners) listener.close();
    await Deno.remove(root, { recursive: true });
  }
});
