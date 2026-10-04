import type { GuideSection, GuideSource } from "./guides/catalog.ts";

export type PreparedGuideText = {
  source: GuideSource;
  text: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function sectionHeading(line: string): string | undefined {
  const match = /^## ([^#].*)$/.exec(line);
  const heading = match?.[1]?.trim();
  return heading || undefined;
}

export function markdownSections(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    const heading = sectionHeading(line);
    return heading ? [heading] : [];
  });
}

export function requireLophnVersion(lophnVersion: string): string {
  if (lophnVersion.trim() === "") {
    throw new Error("lophnVersion is required");
  }
  return lophnVersion;
}

// BOM, 줄바꿈, Unicode 정규화를 하지 않는다. U+FEFF도 원문 그대로 보존한다.
export function decodeGuideUtf8(path: string, bytes: Uint8Array): string {
  try {
    const text = decoder.decode(bytes);
    const encoded = encoder.encode(text);
    if (
      encoded.length !== bytes.length ||
      encoded.some((byte, index) => byte !== bytes[index])
    ) {
      throw new Error("decode changed the bytes");
    }
    return text;
  } catch {
    throw new Error(`bundled guide is not UTF-8: ${path}`);
  }
}

export function prepareGuideText(
  source: GuideSource,
  bytes: Uint8Array,
): PreparedGuideText {
  const text = decodeGuideUtf8(source.path, bytes);
  const found = markdownSections(text);
  const expected = source.sections.map((section) => section.heading);
  if (found.join("\n") !== expected.join("\n")) {
    throw new Error(
      `guide sections do not match ${source.path}: ${found.join(", ")}`,
    );
  }
  if (!text.startsWith(`# ${source.title}\n`)) {
    throw new Error(`guide title does not match ${source.path}`);
  }
  return { source, text };
}

export function guideSections(source: GuideSource): readonly GuideSection[] {
  return source.sections;
}
