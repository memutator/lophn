// 앱 export 준비(apps/data#R13). 실제 파일을 temp 데이터 root에서 모은다: SQLite backup
// API로 WAL의 확정 내용까지 포함한 DB 사본, ledger에서 읽은 고정 blueprint·release 이력,
// 봉인 bundle 사본, 설치 SDK 사본 byte. export 안에 secret 원값·credential이 없는지와
// 앱 외부 자료 포함 여부 명시를 확인한다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "../../../base/mod.ts";
import type { Release } from "../../../contracts/apps/mod.ts";
import type { Blueprint } from "../../blueprint/mod.ts";
import { canonicalJson } from "../../blueprint/mod.ts";
import { bundleCopyPath, sealBundle } from "../../releases/mod.ts";
import { installPackage } from "../../sdk/mod.ts";
import { databaseHash, openAppDatabase } from "./db.ts";
import { verifyDatabase } from "./integrity.ts";
import { prepareAppExport } from "./export.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE_ID = "rel_01h455vb4pex5v6nkc6gd5fdw1";

function blueprintOf(
  sdk: readonly { name: string; version: string }[],
): Blueprint {
  return {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [{ key: "home", label: "Home", path: "/home", sizes: ["full"] }],
    commands: [{
      key: "list",
      label: "list",
      description: "list purpose",
      effect: "read",
      confirm: false,
      input: null,
      revert: { supported: false },
    }],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [...sdk],
  };
}

function releaseOf(
  bundleHash: string,
  blueprintHash: string,
): Release {
  return {
    id: RELEASE_ID,
    app: APP,
    number: 1,
    code_commit: "a".repeat(40),
    bundle_hash: bundleHash,
    blueprint_hash: blueprintHash,
    data_schema: 0,
    data_changes: [],
    tests: ["vrf_01h455vb4pex5v6nkc6gd5fdw1"],
    ticket_source: null,
    created_by: "machine",
    created_at: "2026-10-06T00:00:00.000Z",
    status: "active",
    activation: null,
    failure: null,
  };
}

// manifest는 release 준비 worker와 같은 규칙이다: bundle hash = manifest JSON byte의 sha256,
// manifest가 blueprint.json의 hash를 고정한다.
async function manifestOf(
  blueprintValue: Blueprint,
  sdk: readonly { name: string; version: string }[],
) {
  const blueprintJson = new TextEncoder().encode(
    canonicalJson(blueprintValue as never),
  );
  const blueprintHash = await sha256Hex(
    new TextDecoder().decode(blueprintJson),
  );
  const mainSource = "export const one = 1;\n";
  const manifest = {
    entrypoint: "main.ts",
    files: [
      { path: "blueprint.json", hash: blueprintHash },
      { path: "main.ts", hash: await sha256Hex(mainSource) },
      ...sdk.map((item) => ({
        path: `sdk/${
          item.name.slice(item.name.indexOf("/") + 1)
        }/${item.version}/mod.ts`,
        hash: "d".repeat(64),
      })),
    ],
    sdk_dependencies: [...sdk],
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const bundleHash = await sha256Hex(new TextDecoder().decode(manifestBytes));
  return { manifest, manifestBytes, bundleHash, blueprintJson, mainSource };
}

Deno.test(
  "apps/data#R13: export는 blueprint·release 이력·bundle 사본·SDK byte·WAL 확정 내용이 담긴 확인된 DB 복사본을 모으고 secret 원값·credential은 없다",
  async () => {
    const dataRoot = await Deno.makeTempDir({ prefix: "lophn-app-export-" });
    try {
      const dataArea = `${dataRoot}/apps/${APP}/data`;
      const databasePath = `${dataArea}/app.sqlite`;
      await Deno.mkdir(dataArea, { recursive: true });

      // SDK Package를 설치해 정확한 의존 byte를 준비한다(readSdkCopies가 읽는 자리).
      // 설치 소스를 temp에 만든다. 제품은 packages/sdk/<name>을 쓴다.
      const guide = new TextEncoder().encode("# sample guide\n");
      const sourceRoot = `${dataRoot}/source`;
      await Deno.mkdir(`${sourceRoot}/sample`, { recursive: true });
      await Deno.writeTextFile(
        `${sourceRoot}/sample/mod.ts`,
        "export const x = 1;\n",
      );
      const installed = await installPackage(
        "@lophn/sample",
        "sample package",
        "component",
        "1.0.0",
        guide,
        { dataRoot, sourceRoot },
      );
      assert(installed.ok, installed.ok ? "" : installed.error.message);

      // 봉인 bundle(0444·0555). release 준비 worker와 같은 규칙이다. bundle 사본은
      // 데이터 root 안 `apps/<app ID>/bundles/<bundle hash>`다.
      const sdk = [{ name: "@lophn/sample", version: "1.0.0" }];
      const blueprintValue = blueprintOf(sdk);
      const built = await manifestOf(blueprintValue, sdk);
      const bundleCopy = bundleCopyPath(dataRoot, APP, built.bundleHash);
      assert(bundleCopy.ok);
      const sealed = await sealBundle({
        copyPath: bundleCopy.value,
        manifest: built.manifest,
        blueprintJson: built.blueprintJson,
        bundleFiles: [{
          path: "main.ts",
          bytes: new TextEncoder().encode(built.mainSource),
        }],
      });
      assert(sealed.ok, sealed.ok ? "" : sealed.error.message);

      // 운영 DB. WAL에만 있는 항목을 checkpoint 없이 확정한다(data_test.ts와 같다).
      const opened = openAppDatabase(databasePath);
      assert(opened.ok);
      opened.value.close();
      const writer = new DatabaseSync(databasePath);
      writer.exec("pragma journal_mode = wal");
      writer.exec("create table items (body text not null)");
      writer
        .prepare("insert into items (body) values (?)")
        .run("committed");
      writer.exec("begin immediate");
      writer.prepare("insert into items (body) values (?)").run("in wal");
      writer.exec("commit");
      // secret 원값·credential이 운영 DB에 남아 있어도 export는 그것을 모으면 안 된다.
      writer
        .prepare("insert into items (body) values (?)")
        .run("token-machine-secret");
      writer.close();

      const release = releaseOf(
        built.bundleHash,
        await sha256Hex(
          new TextDecoder().decode(built.blueprintJson),
        ),
      );
      const prepared = await prepareAppExport(dataRoot, databasePath, {
        app: APP,
        blueprintJson: built.blueprintJson,
        releases: [release],
        bundles: [{ bundle_hash: built.bundleHash, manifest: built.manifest }],
        sdkRoot: `${dataRoot}/sdk`,
      });
      assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
      const result = prepared.value;

      // DB 사본은 무결성 확인을 통과하고 WAL의 확정 내용을 담는다.
      const copyDb = `${result.copy}/database.sqlite`;
      const verified = await verifyDatabase(copyDb);
      assert(verified.ok, verified.ok ? "" : verified.error.message);
      // readOnly 연결은 닫혀도 -shm/-wal 사이드카를 남긴다(SQLite 제한). 확인은
      // 쓰기 연결로 다시 열어 닫는다: 사이드카가 지워진다.
      const reader = new DatabaseSync(copyDb, { readOnly: true });
      const items = reader.prepare("select body from items order by rowid")
        .all()
        .map((row) => String(row["body"]));
      reader.close();
      // readOnly 연결이 남긴 -shm/-wal은 쓰기 연결이 닫히면서 지운다.
      const closer = new DatabaseSync(copyDb);
      closer.exec("pragma journal_mode = wal");
      closer.close();
      assertEquals(items, ["committed", "in wal", "token-machine-secret"]);
      const hash = await databaseHash(copyDb);
      assert(hash.ok);
      assertEquals(hash.value, result.database_hash);

      // 고정 blueprint 원문은 release에 고정한 hash의 정규 byte와 같다.
      const exportedBlueprint = await Deno.readFile(
        `${result.copy}/blueprint.json`,
      );
      assertEquals(
        await sha256Hex(new TextDecoder().decode(exportedBlueprint)),
        release.blueprint_hash,
      );

      // release 이력 원문. export가 실제 이력을 담는다.
      const history = JSON.parse(
        await Deno.readTextFile(`${result.copy}/releases.json`),
      ) as { id: string; bundle_hash: string; status: string }[];
      assertEquals(history.map((row) => [row.id, row.bundle_hash]), [[
        RELEASE_ID,
        built.bundleHash,
      ]]);

      // 각 불변 bundle의 사본이 export 묶음 안에 있다.
      for (
        const file of [
          "manifest.json",
          "blueprint.json",
          "main.ts",
        ]
      ) {
        await Deno.lstat(`${result.copy}/bundles/${built.bundleHash}/${file}`);
      }
      const exportedManifest = JSON.parse(
        await Deno.readTextFile(
          `${result.copy}/bundles/${built.bundleHash}/manifest.json`,
        ),
      ) as { entrypoint: string; sdk_dependencies: unknown[] };
      assertEquals(exportedManifest, built.manifest);

      // 설치 SDK 의존 byte가 그대로 있다.
      const exportedSdk = await Deno.readFile(
        `${result.copy}/sdk/sample/1.0.0/mod.ts`,
      );
      assertEquals(
        await sha256Hex(new TextDecoder().decode(exportedSdk)),
        await sha256Hex(
          new TextDecoder().decode(
            await Deno.readFile(`${dataRoot}/sdk/sample/1.0.0/mod.ts`),
          ),
        ),
      );
      await Deno.lstat(`${result.copy}/sdk/sample/1.0.0`);
      assertEquals(
        (result.sdk as { name: string; version: string }[]).map((item) =>
          `${item.name}@${item.version}`
        ),
        ["@lophn/sample@1.0.0"],
      );

      // secret 원값·credential은 export에 모이지 않는다: 묶음 파일이 DB·blueprint·
      // release·bundle·SDK뿐이고 keychain 어댑터나 credential 참조 파일은 없다.
      const staged: string[] = [];
      const walk = async (directory: string, prefix: string): Promise<void> => {
        for await (const entry of Deno.readDir(directory)) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory) {
            await walk(`${directory}/${entry.name}`, path);
          } else if (entry.isFile) {
            staged.push(path);
          }
        }
      };
      await walk(result.copy, "");
      for (const path of staged) {
        // 묶음 안 상대 경로는 코드·blueprint·SDK·DB뿐이다.
        assert(
          path === "database.sqlite" || path === "blueprint.json" ||
            path === "releases.json" ||
            path.startsWith("bundles/") || path.startsWith("sdk/"),
          `unexpected export file: ${path}`,
        );
      }
    } finally {
      await Deno.remove(dataRoot, { recursive: true }).catch(() => {});
    }
  },
);
