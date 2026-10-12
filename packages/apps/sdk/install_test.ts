import { assert, assertEquals } from "@std/assert";
import { ok, sha256Hex } from "../../base/mod.ts";
import type { PackageRegisterVersionInput } from "../../protocol/apps/mod.ts";
import { installPackage } from "./install.ts";
import { parseLophnSdkSpecifier } from "./model.ts";
// SDK 설치(apps/sdk#R4, R9, R13). 설치가 packages/sdk/<name>을 패키지마다 자기
// 완결 byte로 묶고 hash·guide hash를 blob으로 준비한 뒤 machine으로 register_version을
// 부른다. 설치 사본은 파일 0444·디렉터리 0555다(R9). 외부 이름은 거절이다(R13).

Deno.test("apps/sdk#R13: 외부 Package 등록은 거절이다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-sdk-install-" });
  try {
    const refused = await installPackage(
      "@company/outside",
      "outside package",
      "component",
      "1.0.0",
      new TextEncoder().encode("guide"),
      { dataRoot: home },
    );
    assertEquals(refused.ok, false);
    if (!refused.ok) assertEquals(refused.error.code, "forbidden");
    // 개인 이름도 거절이다.
    const personal = await installPackage(
      "@me/private",
      "private package",
      "capability",
      "1.0.0",
      new TextEncoder().encode("guide"),
      { dataRoot: home },
    );
    assertEquals(personal.ok, false);
    if (!personal.ok) assertEquals(personal.error.code, "forbidden");
    // withheld 이름도 거절이다.
    const withheld = await installPackage(
      "@lophn/cap-read-model",
      "read model",
      "capability",
      "1.0.0",
      new TextEncoder().encode("guide"),
      { dataRoot: home },
    );
    assertEquals(withheld.ok, false);
    if (!withheld.ok) assertEquals(withheld.error.code, "forbidden");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("apps/sdk#R4 #R9: 설치가 완결 byte로 묶고 machine으로 등록하며 사본은 0444·0555다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-sdk-install-" });
  // 설치 소스를 temp에 만든다. 제품은 packages/sdk/<name>을 쓴다.
  const sourceRoot = `${home}/source`;
  await Deno.mkdir(`${sourceRoot}/sample`, { recursive: true });
  await Deno.writeTextFile(
    `${sourceRoot}/sample/mod.ts`,
    "export const x = 1;\n",
  );
  await Deno.mkdir(`${sourceRoot}/sample/lib`, { recursive: true });
  await Deno.writeTextFile(
    `${sourceRoot}/sample/lib/util.ts`,
    "export const y = 2;\n",
  );
  try {
    const submitted: PackageRegisterVersionInput[] = [];
    const installed = await installPackage(
      "@lophn/sample",
      "sample package",
      "component",
      "1.0.0",
      new TextEncoder().encode("guide for 1.0.0"),
      {
        dataRoot: home,
        sourceRoot,
        prepareBlob: async (input) => {
          // 받은 byte의 실제 hash를 준비 참조로 남긴다(blob 준비).
          const reader = input.bytes.getReader();
          const chunks: Uint8Array[] = [];
          for (;;) {
            const read = await reader.read();
            if (read.done) break;
            chunks.push(read.value);
          }
          const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const all = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            all.set(chunk, offset);
            offset += chunk.length;
          }
          return ok({
            hash: await sha256Hex(all),
            size_bytes: size,
          });
        },
        registerVersion: (input) => {
          submitted.push(input);
          return Promise.resolve(ok({ accepted: true }));
        },
      },
    );
    assert(installed.ok, installed.ok ? "" : installed.error.message);
    assertEquals(installed.value.name, "@lophn/sample");
    assertEquals(installed.value.version, "1.0.0");
    // machine 제출 입력이 hash·guide hash를 담는다.
    assertEquals(submitted.length, 1);
    assertEquals(submitted[0].name, "@lophn/sample");
    assertEquals(submitted[0].kind, "component");
    assertEquals(submitted[0].version, "1.0.0");
    assertEquals(submitted[0].bundle_hash, installed.value.bundle_hash);
    assertEquals(submitted[0].guide_hash, installed.value.guide_hash);
    // 완결 byte는 파일 두 개를 담는다.
    assertEquals(installed.value.files.length, 2);
    // 설치 사본이 sdk/<name>/<version>에 있다.
    const copy = `${home}/sdk/sample/1.0.0`;
    const stat = await Deno.stat(copy);
    assert(stat.isDirectory);
    const modStat = await Deno.stat(`${copy}/mod.ts`);
    assert(modStat.isFile);
    // 파일 0444·디렉터리 0555(R9).
    assertEquals(
      (modStat.mode ?? 0) & 0o777,
      0o444,
      `mod.ts mode ${modStat.mode?.toString(8)}`,
    );
    const dirStat = await Deno.stat(`${copy}/lib`);
    assertEquals(
      (dirStat.mode ?? 0) & 0o777,
      0o555,
      `lib mode ${dirStat.mode?.toString(8)}`,
    );
    const rootStat = await Deno.stat(copy);
    assertEquals(
      (rootStat.mode ?? 0) & 0o777,
      0o555,
      `root mode ${rootStat.mode?.toString(8)}`,
    );
  } finally {
    // 사본은 0555라 그대로는 못 지운다. 권한을 복구한 뒤 지운다.
    await restorePermissions(home);
    await Deno.remove(home, { recursive: true });
  }
});

// 임시 home 아래 디렉터리를 0755로 돌려놓는다(정리용).
async function restorePermissions(root: string): Promise<void> {
  const directories: string[] = [root];
  for (let index = 0; index < directories.length; index += 1) {
    const current = directories[index];
    await Deno.chmod(current, 0o755);
    try {
      for await (const entry of Deno.readDir(current)) {
        if (entry.isDirectory) {
          directories.push(`${current}/${entry.name}`);
        }
      }
    } catch {
      // 읽을 수 없는 항목은 무시한다.
    }
  }
}

Deno.test("apps/sdk#R7: lophn-sdk specifier는 정확한 version만 받는다", () => {
  assertEquals(parseLophnSdkSpecifier("lophn-sdk:@lophn/blueprint@1.0.0"), {
    name: "@lophn/blueprint",
    version: "1.0.0",
  });
  assertEquals(
    parseLophnSdkSpecifier("lophn-sdk:@lophn/blueprint@^1.0.0"),
    undefined,
  );
  assertEquals(
    parseLophnSdkSpecifier("lophn-sdk:@lophn/blueprint@~1.0.0"),
    undefined,
  );
  assertEquals(
    parseLophnSdkSpecifier("lophn-sdk:@lophn/blueprint@latest"),
    undefined,
  );
  assertEquals(parseLophnSdkSpecifier("npm:@lophn/blueprint@1.0.0"), undefined);
});
