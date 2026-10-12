import { sha256Hex } from "@lophn/base";
import {
  type BundledGuide,
  bundledGuideSchema,
  type ContentFile,
} from "@lophn/protocol/projects";
import { GUIDE_MEDIA_TYPE, GUIDE_SOURCES } from "./guides/catalog.ts";
import type { GuideSource } from "./guides/catalog.ts";
import { prepareGuideText, requireLophnVersion } from "./model.ts";

export type GuideBytesLoader = (path: string) => Promise<Uint8Array>;

// 반환 bytes는 호출자가 소유하는 mutable copy다. host의 요청별 검증을 대신하지 않는다.
export type BundledGuideFile = {
  source: GuideSource;
  bytes: Uint8Array;
  text: string;
};

export type ProductGuides = {
  lophnVersion: string;
  guides: BundledGuide[];
  files: BundledGuideFile[];
};

export function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export function guideBytesFromFiles(
  files: Readonly<Record<string, Uint8Array>>,
): GuideBytesLoader {
  const owned = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    owned.set(path, copyBytes(bytes));
  }
  return (path) => {
    const bytes = owned.get(path);
    if (!bytes) {
      return Promise.reject(
        new Error(`bundled guide file is missing: ${path}`),
      );
    }
    return Promise.resolve(copyBytes(bytes));
  };
}

async function contentFile(
  source: GuideSource,
  bytes: Uint8Array,
): Promise<ContentFile> {
  return {
    path: source.path,
    blob_hash: await sha256Hex(bytes),
    bytes: bytes.byteLength,
    media_type: GUIDE_MEDIA_TYPE,
    primary: true,
  };
}

export async function loadProductGuides(
  lophnVersion: string,
  loadBytes: GuideBytesLoader,
): Promise<ProductGuides> {
  const version = requireLophnVersion(lophnVersion);
  const files: BundledGuideFile[] = [];
  const guides: BundledGuide[] = [];
  for (const source of GUIDE_SOURCES) {
    const bytes = copyBytes(await loadBytes(source.path));
    const prepared = prepareGuideText(source, bytes);
    const file = await contentFile(source, bytes);
    const guide = bundledGuideSchema.parse({
      lophn_version: version,
      title: source.title,
      content_hash: file.blob_hash,
      files: [file],
    });
    files.push({ source, bytes, text: prepared.text });
    guides.push(guide);
  }
  return { lophnVersion: version, guides, files };
}
