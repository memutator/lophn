// core가 documents coordinator에 넘기는 관측 근거(documents plan Q15). coordinator는
// machine으로 tracking 규칙과 경로→문서 연결을 읽지 않는다. core가 소유자로 ledger
// snapshot에서 읽어 이미 있는 core→coordinator 요청 envelope로 보내고, 규칙이나 연결이
// 바뀌면 같은 통로로 다시 보낸다. 새 HTTP route나 credential 정책은 없다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { TrackingPattern } from "../../../protocol/projects/mod.ts";
import {
  type ObservationInstructionBasis,
  parseInstructionBasis,
} from "./instruction.ts";

// 관측할 root 하나와 그 root에 적용되는 규칙.
export type ObservationRootBasis = {
  // 등록 폴더의 절대 경로.
  root: string;
  project: string;
  project_revision: string;
  patterns: TrackingPattern[];
  use_gitignore: boolean;
};

// 사람이 파일을 쓸 수 있는 폴더 하나. 활성 project의 등록 폴더 전부이고 tracking을 껐어도
// 들어간다. 관측할 root(`ObservationRootBasis`)와 따로 둔다: 권한 집합과 관측 집합이 다르다.
export type ObservationFolderBasis = {
  project: string;
  // 등록 폴더의 절대 경로.
  path: string;
};

// 파일 경로에 연결된 문서. `documents.source_path`가 근원이다.
export type ObservationLinkBasis = {
  project: string;
  // 연결된 파일의 절대 경로(canonical).
  path: string;
  document: string;
  document_revision: string;
  status: "active" | "archived";
  latest_version: string;
  // 최신 판의 파일 source가 가진 original_hash. 파일 관측이 아닌 판이면 null.
  latest_hash: string | null;
  title: string;
};

export type ObservationBasisPayload = {
  // 관측할 root(활성이고 tracking을 켠 project의 폴더).
  roots: ObservationRootBasis[];
  // 활성 project의 모든 등록 폴더. 파일 쓰기의 root 권한 집합이다.
  folders: ObservationFolderBasis[];
  links: ObservationLinkBasis[];
  // 정확히 등록된 지침 파일. 일반 root 규칙과 따로 있고 tracking을 껐어도 들어간다.
  // 없으면 빈 목록이다.
  instructions?: ObservationInstructionBasis[];
};

function invalid(): Result<never> {
  return err({
    code: "invalid_input",
    message: "observation basis is invalid",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function patternOf(value: unknown): TrackingPattern | undefined {
  if (!isRecord(value)) return undefined;
  const { effect, glob } = value;
  if ((effect !== "include" && effect !== "exclude") || !text(glob)) {
    return undefined;
  }
  return { effect, glob };
}

function rootOf(entry: unknown): ObservationRootBasis | undefined {
  if (!isRecord(entry) || !Array.isArray(entry.patterns)) return undefined;
  if (
    !text(entry.root) || !text(entry.project) ||
    !text(entry.project_revision) || typeof entry.use_gitignore !== "boolean"
  ) return undefined;
  const patterns: TrackingPattern[] = [];
  for (const raw of entry.patterns) {
    const pattern = patternOf(raw);
    if (pattern === undefined) return undefined;
    patterns.push(pattern);
  }
  return {
    root: entry.root,
    project: entry.project,
    project_revision: entry.project_revision,
    patterns,
    use_gitignore: entry.use_gitignore,
  };
}

function folderOf(entry: unknown): ObservationFolderBasis | undefined {
  if (!isRecord(entry) || !text(entry.project) || !text(entry.path)) {
    return undefined;
  }
  return { project: entry.project, path: entry.path };
}

function foldersOf(value: unknown): ObservationFolderBasis[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const folders: ObservationFolderBasis[] = [];
  for (const entry of value) {
    const folder = folderOf(entry);
    if (folder === undefined) return undefined;
    folders.push(folder);
  }
  return folders;
}

function linkOf(entry: unknown): ObservationLinkBasis | undefined {
  if (!isRecord(entry)) return undefined;
  if (
    !text(entry.project) || !text(entry.path) || !text(entry.document) ||
    !text(entry.document_revision) || !text(entry.latest_version) ||
    !text(entry.title) ||
    (entry.status !== "active" && entry.status !== "archived") ||
    (entry.latest_hash !== null && !text(entry.latest_hash))
  ) return undefined;
  return {
    project: entry.project,
    path: entry.path,
    document: entry.document,
    document_revision: entry.document_revision,
    status: entry.status,
    latest_version: entry.latest_version,
    latest_hash: entry.latest_hash,
    title: entry.title,
  };
}

// core가 읽은 근거 전체(roots와 links)의 모양을 한 번 검사한다. 일부만 받지 않는다.
export function parseObservationBasis(
  value: unknown,
): Result<ObservationBasisPayload> {
  if (!isRecord(value)) return invalid();
  if (!Array.isArray(value.roots) || !Array.isArray(value.links)) {
    return invalid();
  }
  const folders = foldersOf(value.folders);
  if (folders === undefined) return invalid();
  const roots: ObservationRootBasis[] = [];
  for (const entry of value.roots) {
    const root = rootOf(entry);
    if (root === undefined) return invalid();
    roots.push(root);
  }
  const links: ObservationLinkBasis[] = [];
  for (const entry of value.links) {
    const link = linkOf(entry);
    if (link === undefined) return invalid();
    links.push(link);
  }
  const instructions = value.instructions === undefined
    ? ok<ObservationInstructionBasis[]>([])
    : parseInstructionBasis(value.instructions);
  if (!instructions.ok) return instructions;
  return ok({ roots, folders, links, instructions: instructions.value });
}

// 한 번에 보내는 조각. 감독 pipe의 제어 frame은 256 KiB가 상한이라 근거 전체를 한
// 요청에 싣지 않는다. 같은 push의 조각은 순서대로 오고, 마지막 조각(more=false)에서 한꺼번에
// 반영된다. 중간에 끊기면 반영되지 않는다.
export type ObservationBasisChunk = {
  // true면 새 push의 시작이다. 쌓아 둔 옛 조각은 버린다.
  begin: boolean;
  // true면 이 push는 지금까지의 연결을 모두 대체한다. false면 upsert·remove만 바뀐다.
  full: boolean;
  // begin 조각에서만 온다(그 push의 root 전부). 그 밖의 조각은 null이다.
  roots: ObservationRootBasis[] | null;
  // begin 조각에서만 온다(그 push의 쓰기 폴더 전부). roots와 같이 null이거나 아니다.
  folders: ObservationFolderBasis[] | null;
  // begin 조각에서만 온다(그 push의 지침 파일 등록 전부). 없으면 빈 목록이다.
  instructions?: ObservationInstructionBasis[] | null;
  upsert: ObservationLinkBasis[];
  // 연결이 없어진 경로.
  remove: string[];
  // true면 같은 push의 다음 조각이 이어진다.
  more: boolean;
};

export function parseObservationChunk(
  value: unknown,
): Result<ObservationBasisChunk> {
  if (!isRecord(value)) return invalid();
  if (
    typeof value.begin !== "boolean" || typeof value.full !== "boolean" ||
    typeof value.more !== "boolean" || !Array.isArray(value.upsert) ||
    !Array.isArray(value.remove)
  ) return invalid();
  let roots: ObservationRootBasis[] | null = null;
  if (value.roots !== null) {
    if (!Array.isArray(value.roots)) return invalid();
    roots = [];
    for (const entry of value.roots) {
      const root = rootOf(entry);
      if (root === undefined) return invalid();
      roots.push(root);
    }
  }
  if ((roots === null) === value.begin) return invalid();
  let folders: ObservationFolderBasis[] | null = null;
  if (value.folders !== null) {
    const parsed = foldersOf(value.folders);
    if (parsed === undefined) return invalid();
    folders = parsed;
  }
  if ((folders === null) === value.begin) return invalid();
  let instructions: ObservationInstructionBasis[] | null = null;
  if (value.instructions !== undefined && value.instructions !== null) {
    const parsed = parseInstructionBasis(value.instructions);
    if (!parsed.ok) return parsed;
    instructions = parsed.value;
  }
  if (instructions !== null && !value.begin) return invalid();
  if (value.begin) instructions ??= [];
  const upsert: ObservationLinkBasis[] = [];
  for (const entry of value.upsert) {
    const link = linkOf(entry);
    if (link === undefined) return invalid();
    upsert.push(link);
  }
  const remove: string[] = [];
  for (const path of value.remove) {
    if (!text(path)) return invalid();
    remove.push(path);
  }
  if (value.full && remove.length > 0) return invalid();
  return ok({
    begin: value.begin,
    full: value.full,
    roots,
    folders,
    instructions,
    upsert,
    remove,
    more: value.more,
  });
}

// chunk 하나의 JSON 상한. 제어 frame 상한(256 KiB)보다 넉넉히 작다.
export const OBSERVATION_CHUNK_BYTES = 128 * 1024;

const encoder = new TextEncoder();

function sameLink(left: ObservationLinkBasis, right: ObservationLinkBasis) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// 이전에 보낸 근거(prev)와 지금 읽은 근거(next)의 차이를 상한 안의 조각으로 나눈다.
// prev가 없으면 전체 대체(full)다. 바뀐 것이 없으면 root가 같을 때 빈 배열이다.
export function chunkObservationBasis(
  prev: ObservationBasisPayload | undefined,
  next: ObservationBasisPayload,
  limitBytes: number = OBSERVATION_CHUNK_BYTES,
): ObservationBasisChunk[] {
  const full = prev === undefined;
  const before = new Map(prev?.links.map((link) => [link.path, link]));
  const upsert: ObservationLinkBasis[] = [];
  for (const link of next.links) {
    const old = before.get(link.path);
    if (old === undefined || !sameLink(old, link)) upsert.push(link);
  }
  const present = new Set(next.links.map((link) => link.path));
  const remove = full
    ? []
    : [...before.keys()].filter((path) => !present.has(path));
  const rootsChanged = prev === undefined ||
    JSON.stringify(prev.roots) !== JSON.stringify(next.roots) ||
    JSON.stringify(prev.folders) !== JSON.stringify(next.folders) ||
    JSON.stringify(prev.instructions ?? []) !==
      JSON.stringify(next.instructions ?? []);
  if (!rootsChanged && upsert.length === 0 && remove.length === 0) return [];
  const chunks: ObservationBasisChunk[] = [];
  let current: ObservationBasisChunk = {
    begin: true,
    full,
    roots: next.roots,
    folders: next.folders,
    instructions: next.instructions ?? [],
    upsert: [],
    remove: [],
    more: false,
  };
  let bytes = encoder.encode(
    JSON.stringify([next.roots, next.folders, next.instructions ?? []]),
  ).length;
  const flush = () => {
    current.more = true;
    chunks.push(current);
    current = {
      begin: false,
      full,
      roots: null,
      folders: null,
      instructions: null,
      upsert: [],
      remove: [],
      more: false,
    };
    bytes = 0;
  };
  for (const link of upsert) {
    const size = encoder.encode(JSON.stringify(link)).length;
    if (bytes + size > limitBytes && bytes > 0) flush();
    current.upsert.push(link);
    bytes += size;
  }
  for (const path of remove) {
    const size = encoder.encode(JSON.stringify(path)).length;
    if (bytes + size > limitBytes && bytes > 0) flush();
    current.remove.push(path);
    bytes += size;
  }
  chunks.push(current);
  return chunks;
}

// root 관측 loop를 다시 시작해야 하는 변화의 key. 같으면 loop를 그대로 둔다.
// 규칙·project 판·root가 바뀌면 전체 대조가 필요하다. 보관된 연결이
// 풀리는 것(보관 해제)도 현재 파일을 다시 관측해야 하므로 key에 들어간다.
export function rootSignature(
  root: ObservationRootBasis,
  archivedPaths: readonly string[],
): string {
  return JSON.stringify([
    root.root,
    root.project,
    root.project_revision,
    root.patterns.map((pattern) => [pattern.effect, pattern.glob]),
    root.use_gitignore,
    [...archivedPaths].sort(),
  ]);
}
