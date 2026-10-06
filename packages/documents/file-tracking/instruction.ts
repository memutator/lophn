// 지침 파일(LOPHN.md)의 exact 등록과 그 파일 관측의 순수 규칙(file-tracking#R19, R20).
// 일반 Project tracking과 별개다: 폴더를 재귀로 돌지 않고, 부모 폴더를 거슬러 올라가지 않고,
// cwd를 추측하지 않는다. 등록은 documents가 data root와 활성 Project 폴더에서 스스로 정한다
// (lophn-agent/instructions는 층 이름만 갖는다). 전역은 `<data root>/LOPHN.md` 한 파일, project는
// 그 Project의 첫 등록 폴더 바로 아래 `LOPHN.md` 한 파일이다. app 층은 앱 자리의 경로를
// documents가 알 수 없어 등록 목록에 들어오지 않는다. AGENTS.md는 coding agent의 별개 파일이다.
import { err, ok, type Result } from "../../base/mod.ts";

export const INSTRUCTION_FILE_NAME = "LOPHN.md";
export const GLOBAL_INSTRUCTION_TARGET = "global";

export function projectInstructionTarget(project: string): string {
  return `project:${project}`;
}

// 전역 등록의 판. 등록 규칙이 바뀌지 않는 한 값이 같다(project는 project 판을 따른다).
export const GLOBAL_INSTRUCTION_REVISION = "1";

// 이미 이 파일에 연결된 문서. 없으면 사람의 첫 저장이나 첫 관측이 만든다(파일이 없으면 판도 없다).
export type InstructionLinkBasis = {
  document: string;
  document_revision: string;
  status: "active" | "archived";
  latest_version: string;
  // 최신 판의 원본 hash. 파일 관측이 아닌 판이면 null.
  latest_hash: string | null;
  title: string;
};

// 관측할 지침 파일 하나. path는 정규화된 exact 절대 경로다.
export type ObservationInstructionBasis = {
  instruction_target: string;
  project: string | null;
  project_revision: string | null;
  instruction_revision: string;
  path: string;
  link: InstructionLinkBasis | null;
};

export type InstructionRegistration = Omit<
  ObservationInstructionBasis,
  "link"
>;

export type InstructionProject = {
  id: string;
  revision: string;
  status: "active" | "archived";
  folders: readonly { path: string }[];
};

function join(directory: string, name: string): string {
  return `${directory === "/" ? "" : directory}/${name}`;
}

// 등록 목록. 입력은 data root와 project 목록뿐이고 파일 시스템은 보지 않는다.
export function instructionRegistrations(
  dataRoot: string,
  projects: readonly InstructionProject[],
): InstructionRegistration[] {
  const registrations: InstructionRegistration[] = [{
    instruction_target: GLOBAL_INSTRUCTION_TARGET,
    project: null,
    project_revision: null,
    instruction_revision: GLOBAL_INSTRUCTION_REVISION,
    path: join(dataRoot, INSTRUCTION_FILE_NAME),
  }];
  for (const project of projects) {
    const folder = project.folders[0];
    if (project.status !== "active" || folder === undefined) continue;
    registrations.push({
      instruction_target: projectInstructionTarget(project.id),
      project: project.id,
      project_revision: project.revision,
      instruction_revision: project.revision,
      path: join(folder.path, INSTRUCTION_FILE_NAME),
    });
  }
  return registrations;
}

function invalid(): Result<never> {
  return err({
    code: "invalid_input",
    message: "instruction basis is invalid",
  });
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function linkOf(value: unknown): InstructionLinkBasis | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (
    !text(value.document) || !text(value.document_revision) ||
    !text(value.latest_version) || !text(value.title) ||
    (value.status !== "active" && value.status !== "archived") ||
    (value.latest_hash !== null && !text(value.latest_hash))
  ) return undefined;
  return {
    document: value.document,
    document_revision: value.document_revision,
    status: value.status,
    latest_version: value.latest_version,
    latest_hash: value.latest_hash,
    title: value.title,
  };
}

export function parseInstructionBasis(
  value: unknown,
): Result<ObservationInstructionBasis[]> {
  if (!Array.isArray(value)) return invalid();
  const parsed: ObservationInstructionBasis[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return invalid();
    const link = linkOf(entry.link);
    const project = entry.project;
    const revision = entry.project_revision;
    if (
      link === undefined || !text(entry.instruction_target) ||
      !text(entry.instruction_revision) || !text(entry.path) ||
      !entry.path.startsWith("/") ||
      (project !== null && !text(project)) ||
      (revision !== null && !text(revision)) ||
      (project === null) !== (revision === null)
    ) return invalid();
    parsed.push({
      instruction_target: entry.instruction_target,
      project,
      project_revision: revision,
      instruction_revision: entry.instruction_revision,
      path: entry.path,
      link,
    });
  }
  return ok(parsed);
}

// 지침 파일 안의 바이트는 UTF-8 Markdown이어야 한다. 아니면 판을 만들지 않고 상태로만 남긴다.
export function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

// 일반 root 관측이 지침 파일을 두 번째 문서로 만들지 않도록 등록 경로인지 본다.
export function isInstructionPath(
  instructions: readonly { path: string }[],
  path: string,
): boolean {
  return instructions.some((entry) => entry.path === path);
}
