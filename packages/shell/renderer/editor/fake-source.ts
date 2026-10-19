// 파일 통로의 메모리 fake. gallery와 개발 시드(`desktop/dev-seed.ts`)가 쓴다. 파일은 경로 문자열
// 하나가 키이고, 읽을 때 준 hash가 쓸 때의 base_hash다. 밖에서 바뀐 파일은 `change`로 흉내 낸다.
import type { FileChanged, FileReply } from "../../ipc/files.ts";
import type { EditorFiles } from "./source.ts";

// 내용이 같으면 같고 다르면 거의 다른 64자 hex. 암호용이 아니다.
function hashOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    a = Math.imul(a ^ text.charCodeAt(index), 0x01000193);
    b = Math.imul(b + text.charCodeAt(index), 0x85ebca6b) ^ (b >>> 13);
  }
  const part = (seed: number) =>
    (Math.imul(a ^ seed, 0x9e3779b1) >>> 0).toString(16).padStart(8, "0") +
    (Math.imul(b ^ seed, 0x85ebca6b) >>> 0).toString(16).padStart(8, "0");
  return [1, 2, 3, 4].map(part).join("");
}

const ok = <T>(value: T): FileReply<T> => ({ ok: true, value });
const fail = (code: "not_found" | "conflict" | "unsupported") =>
  ({ ok: false, code }) as const;

const encoder = new TextEncoder();
// fake 파일의 수정 시각(2026-10-16 09:00 UTC).
const FAKE_MODIFIED_AT = Date.UTC(2026, 9, 16, 9);

// 이미지 viewer와 pdf viewer가 보이는 stand-in. 모양은 chest 배치도와 한 쪽짜리 보고서다.
export const FAKE_IMAGE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="640" height="360">
<rect width="320" height="180" fill="#eef1f4"/>
<rect x="40" y="40" width="60" height="40" fill="#b9d3ee"/>
<rect x="120" y="100" width="40" height="40" fill="#f6d77a"/>
<rect x="200" y="60" width="80" height="60" fill="#9fc7a6"/>
<circle cx="70" cy="130" r="12" fill="#5f8f6a"/>
<text x="44" y="64" font-size="10" fill="#33414d">door</text>
<text x="124" y="124" font-size="10" fill="#33414d">chest</text>
<text x="204" y="94" font-size="10" fill="#33414d">storage</text>
</svg>`;

export const FAKE_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 52>>stream
BT /F1 18 Tf 24 150 Td (Weekly report 12) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`;

/** 이 경로의 fake 바이트 파일(이미지·pdf). */
function bytesOf(path: string): { bytes: Uint8Array; type: string } | null {
  if (/\.pdf$/i.test(path)) {
    return { bytes: encoder.encode(FAKE_PDF), type: "application/pdf" };
  }
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) {
    return { bytes: encoder.encode(FAKE_IMAGE_SVG), type: "image/svg+xml" };
  }
  return null;
}

/** 파일 크기(byte)와 바뀐 시각. info panel이 보인다. */
export function factsOf(path: string, text?: string): {
  size: number;
  modifiedAt: number;
} {
  const size = text !== undefined
    ? encoder.encode(text).byteLength
    : bytesOf(path)?.bytes.byteLength ?? 1900;
  return { size, modifiedAt: Date.now() - 2 * 60 * 60 * 1000 };
}

const EXPERIMENT_LINES: readonly string[] = [
  "# exp-008 · Query tools",
  "",
  "Experiment on the query tools for read-only tasks.",
  "",
  "## 질문",
  "",
  "Do the query tools stop the agent from trying world actions on read-only tasks, without hurting the answers?",
  "",
  "## 기준선",
  "",
  "The C-049 baseline run, scored with the query-hygiene rubric r2.",
  "",
  "## 성공 기준",
  "",
  "Each scenario is scored from 0 to 1.",
  "",
  "Success: world_actions stays at 0 on every read-only scenario.",
  "",
  "## 찾은 것",
  "",
  "Every finding links back to this experiment.",
  "",
  "- F-009",
  "",
  "F-009 moved world_actions from 3 to 0 on query-leave-still.",
];

const INSTRUCTIONS_LINES: readonly string[] = [
  "# LOPHN",
  "",
  "## Conventions",
  "",
  "Scenarios live in eval/scenarios. Every experiment links its findings. Keep reports in reports/.",
  "",
  "## Do not touch",
  "",
  "Never edit a rubric while an experiment that uses it is running.",
];

const TEXT: Record<string, string> = {
  "eval/rubrics/query-hygiene.json": `{
  "id": "query-hygiene",
  "version": "r2",
  "description": "No world actions on read-only tasks",
  "metrics": [
    { "name": "world_actions", "target": 0, "weight": 0.5 },
    { "name": "tool_calls", "target": 3, "weight": 0.2 },
    { "name": "answer_match", "target": 0.9, "weight": 0.3 }
  ],
  "pass": { "min_score": 0.8 }
}
`,
  "eval/scenarios/query-leave-still/r1.yaml": `id: query-leave-still
version: r1
tags: [query, read-only]
stages:
  - ask: "What is in the chest by the door?"
  - answer: read-only, no world actions
  - score:
      rubric: query-hygiene
      expect: world_actions == 0
timeout_s: 120
`,
  "/home/mina/Downloads/api-spec.yaml": `openapi: 3.0.3
info:
  title: Chest service
  version: 1.4.0
paths:
  /chests/{name}:
    get:
      summary: Read a chest by name
      parameters:
        - name: name
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: The chest contents
`,
};

/** 이 경로의 fake 글. 없으면 undefined다(없는 파일). */
export function fakeTextOf(path: string): string | undefined {
  if (TEXT[path] !== undefined) return TEXT[path];
  if (/^eval\/experiments\/exp-\d+/.test(path)) {
    return EXPERIMENT_LINES.join("\n");
  }
  if (/^loop\/findings\/F-\d+\.md$/.test(path)) {
    const id = /F-\d+/.exec(path)![0];
    return `# ${id} · Finding\n\n## 무엇을 봤나\n\nOn query-leave-still the change moved world_actions.\n`;
  }
  if (path === "LOPHN.md") return INSTRUCTIONS_LINES.join("\n");
  if (/\.md$/i.test(path)) {
    const title = (path.split("/").pop() ?? path).replace(/\.md$/i, "")
      .replace(/-/g, " ");
    return `# ${title}\n\nPlain notes.\n`;
  }
  const scenario = /^eval\/scenarios\/([^/]+)\/r1\.yaml$/.exec(path);
  if (scenario) {
    return TEXT["eval/scenarios/query-leave-still/r1.yaml"]!.replace(
      "query-leave-still",
      scenario[1]!,
    );
  }
  return undefined;
}

interface FakeEditorFiles extends EditorFiles {
  /** 밖(다른 편집기, git)이 이 파일을 바꾼다. 알림도 간다. */
  change(path: string, text: string): void;
  /** 지금 디스크 글. */
  text(path: string): string | undefined;
}

/**
 * 메모리 파일 통로. `initial`에 없는 경로는 `fakeTextOf`와 fake 바이트로 채운다. 쓰기는 main처럼
 * base_hash가 지금 hash와 다르면 conflict다.
 */
export function fakeEditorFiles(
  initial: Readonly<Record<string, string>> = {},
): FakeEditorFiles {
  const files = new Map<string, string>(Object.entries(initial));
  const listeners = new Set<(change: FileChanged) => void>();
  const textAt = (path: string) => files.get(path) ?? fakeTextOf(path);
  return {
    read({ path }) {
      const text = textAt(path);
      return Promise.resolve(
        text === undefined
          ? fail(bytesOf(path) ? "unsupported" : "not_found")
          : ok({ text, hash: hashOf(text), modified_at: FAKE_MODIFIED_AT }),
      );
    },
    readBytes({ path }) {
      const found = bytesOf(path);
      return Promise.resolve(
        found === null ? fail("not_found") : ok({
          bytes: found.bytes,
          content_type: found.type,
          modified_at: FAKE_MODIFIED_AT,
        }),
      );
    },
    write({ path, base_hash, text }) {
      const current = textAt(path);
      const hash = current === undefined ? null : hashOf(current);
      if (base_hash !== hash) return Promise.resolve(fail("conflict"));
      files.set(path, text);
      return Promise.resolve(ok({ hash: hashOf(text) }));
    },
    delete({ path }) {
      files.delete(path);
      return Promise.resolve(ok({}));
    },
    watch: () => Promise.resolve(ok({})),
    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    counts: () => {},
    onCloseRequest: () => () => {},
    answerClose: () => {},
    change(path, text) {
      files.set(path, text);
      for (const listener of listeners) {
        listener({ path, hash: hashOf(text) });
      }
    },
    text: textAt,
  };
}
