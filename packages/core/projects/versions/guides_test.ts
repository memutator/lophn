// documents/versions#R17, R18: 설치 안내 manifest reader. 설치 폴더는 temp dir에 실제로
// 쓴 manifest와 파일이고, ledger는 열지 않는다(안내는 사용자 Document가 아니다).
import { assert, assertEquals } from "@std/assert";
import { createGuideCatalog, findInstalledGuide } from "./guides.ts";
import { guideInstallFixture } from "./testing/mod.ts";

function installed(fixture: ReturnType<typeof guideInstallFixture>) {
  const catalog = createGuideCatalog(fixture.files);
  const read = catalog.installed();
  assert(read.ok, read.ok ? "" : read.error.message);
  return { catalog, ...read.value };
}

Deno.test("documents/versions#R17: manifest는 lophn_version·title·content_hash와 상대 경로 파일 목록을 offline으로 읽는다", () => {
  const fixture = guideInstallFixture("1.4.2");
  try {
    const { lophn_version, guides } = installed(fixture);
    assertEquals(lophn_version, "1.4.2");
    assertEquals(guides.map((guide) => guide.title), ["Projects", "Revert"]);
    for (const [index, guide] of guides.entries()) {
      assertEquals(guide.lophn_version, "1.4.2");
      assertEquals(guide.content_hash, fixture.guides[index].content_hash);
      assertEquals(guide.files.length, 1);
      assert(guide.files[0].primary);
      assertEquals(guide.files[0].path, fixture.guides[index].path);
      // 대표 파일 bytes의 hash가 content_hash다.
      assertEquals(guide.files[0].blob_hash, guide.content_hash);
    }
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/versions#R17: 안내 파일은 매 요청 실제 bytes를 manifest의 크기·hash와 대조한다", () => {
  const fixture = guideInstallFixture();
  try {
    const { catalog, guides } = installed(fixture);
    const guide = guides[0];
    const path = guide.files[0].path;
    const read = catalog.file(guide, path);
    assert(read.ok);
    assertEquals(
      new TextDecoder().decode(read.value.bytes).split("\n")[0],
      "# Projects",
    );
    // 설치 파일이 바뀌면 manifest 판으로 읽지 않는다.
    Deno.writeTextFileSync(`${fixture.dir}/${path}`, "# Projects\n\nchanged\n");
    const changed = catalog.file(guide, path);
    assert(!changed.ok);
    assertEquals(changed.error.code, "unavailable");
    // 같은 크기로 바뀌어도 hash가 잡는다.
    Deno.writeTextFileSync(
      `${fixture.dir}/${path}`,
      "x".repeat(guide.files[0].bytes),
    );
    const same = catalog.file(guide, path);
    assert(!same.ok);
    assertEquals(same.error.code, "unavailable");
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/versions#R17: manifest 밖 경로와 다른 설치 판 참조는 없는 것과 같다", () => {
  const fixture = guideInstallFixture("2.0.0");
  try {
    const { catalog, guides, ...rest } = installed(fixture);
    const missing = catalog.file(guides[0], "roles/lophn/guides/revert.md");
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
    const reference = {
      lophn_version: "2.0.0",
      title: guides[0].title,
      content_hash: guides[0].content_hash,
    };
    assertEquals(findInstalledGuide({ guides, ...rest }, reference), guides[0]);
    for (
      const other of [
        { ...reference, lophn_version: "1.0.0" },
        { ...reference, title: "Other" },
        { ...reference, content_hash: "0".repeat(64) },
      ]
    ) {
      assertEquals(findInstalledGuide({ guides, ...rest }, other), undefined);
    }
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/versions#R17: 설치 안내가 없거나 manifest가 어긋나면 빈 목록으로 꾸미지 않고 unavailable이다", () => {
  const fixture = guideInstallFixture();
  try {
    const catalog = createGuideCatalog(fixture.files);
    const manifest = `${fixture.dir}/manifest.json`;
    const good = Deno.readTextFileSync(manifest);
    const broken: string[] = [
      "not json",
      JSON.stringify({ lophn_version: "1.0.0" }),
      // 최상위 version과 다른 안내
      good.replace(
        '"lophn_version":"1.0.0","title"',
        '"lophn_version":"9","title"',
      ),
      // content_hash가 대표 파일 hash와 다르다
      good.replace(
        /"content_hash":"[0-9a-f]{64}"/,
        `"content_hash":"${"a".repeat(64)}"`,
      ),
    ];
    for (const text of broken) {
      Deno.writeTextFileSync(manifest, text);
      const result = catalog.installed();
      assert(!result.ok, text);
      assertEquals(result.error.code, "unavailable");
    }
    // 중복 안내(version·title·hash 같음)
    const parsed = JSON.parse(good);
    parsed.guides.push(parsed.guides[0]);
    Deno.writeTextFileSync(manifest, JSON.stringify(parsed));
    assert(!catalog.installed().ok);
    Deno.removeSync(manifest);
    const none = catalog.installed();
    assert(!none.ok);
    assertEquals(none.error.code, "unavailable");
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/versions#R18: 설치 update는 새 판의 manifest만 바꾸고 옛 판 참조를 새 판으로 대신하지 않는다", () => {
  const fixture = guideInstallFixture("1.0.0");
  try {
    const before = installed(fixture);
    const old = {
      lophn_version: "1.0.0",
      title: before.guides[0].title,
      content_hash: before.guides[0].content_hash,
    };
    fixture.write("1.1.0", [{
      title: "Projects",
      path: "roles/lophn/guides/projects.md",
      text: "# Projects\n\nA newer text.\n",
    }]);
    const after = installed(fixture);
    assertEquals(after.lophn_version, "1.1.0");
    assert(after.basis !== before.basis);
    assertEquals(findInstalledGuide(after, old), undefined);
  } finally {
    fixture.cleanup();
  }
});
