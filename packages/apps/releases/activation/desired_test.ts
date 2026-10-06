// 봉인 bundle 사본에서 운영 DesiredApp과 preview bundle을 같은 함수로 만드는 것(apps/releases#R4, apps#T19가
// 넘긴 사본 모양)을 본다. 사본은 temp 폴더에 봉인하고 앱 자식은 그 flag로 뜬다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../base/mod.ts";
import { canonicalJson } from "../../blueprint/mod.ts";
import { manifestBytes } from "../bundle/manifest.ts";
import { bundleCopyPath, sealBundle } from "../bundle/seal.ts";
import { blueprint, command as declared } from "../testing/mod.ts";
import {
  createCopyPreviewBundles,
  dataSchemaOf,
  desiredFromBundle,
  readBundleCopy,
} from "./desired.ts";

const encoder = new TextEncoder();
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER = "app_01h455vb4pex5v6nkc6gd5fdw2";

type Sealed = { dataRoot: string; hash: string; root: string };

// 앱 코드·잠근 import map·SDK 사본·migration 단계 파일을 담은 사본이다.
async function seal(): Promise<Sealed> {
  const dataRoot = await Deno.makeTempDir({ prefix: "lop-copy-" });
  const files = new Map<string, string>([
    [
      "main.ts",
      `import { hello } from "@lophn/probe";
       const root = new URL("./", import.meta.url);
       const own = await Deno.readTextFile(new URL("./blueprint.json", root));
       let outside = "read";
       try { await Deno.readTextFile(${
        JSON.stringify(`${dataRoot}/escape.txt`)
      }); }
       catch { outside = "denied"; }
       console.log(JSON.stringify({ hello: hello(), own: own.length > 0, outside }));`,
    ],
    ["sdk/probe/1.0.0/mod.ts", `export const hello = () => "sdk";`],
    [
      "import-map.json",
      JSON.stringify({
        imports: { "@lophn/probe": "./sdk/probe/1.0.0/mod.ts" },
      }),
    ],
    ["deno.lock", "{}"],
    ["migrations/0-1.sql", "create table items(id integer primary key);"],
    ["migrations/1-2.sql", "alter table items add column name text;"],
    ["screens/home.js", "export default 1;"],
  ]);
  await Deno.writeTextFile(`${dataRoot}/escape.txt`, "secret");
  const blueprintJson = canonicalJson(
    blueprint({
      commands: [declared("list"), declared("save", "write")],
      screens: [
        { key: "home", label: "Home", path: "/home", sizes: ["full", "card"] },
      ],
      sdk_dependencies: [{ name: "@lophn/probe", version: "1.0.0" }],
    }) as never,
  );
  const manifestFiles: { path: string; hash: string }[] = [];
  for (const [path, text] of files) {
    manifestFiles.push({ path, hash: await sha256Hex(text) });
  }
  manifestFiles.push({
    path: "blueprint.json",
    hash: await sha256Hex(blueprintJson),
  });
  const manifest = {
    entrypoint: "main.ts",
    files: manifestFiles,
    sdk_dependencies: [{ name: "@lophn/probe", version: "1.0.0" }],
  };
  const hash = await sha256Hex(manifestBytes(manifest));
  const copy = bundleCopyPath(dataRoot, APP, hash);
  assert(copy.ok);
  const sealed = await sealBundle({
    copyPath: copy.value,
    manifest,
    blueprintJson: encoder.encode(blueprintJson),
    bundleFiles: [...files].map(([path, text]) => ({
      path,
      bytes: encoder.encode(text),
    })),
  });
  assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
  return { dataRoot, hash, root: copy.value };
}

async function remove(path: string): Promise<void> {
  // 봉인 사본은 읽기 전용이라 먼저 쓰기를 열어야 지울 수 있다.
  const command = new Deno.Command("chmod", { args: ["-R", "u+w", path] });
  await command.output();
  await Deno.remove(path, { recursive: true }).catch(() => undefined);
}

Deno.test("apps/releases#R4: 사본의 manifest·blueprint·import map에서 entry·command·화면·data schema를 읽고 다른 앱·다른 hash는 없는 것과 같다", async () => {
  const sealed = await seal();
  try {
    const read = await readBundleCopy(sealed.dataRoot, APP, sealed.hash);
    assert(read.ok && read.value !== undefined);
    const parts = read.value;
    assertEquals(parts.entry, `${sealed.root}/main.ts`);
    assertEquals(parts.importMap, `${sealed.root}/import-map.json`);
    assertEquals(parts.commands, ["list", "save"]);
    assertEquals(parts.screens, { home: ["full", "card"] });
    // migration 단계 파일의 가장 큰 도착 schema다.
    assertEquals(parts.dataSchema, 2);
    assertEquals(dataSchemaOf({ ...parts.manifest, files: [] }), 0);
    // 다른 앱의 이름이나 없는 hash는 같은 답이다.
    const other = await readBundleCopy(sealed.dataRoot, OTHER, sealed.hash);
    const absent = await readBundleCopy(sealed.dataRoot, APP, "9".repeat(64));
    assertEquals(other, { ok: true, value: undefined });
    assertEquals(absent, other);
    // 운영 DesiredApp은 사본의 값과 ledger가 정한 값을 합친다.
    const desired = desiredFromBundle(parts, {
      app: APP,
      release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
      bundleHash: sealed.hash,
      runEnabled: true,
      archived: false,
      dataSchema: 2,
      dataPath: `${sealed.dataRoot}/apps/${APP}/data`,
      flags: { args: [], limits: [] },
    });
    assertEquals(desired.entry, parts.entry);
    assertEquals(desired.importMap, parts.importMap);
    assertEquals(desired.commands, ["list", "save"]);
  } finally {
    await remove(sealed.dataRoot);
  }
});

Deno.test("apps/releases#R4: 한 byte가 바뀐 사본은 그 hash의 bundle로 열리지 않는다", async () => {
  const sealed = await seal();
  try {
    await Deno.chmod(sealed.root, 0o755);
    await Deno.chmod(`${sealed.root}/manifest.json`, 0o644);
    await Deno.writeTextFile(
      `${sealed.root}/manifest.json`,
      `${await Deno.readTextFile(`${sealed.root}/manifest.json`)} `,
    );
    const read = await readBundleCopy(sealed.dataRoot, APP, sealed.hash);
    assert(!read.ok);
    assertEquals(read.error.code, "unavailable");
  } finally {
    await remove(sealed.dataRoot);
  }
});

Deno.test("apps/releases#R4, apps/preview#R1: preview bundle이 사본에서 열리고 fixture는 manifest 파일의 byte이며 자식은 import map의 SDK 사본을 읽고 사본 root만 읽는다", async () => {
  const sealed = await seal();
  try {
    const bundles = createCopyPreviewBundles({
      dataRoot: sealed.dataRoot,
      platformPorts: () => [],
    });
    const opened = await bundles.open(APP, sealed.hash);
    assert(opened.ok && opened.value !== undefined);
    const bundle = opened.value;
    assertEquals(bundle.commands, ["list", "save"]);
    assertEquals(bundle.dataSchema, 2);
    assertEquals(
      await bundle.fixture(await sha256Hex("export default 1;")),
      encoder.encode("export default 1;"),
    );
    assertEquals(await bundle.fixture("0".repeat(64)), undefined);
    assertEquals(await bundles.open(OTHER, sealed.hash), {
      ok: true,
      value: undefined,
    });

    // 자식은 사본 root의 읽기 허락과 사본의 import map으로 뜬다. 사본 밖 읽기는 막힌다.
    const dataPath = `${sealed.dataRoot}/apps/${APP}/preview/n1`;
    await Deno.mkdir(dataPath, { recursive: true });
    const flags = bundle.flags(dataPath);
    assert(flags.ok);
    assert(
      flags.value.args.some((arg) =>
        arg.startsWith("--allow-read=") && arg.includes(sealed.root)
      ),
    );
    const ran = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        ...flags.value.args,
        `--import-map=${bundle.importMap}`,
        bundle.entry,
      ],
      clearEnv: true,
      env: { DENO_DIR: Deno.env.get("DENO_DIR") ?? "" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(ran.stdout);
    assert(ran.success, new TextDecoder().decode(ran.stderr));
    assertEquals(JSON.parse(text), {
      hello: "sdk",
      own: true,
      outside: "denied",
    });
  } finally {
    await remove(sealed.dataRoot);
  }
});
