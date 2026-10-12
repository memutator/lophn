// 운영 앱 자식의 파일 경계를 실제 Deno 프로세스로 확인한다. flags는 제품이 쓰는 `appFlags`가
// 만든 것 그대로이고 임시 폴더 밖 실제 사람 data root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { appFlags } from "../flags.ts";

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
await attempt("read bundle", () => Deno.readTextFile(paths.bundleFile));
await attempt("read data", () => Deno.readTextFile(paths.dataFile));
await attempt("write data", () => Deno.writeTextFile(paths.dataFile, "changed"));
await attempt("create data", () => Deno.writeTextFile(paths.dataNew, "new"));
await attempt("list data", async () => { for await (const _ of Deno.readDir(paths.dataDir)) {} });
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
console.log(JSON.stringify(result));
`;

type World = {
  root: string;
  paths: Record<string, string>;
  args: string[];
};

async function build(label: string): Promise<World> {
  const root = await Deno.makeTempDir({ prefix: `lophn-fs-${label}-` });
  const make = async (path: string, text: string) => {
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, text);
  };
  const paths = {
    bundleFile: `${root}/apps/self/bundle/main.ts`,
    dataDir: `${root}/apps/self/data`,
    dataFile: `${root}/apps/self/data/own.db`,
    dataNew: `${root}/apps/self/data/new.db`,
    sourceFile: `${root}/apps/self/source/src/app.ts`,
    otherDb: `${root}/apps/other/data/other.db`,
    logFile: `${root}/logs/app.log`,
    platformDb: `${root}/platform/ledger.db`,
    platformRoot: `${root}/platform`,
    credentialFile: `${root}/home/.ssh/id_ed25519`,
  };
  await make(paths.bundleFile, PROBE);
  await make(paths.dataFile, "own");
  await make(paths.sourceFile, "source");
  await make(paths.otherDb, "other");
  await make(paths.logFile, "log");
  await make(paths.platformDb, "platform");
  await make(paths.credentialFile, "credential");
  const flags = appFlags(
    [],
    {
      bundle: `${root}/apps/self/bundle`,
      data: paths.dataDir,
      brokerSocket: `${root}/run/b.sock`,
      directSocket: `${root}/run/a.sock`,
    },
    { ports: [] },
    [
      `${root}/apps/self/source`,
      `${root}/apps/other`,
      `${root}/logs`,
      `${root}/platform`,
      `${root}/home/.ssh`,
    ],
  );
  assert(flags.ok);
  return {
    root,
    paths,
    args: [
      "run",
      ...flags.value.args,
      paths.bundleFile,
      JSON.stringify(paths),
    ],
  };
}

async function probe(world: World): Promise<Record<string, string>> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: world.args,
    stdout: "piped",
    stderr: "piped",
    // 사람 data root를 상속하지 않는다. HOME은 임시 폴더다.
    clearEnv: true,
    env: {
      HOME: `${world.root}/home`,
      PATH: Deno.env.get("PATH") ?? "",
      DENO_DIR: Deno.env.get("DENO_DIR") ?? `${world.root}/deno`,
    },
  }).output();
  const text = new TextDecoder().decode(output.stdout).trim();
  assert(
    output.success,
    `probe failed: ${new TextDecoder().decode(output.stderr)}`,
  );
  return JSON.parse(text);
}

const BLOCKED = [
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
];

Deno.test("apps/permissions#R4: 운영 앱은 자기 bundle 읽기와 자기 data 읽기·쓰기만 하고 source·다른 앱 DB·log·credential은 거절된다", async () => {
  const world = await build("live");
  try {
    const result = await probe(world);
    for (
      const name of [
        "read bundle",
        "read data",
        "write data",
        "create data",
        "list data",
      ]
    ) {
      assertEquals(result[name], "ok", name);
    }
    for (const name of BLOCKED) assertEquals(result[name], "denied", name);
    // 거절한 쓰기는 파일에 닿지 않았다.
    assertEquals(
      await Deno.readTextFile(world.paths.otherDb),
      "other",
    );
    assertEquals(
      await Deno.readTextFile(world.paths.credentialFile),
      "credential",
    );
    assertEquals(
      await Deno.readTextFile(world.paths.bundleFile),
      PROBE,
    );
    assertEquals(await Deno.readTextFile(world.paths.dataFile), "changed");
  } finally {
    await Deno.remove(world.root, { recursive: true });
  }
});

Deno.test("apps/permissions#R23: 진단·수리 runner도 같은 경계라 다른 앱과 플랫폼 파일을 요청하면 거절된다", async () => {
  // test mode 자식은 같은 진입점과 같은 flag 계산을 쓴다. 진단 때문에 경계를 넓히지 않는다.
  const world = await build("test");
  try {
    const result = await probe(world);
    for (
      const name of [
        "read other app db",
        "write other app db",
        "read platform db",
        "list platform root",
        "read credential",
        "read source",
        "subprocess",
        "env credential",
      ]
    ) {
      assertEquals(result[name], "denied", name);
    }
    assertEquals(await Deno.readTextFile(world.paths.platformDb), "platform");
  } finally {
    await Deno.remove(world.root, { recursive: true });
  }
});
