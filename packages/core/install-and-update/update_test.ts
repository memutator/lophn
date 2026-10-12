import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { readUpdatePackage, updateNotice } from "./mod.ts";

Deno.test("platform/install-and-update#R13: 로컬 fake update source는 Linux deb만 안내하고 읽기 실패나 다른 OS는 추정하지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-update-source-" });
  try {
    const path = `${root}/package.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        version: "0.4.0",
        os: "linux",
        format: "deb",
        schema: 3,
      }),
    );
    const candidate = await readUpdatePackage(path);
    assert(candidate.ok);
    const notice = updateNotice({
      installedVersion: "0.3.0",
      installedSchema: 3,
      os: "linux",
      candidate: candidate.value,
    });
    assert(notice.ok);
    assertEquals(notice.value.schema, "compatible");
    assertEquals(notice.value.new_version, "0.4.0");
    assertStringIncludes(
      notice.value.instructions.join("\n"),
      "자동 다운로드·설치·재시작은 하지 않는다",
    );
    assert(
      !updateNotice({
        installedVersion: "0.3.0",
        installedSchema: 3,
        os: "linux",
        candidate: { ...candidate.value, format: "exe" },
      }).ok,
    );
    assert(
      !updateNotice({
        installedVersion: "0.3.0",
        installedSchema: 3,
        os: "windows",
        candidate: candidate.value,
      }).ok,
    );
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        version: "0.4.0",
        os: "linux",
        format: "deb",
        schema: "unknown",
      }),
    );
    assert(!(await readUpdatePackage(path)).ok);
    assert(!(await readUpdatePackage(`${root}/missing.json`)).ok);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
