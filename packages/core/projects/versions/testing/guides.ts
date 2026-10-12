// 설치 안내 fixture. temp 설치 폴더에 manifest와 안내 파일을 실제로 쓴다. 제품의 설치
// 묶음(platform/install-and-update)이 만드는 `guides/` 모양과 같다: 안내마다 대표
// Markdown 하나, content_hash는 그 파일 raw bytes의 sha256이다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../../base/mod.ts";

export type GuideFixtureGuide = {
  title: string;
  path: string;
  text: string;
  media_type?: string;
};

export const GUIDE_FIXTURE_GUIDES: readonly GuideFixtureGuide[] = [
  {
    title: "Projects",
    path: "roles/lophn/guides/projects.md",
    text: [
      "# Projects",
      "",
      "Projects keep related documents together.",
      "",
      "## Create a project",
      "",
      "Open the launcher and choose New project.",
      "",
      "## Rename a project",
      "",
      "Use the project menu.",
      "",
      "### Rename limits",
      "",
      "Names must be unique.",
      "",
    ].join("\n"),
  },
  {
    title: "Revert",
    path: "roles/lophn/guides/revert.md",
    text: [
      "# Revert",
      "",
      "## Before anything changes",
      "",
      "Lophn asks first.",
      "",
    ].join("\n"),
  },
];

export type GuideInstallFixture = {
  dir: string;
  lophnVersion: string;
  guides: { title: string; content_hash: string; path: string }[];
  files: { read(path: string): Result<Uint8Array> };
  // 설치 update를 흉내 낸다: 같은 폴더에 새 판의 manifest와 파일을 다시 쓴다.
  write(lophnVersion: string, guides: readonly GuideFixtureGuide[]): void;
  cleanup(): void;
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function guideInstallFixture(
  lophnVersion = "1.0.0",
  guides: readonly GuideFixtureGuide[] = GUIDE_FIXTURE_GUIDES,
  // 설치 `guides/` 폴더를 이미 정해 둔 곳에 만든다. 없으면 temp dir다.
  into?: string,
): GuideInstallFixture {
  const dir = into ?? Deno.makeTempDirSync({ prefix: "guides-install-" });
  Deno.mkdirSync(dir, { recursive: true });
  const fixture: GuideInstallFixture = {
    dir,
    lophnVersion,
    guides: [],
    files: {
      read(path) {
        try {
          return ok(Deno.readFileSync(`${dir}/${path}`));
        } catch {
          return err({ code: "unavailable", message: "no such file" });
        }
      },
    },
    write(version, next) {
      const manifest: unknown[] = [];
      fixture.guides = [];
      fixture.lophnVersion = version;
      for (const guide of next) {
        const bytes = new TextEncoder().encode(guide.text);
        const hash = sha256Hex(bytes);
        const at = `${dir}/${guide.path}`;
        Deno.mkdirSync(at.slice(0, at.lastIndexOf("/")), { recursive: true });
        Deno.writeFileSync(at, bytes);
        manifest.push({
          lophn_version: version,
          title: guide.title,
          content_hash: hash,
          files: [{
            path: guide.path,
            blob_hash: hash,
            bytes: bytes.byteLength,
            media_type: guide.media_type ?? "text/markdown",
            primary: true,
          }],
        });
        fixture.guides.push({
          title: guide.title,
          content_hash: hash,
          path: guide.path,
        });
      }
      Deno.writeTextFileSync(
        `${dir}/manifest.json`,
        JSON.stringify({ lophn_version: version, guides: manifest }),
      );
    },
    cleanup() {
      Deno.removeSync(dir, { recursive: true });
    },
  };
  fixture.write(lophnVersion, guides);
  return fixture;
}
