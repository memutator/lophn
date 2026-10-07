// flow backup-and-restore의 앱 export 단계(apps/data#R13, docs/flows/backup-and-restore.md 4).
// 제품 core(apps/core/main.ts)를 workers seam 없이 임시 LOPHN_HOME으로 띄우고(Electron은
// 띄우지 않는다), main이 받는 hello의 user token으로 loopback HTTP `POST /v1/apps/export`를 부른다.
// 앱과 release 행은 core route 시험과 같은 fixture로 ledger 쪽에 심는다. export가 ready로
// 답한 뒤 디스크의 묶음을 본다: 확인된 DB 사본(WAL에만 있던 확정 행 포함), 고정 blueprint의
// hash, release 이력, bundle 사본, SDK byte, secret 값이 없음, 앱 밖 자료를 담지 않음.
// 사람 데이터 root(~/.lophn)는 열지 않는다. 띄운 core 프로세스만 정확히 멈춘다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import { sha256Hex } from "../../packages/base/mod.ts";
import { mainHelloSchema } from "../../packages/contracts/platform/mod.ts";
import { readFrames } from "../../packages/platform/responsiveness/mod.ts";
import { bundleCopyPath } from "../../packages/apps/releases/mod.ts";
import { removeTree } from "../../packages/apps/sdk/testing/mod.ts";
import {
  APP,
  RELEASE_ID,
  seedBundleAndSdk,
  seedDatabase,
  seedLedger,
} from "../../apps/core/testing/app-export-fixtures.ts";

const SECRET_VALUE = "flow-secret-value-0a9b8c7d";

async function firstHello(
  stdout: ReadableStream<Uint8Array>,
): Promise<{ user_token: string; api_port: number }> {
  const reader = stdout.getReader();
  let pending: Uint8Array | undefined;
  const read = async (buffer: Uint8Array): Promise<number | null> => {
    while (!pending || pending.length === 0) {
      const next = await reader.read();
      if (next.done) return null;
      pending = next.value;
    }
    const take = Math.min(buffer.length, pending.length);
    buffer.set(pending.subarray(0, take));
    pending = pending.subarray(take);
    return take;
  };
  for await (const frame of readFrames({ read })) {
    if (frame.kind !== "json") continue;
    const parsed = mainHelloSchema.safeParse(frame.payload);
    if (parsed.success) return parsed.data;
  }
  throw new Error("hello frame이 없다");
}

// 디렉터리 안 모든 파일의 상대 경로와 byte.
async function filesUnder(
  directory: string,
  prefix = "",
): Promise<Map<string, Uint8Array>> {
  const found = new Map<string, Uint8Array>();
  for await (const entry of Deno.readDir(directory)) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      for (
        const [inner, bytes] of await filesUnder(
          `${directory}/${entry.name}`,
          path,
        )
      ) found.set(inner, bytes);
    } else if (entry.isFile) {
      found.set(path, await Deno.readFile(`${directory}/${entry.name}`));
    }
  }
  return found;
}

function containsBytes(haystack: Uint8Array, needle: string): boolean {
  return new TextDecoder("latin1").decode(haystack).includes(needle);
}

Deno.test({
  name:
    "apps/data#R13 flow backup-and-restore: 제품 core의 앱 export는 ready로 답하고 묶음이 디스크에 확인된 DB 사본·blueprint·release 이력·bundle·SDK byte로 서며 secret 값은 없다",
  ignore: Deno.env.get("LOPHN_E2E") !== "1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-export-" });
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        new URL("../../apps/core/main.ts", import.meta.url).pathname,
        "--port=0",
      ],
      env: { LOPHN_HOME: home },
      cwd: new URL("../..", import.meta.url).pathname,
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    let live: DatabaseSync | undefined;
    try {
      const hello = await firstHello(child.stdout);

      // 앱·release 행은 ledger 쪽에 심는다. 앱 감독이 앱을 띄우지 않게 run을 끈다.
      const fixtures = await seedBundleAndSdk(home);
      const dataArea = `${home}/apps/${APP}/data`;
      await Deno.mkdir(dataArea, { recursive: true });
      // 앱 DB 연결을 열어 둔다: 그 동안 확정 행이 WAL에만 있다.
      live = seedDatabase(`${dataArea}/app.sqlite`);
      assert(
        (await Deno.stat(`${dataArea}/app.sqlite-wal`)).size > 0,
        "WAL에 확정 행이 있어야 한다",
      );
      seedLedger(home, fixtures.blueprintJson, fixtures.bundleHash, 0);
      // secret 값은 앱 폴더 밖에만 있다. export가 모으지 않아야 한다.
      await Deno.writeTextFile(`${home}/secret-sentinel.txt`, SECRET_VALUE);

      const response = await fetch(
        `http://127.0.0.1:${hello.api_port}/v1/apps/export`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${hello.user_token}`,
          },
          body: JSON.stringify({ app: APP }),
        },
      );
      const body = await response.json() as Record<string, unknown>;
      assertEquals(response.status, 200, JSON.stringify(body));
      assertEquals(body.app, APP);
      assertEquals(body.state, "ready");
      assertEquals(body.includes_external_data, false);

      // 묶음은 앱 데이터 영역의 exports 아래 하나다.
      const exportsDir = `${dataArea}/exports`;
      const names: string[] = [];
      for await (const entry of Deno.readDir(exportsDir)) {
        names.push(entry.name);
      }
      assertEquals(names.length, 1);
      const copy = `${exportsDir}/${names[0]}`;
      const files = await filesUnder(copy);

      // DB 사본: 무결성 확인을 통과하고 WAL에만 있던 확정 행을 담는다.
      const database = new DatabaseSync(`${copy}/database.sqlite`, {
        readOnly: true,
      });
      try {
        assertEquals(
          database.prepare("pragma integrity_check").get()?.integrity_check,
          "ok",
        );
        assertEquals(
          database.prepare("select body from items order by rowid").all().map((
            row,
          ) => String(row["body"])),
          ["committed", "in wal"],
        );
      } finally {
        database.close();
      }

      // 고정 blueprint의 hash는 release에 고정한 hash다. release 이력이 그 release를 담는다.
      const blueprint = files.get("blueprint.json");
      assert(blueprint !== undefined, "blueprint.json이 없다");
      const history = JSON.parse(
        new TextDecoder().decode(files.get("releases.json")),
      ) as { id: string; bundle_hash: string; blueprint_hash: string }[];
      assertEquals(history.map((row) => [row.id, row.bundle_hash]), [[
        RELEASE_ID,
        fixtures.bundleHash,
      ]]);
      assertEquals(
        await sha256Hex(new TextDecoder().decode(blueprint)),
        history[0].blueprint_hash,
      );

      // bundle 사본은 봉인된 원본 사본과 byte가 같다.
      const sealed = bundleCopyPath(home, APP, fixtures.bundleHash);
      assert(sealed.ok);
      const original = await filesUnder(sealed.value);
      assert(original.size > 0);
      for (const [path, bytes] of original) {
        const exported = files.get(`bundles/${fixtures.bundleHash}/${path}`);
        assert(exported !== undefined, `bundle 파일이 없다: ${path}`);
        assertEquals(exported, bytes);
      }

      // SDK 사본은 설치된 byte 그대로다.
      const installed = await filesUnder(`${home}/sdk`);
      const exportedSdk = [...files].filter(([path]) =>
        path.startsWith("sdk/")
      );
      assert(exportedSdk.length > 0, "SDK 사본이 없다");
      for (const [path, bytes] of exportedSdk) {
        assertEquals(installed.get(path.slice("sdk/".length)), bytes);
      }

      // 묶음에는 DB·blueprint·release·bundle·SDK뿐이고 secret 값·credential이 없다.
      for (const [path, bytes] of files) {
        assert(
          path === "database.sqlite" || path === "blueprint.json" ||
            path === "releases.json" || path.startsWith("bundles/") ||
            path.startsWith("sdk/"),
          `unexpected export file: ${path}`,
        );
        assert(
          !containsBytes(bytes, SECRET_VALUE),
          `secret 값이 있다: ${path}`,
        );
        assert(
          !containsBytes(bytes, hello.user_token),
          `token이 있다: ${path}`,
        );
      }
    } finally {
      live?.close();
      try {
        child.kill("SIGTERM");
      } catch { /* 이미 끝남 */ }
      await child.status;
      // bundle·SDK 사본은 봉인돼 있다. 풀고 지운다.
      await removeTree(home);
    }
  },
});
