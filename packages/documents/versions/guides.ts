// 설치 묶음의 사용 안내(BundledGuide) manifest reader(documents/versions#R17, R18).
// 안내는 사용자 Document가 아니다: ledger 표·entity ID·place·tracking·Version 번호가
// 없고 이 파일은 ledger에 아무것도 쓰지 않는다. 설치 폴더의 `guides/`에서 고정 manifest
// (lophn_version·title·content_hash·files)와 읽기 전용 파일 bytes를 읽는다.
// 파일 읽기는 port로 받는다: 동기 file API는 core graph 밖(reader Worker)에서만 열린다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type BundledGuide,
  bundledGuideSchema,
  type ContentFile,
  type GuideReference,
} from "../../contracts/documents/mod.ts";
import { z } from "zod";

// 안내 폴더 안의 manifest 상대 경로.
export const GUIDE_MANIFEST_PATH = "manifest.json";

// 설치 안내 폴더의 읽기 전용 port. path는 폴더 기준 상대 경로이고, 폴더 밖이나 없는
// 파일은 err다(adapter가 막는다).
export type GuideFiles = {
  read(path: string): Result<Uint8Array>;
};

const manifestSchema = z.object({
  lophn_version: z.string().refine((value) => value.trim().length > 0),
  guides: z.array(bundledGuideSchema),
});

export type InstalledGuides = {
  lophn_version: string;
  guides: BundledGuide[];
  // 설치된 안내 묶음의 기준. manifest bytes의 sha256이라 설치가 바뀌면 달라진다.
  basis: string;
};

export type GuideFileBytes = {
  file: ContentFile;
  bytes: Uint8Array;
};

export type GuideCatalog = {
  // 설치 manifest. 매 요청 다시 읽는다: 설치 판이 바뀌면 그 요청부터 새 판이다.
  installed(): Result<InstalledGuides>;
  // manifest의 한 안내가 가진 파일. 실제 packaged bytes가 manifest와 다르면 err다.
  file(guide: BundledGuide, path: string): Result<GuideFileBytes>;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

function parseManifest(bytes: Uint8Array): Result<InstalledGuides> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return unavailable("설치 안내 manifest를 읽을 수 없다");
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) return unavailable("설치 안내 manifest가 올바르지 않다");
  const { lophn_version, guides } = parsed.data;
  const seen = new Set<string>();
  for (const guide of guides) {
    const primary = guide.files.find((file) => file.primary);
    // 안내 하나의 content_hash는 대표 파일의 실제 bytes hash다(lophn-agent Q27).
    if (
      guide.lophn_version !== lophn_version || primary === undefined ||
      primary.blob_hash !== guide.content_hash
    ) {
      return unavailable("설치 안내 manifest가 올바르지 않다");
    }
    const key = JSON.stringify([
      guide.lophn_version,
      guide.title,
      guide.content_hash,
    ]);
    if (seen.has(key)) {
      return unavailable("설치 안내 manifest가 올바르지 않다");
    }
    seen.add(key);
  }
  return ok({ lophn_version, guides, basis: sha256(bytes) });
}

export function createGuideCatalog(files: GuideFiles): GuideCatalog {
  return {
    installed() {
      const manifest = files.read(GUIDE_MANIFEST_PATH);
      if (!manifest.ok) return unavailable("설치 안내가 없다");
      return parseManifest(manifest.value);
    },
    file(guide, path) {
      const declared = guide.files.find((file) => file.path === path);
      if (declared === undefined) {
        return err({ code: "not_found", message: "guide file not found" });
      }
      const read = files.read(path);
      if (!read.ok) return unavailable("설치 안내 파일을 읽을 수 없다");
      // 매 요청 실제 packaged bytes를 manifest의 크기·hash와 대조한다.
      if (
        read.value.byteLength !== declared.bytes ||
        sha256(read.value) !== declared.blob_hash
      ) {
        return unavailable("설치 안내 파일이 manifest와 다르다");
      }
      return ok({ file: declared, bytes: read.value });
    },
  };
}

// 고정 참조가 현재 설치 manifest의 안내와 정확히 같을 때만 그 안내다. 다른 설치 판·
// 없는 제목·다른 hash는 모두 같은 undefined다(없는 것과 같다).
export function findInstalledGuide(
  installed: InstalledGuides,
  reference: GuideReference,
): BundledGuide | undefined {
  return installed.guides.find((guide) =>
    guide.lophn_version === reference.lophn_version &&
    guide.title === reference.title &&
    guide.content_hash === reference.content_hash
  );
}
