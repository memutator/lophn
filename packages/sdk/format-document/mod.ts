// 내장 document format의 선언이다. 내용의 정본은 packages/documents/formats의
// 등록이고(apps/core/documents.ts), 여기는 같은 선언을 데이터로 담아 앱이 읽게
// 내보내기만 한다(documents Q10). 검사 코드는 없다 — 검사는 core 밖 격리 환경에서
// 돌는 `/v1/formats/validate`만 한다(documents/formats#R18). Module hash는
// documents#T4의 bundle.js hash와 같다(→ documents/plan Q10).

// FormatRef의 정확한 module hash(bundle.js 묶음의 sha256). documents/formats의
// guest/module-hash.ts가 정본이다.
export const DOCUMENT_MODULE_HASH =
  "8098b95b6b7bf63f8466c8e07c2f2a560fd46ff4160671fd99faa4c82a83ccdd";

// document가 읽기·검색 대상으로 지원하는 media type이다(documents/formats#R2).
export const DOCUMENT_MEDIA_TYPES = [
  "text/markdown",
  "text/x-markdown",
  "text/html",
  "application/xhtml+xml",
  "text/plain",
] as const;

// document format 선언이다. 구성은 이름·media type·구조·metadata 요구·template·
// guide·vocabulary·section 추출 가능 여부뿐이다(apps/sdk#R2, documents/formats#R8).
export const documentFormat = {
  name: "document",
  module_hash: DOCUMENT_MODULE_HASH,
  media_types: [...DOCUMENT_MEDIA_TYPES],
  structure: {
    headings: "markdown-atx-setext and html-h1-h6",
    excluded: [
      "front-matter",
      "fenced-code",
      "html-pre",
      "script",
      "style",
      "template",
      "nav",
      "textarea",
      "head",
      "title",
      "hidden",
    ],
  },
  metadata: {
    title: { type: "string", required: false, series_order: false },
  },
  template: [
    {
      path: "document.md",
      // 빈 template 원문의 sha256이다. blob 대상이다.
      blob_hash:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      bytes: 0,
      media_type: "text/markdown",
      primary: true,
    },
  ],
  guide: {
    text:
      "Markdown ATX·setext heading, or the original HTML and XHTML h1–h6, become sections. Plain text stays searchable without headings. The single h1 is the document title.",
    examples: [
      "# Title\n\nIntro.\n\n## Section\n\nBody.\n",
      "<h1>Title</h1>\n<p>Body.</p>\n",
    ],
  },
  vocabulary: [
    { name: "heading", description: "ATX, setext, or HTML h1–h6" },
    { name: "anchor", description: "explicit {#id} or HTML id" },
    { name: "preamble", description: "body before the first heading" },
  ],
  extracts: true,
} as const;

// document의 FormatRef 값이다. 저장 결과와 같은 모양(documents/versions)이고
// explicit은 저장 결과에 달렸으므로 기본값을 두지 않는다.
export const documentFormatRef = {
  name: documentFormat.name,
  module_hash: documentFormat.module_hash,
} as const;
