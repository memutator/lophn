// 문서 정리의 순수 규칙. 화면 컴포넌트와 테스트가 같이 쓴다.
import type {
  DocumentDetail,
  ExportFile,
  ExportFormat,
  FileStep,
  PlacedDocument,
  ProjectRow,
} from "./source.ts";

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** 프로젝트·문서 이름은 링크에 쓰는 slug다. */
export function validName(name: string): boolean {
  return SLUG.test(name);
}

/** 제목에서 이름 후보를 만든다. 만들 수 없으면 "document"다. */
export function nameFromTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  ).replace(/^[0-9-]+/, "");
  return slug === "" ? "document" : slug;
}

/** 파일로 둘 때 처음 보이는 파일 이름. 이름과 최신 판 파일의 확장자를 쓴다. */
export function defaultFileName(document: DocumentDetail): string {
  const base = document.name ?? nameFromTitle(document.title);
  const file = document.singleFile ?? "";
  const dot = file.lastIndexOf(".");
  const slash = file.lastIndexOf("/");
  return dot > slash + 1 ? `${base}${file.slice(dot)}` : base;
}

/** 폴더와 폴더 안 상대 이름을 이은 절대 경로. */
export function joinPath(folder: string, name: string): string {
  const relative = name.trim().replace(/^\/+/, "");
  return folder.endsWith("/")
    ? `${folder}${relative}`
    : `${folder}/${relative}`;
}

/** 폴더 안 상대 이름이 쓸 수 있는 모양인지. 위로 올라가거나 빈 조각은 받지 않는다. */
export function validFileName(name: string): boolean {
  const parts = name.trim().split("/");
  return name.trim() !== "" &&
    parts.every((part) => part !== "" && part !== "." && part !== "..");
}

/** 문서를 둘 수 있는 프로젝트. 보관되지 않고 추적이 켜졌고 폴더가 있다. */
export function placeableProjects(
  projects: readonly ProjectRow[],
): ProjectRow[] {
  return projects.filter((project) =>
    !project.archived && project.tracking && project.folders.length > 0
  );
}

/** 파일 작업 뒤 연결 단계 중 끝나지 않은 것이 있는지. 건너뜀은 끝난 것이다. */
export function stepsIncomplete(steps: readonly FileStep[]): boolean {
  return steps.some((step) =>
    step.state === "failed" || step.state === "not_attempted"
  );
}

/** export에 고르지 않은 문서. 고른 순서와 상관없이 목록 순서다. */
export function leftOut(
  documents: readonly PlacedDocument[],
  picked: ReadonlySet<string>,
): PlacedDocument[] {
  return documents.filter((document) => !picked.has(document.id));
}

const CONVERTIBLE = new Set(["text/markdown", "text/plain"]);

/**
 * Markdown export에서 바꾸지 못하고 원래 파일 그대로 남는지. Markdown으로 바꿀 수 없는
 * 원문(HTML·PDF·image)은 원래 MIME과 바이트로 둔다. JSON export는 바꾸는 것이 없다.
 */
export function keptOriginal(file: ExportFile, format: ExportFormat): boolean {
  return format === "markdown" &&
    !CONVERTIBLE.has(file.mediaType.split(";")[0]!.trim());
}
