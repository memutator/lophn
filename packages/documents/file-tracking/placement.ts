// 문서를 파일로 두기와 빼기의 순서(documents/file-tracking#R13, R14, documents/projects#R12).
// 디스크 쓰기와 ledger 변경은 한 transaction이 아니다. 그래서 파일 쪽 사실을 먼저 확정하고,
// 이어지는 연결 확정(추적 규칙, 자리, 원본 연결)은 각각 그 순간의 현재 기준(CAS)으로 따로 한다.
// 연결 확정이 실패해도 이미 끝난 파일 작업을 되돌리지 않고 결과에 단계별로 남긴다.
// 이 모듈은 파일 시스템과 ledger를 port로만 만진다: 파일은 files.ts의 알고리즘(no-replace 설치,
// base_hash 대조)을, ledger 변경은 사람 자격으로 부르는 command를 받는다. 삭제의 사람 확인
// (confirmation handle 소비)은 이 함수를 부르는 host가 base_hash에 묶어 먼저 끝낸다.
import { err, type ErrorCode, ok, type Result } from "../../base/mod.ts";
import type {
  ContentFile,
  Document,
  FileSource,
  Folder,
  PlaceRef,
  Project,
  Slug,
  TrackingPreview,
  TrackingRuleSet,
} from "../../contracts/documents/mod.ts";
import { parseActor } from "../../contracts/platform/mod.ts";
import {
  decideTracking,
  deepestRegisteredRoot,
  type GitignoreRule,
  hardExclusion,
  includeExactFile,
} from "../projects/mod.ts";
import { resolveTarget } from "./file-ops.ts";
import {
  deleteFile,
  type FileDeps,
  type FileDone,
  writeFile,
} from "./files.ts";
import type { ScanPort } from "./work.ts";

export type PlacementLatest = {
  version: string;
  files: readonly ContentFile[];
};

// 현재 ledger 값과 저장 바이트를 읽는 port. 값은 호출 때마다 지금 상태여야 한다
// (각 단계가 자기 시점의 revision으로 확정하기 때문이다).
export type PlacementLedger = {
  document(id: string): Promise<Result<Document | null>>;
  project(id: string): Promise<Result<Project | null>>;
  latest(document: string): Promise<Result<PlacementLatest | null>>;
  // 그 경로에 이미 연결된 문서의 id. 없으면 null이다.
  linked(path: string): Promise<Result<string | null>>;
  // 판 파일의 저장 바이트. 쓰는 쪽이 실제 바이트의 hash를 blob_hash와 대조한다.
  content(file: ContentFile): AsyncIterable<Uint8Array>;
  // 새 자리에서 쓸 수 있는 문서 이름. 예약된 이름은 건너뛴다(addressing#R2).
  placeName(place: PlaceRef, document: Document): Promise<Result<Slug>>;
  // 경로의 각 상위 디렉터리에 걸리는 .gitignore 규칙(root 쪽부터).
  gitignore(
    root: string,
    relativePath: string,
  ): Promise<Result<readonly GitignoreRule[]>>;
  // 바꿀 규칙의 미리보기. 적용이 받을 수 있게 complete인 마지막 page를 돌려준다.
  previewTracking(request: {
    project: string;
    baseRevision: string;
    folders: readonly Folder[];
    tracking: TrackingRuleSet;
  }): Promise<Result<TrackingPreview>>;
};

type Compare = { base_revision: string };

// 사람 자격으로 부르는 command. 각 호출은 그 단계가 막 읽은 revision을 compare로 싣는다.
export type PlacementCommands = {
  setTracking(
    input: {
      project: string;
      folders: readonly Folder[];
      tracking: TrackingRuleSet;
      preview: TrackingPreview;
    },
    compare: Compare,
  ): Promise<Result<Project>>;
  move(
    input: { document: string; place: PlaceRef | null; name: Slug | null },
    compare: Compare,
  ): Promise<Result<Document>>;
  setSource(
    input: { document: string; file_source: FileSource | null },
    compare: Compare,
  ): Promise<Result<Document>>;
  // 성공한 파일 작업 하나의 기록(`file.record_result`). 실패해도 파일 결과는 그대로다.
  recordFile(entry: {
    operation: "write" | "delete";
    requestKey: string;
    project: string;
    path: string;
    done: FileDone;
  }): Promise<Result<void>>;
};

export type PlacementDeps = {
  files: FileDeps;
  ledger: PlacementLedger;
  commands: PlacementCommands;
};

export type StepOutcome =
  | { state: "done" }
  | { state: "skipped"; reason: string }
  | { state: "failed"; error: { code: ErrorCode; message: string } }
  | { state: "not_attempted" };

export type PlaceRequest = {
  // 요청 주체. 사람만 원본 파일 통로와 연결 확정을 쓴다.
  actor: string;
  requestKey: string;
  document: string;
  project: string;
  // 새로 만들 파일의 등록 폴더 안 절대 경로.
  path: string;
};

export type PlaceResult = {
  // 파일 쪽 사실. outcome이 written이 아니면(unverified) 연결 단계는 시도하지 않았다.
  file: FileDone;
  path: string;
  recording: "recorded" | "unverified";
  tracking: StepOutcome;
  move: StepOutcome;
  source: StepOutcome;
};

const NOT_ATTEMPTED: StepOutcome = { state: "not_attempted" };

function fault(code: ErrorCode, message: string): Result<never> {
  return err({ code, message });
}

function userOnly(actor: string): Result<void> {
  return parseActor(actor)?.kind === "user"
    ? ok(undefined)
    : fault("forbidden", "file placement is user only");
}

function failedStep(error: { code: ErrorCode; message: string }): StepOutcome {
  return {
    state: "failed",
    error: { code: error.code, message: error.message },
  };
}

// root 기준 상대 경로. 등록 폴더 안이 아니면 null이다(범위 밖은 없는 것과 같은 거절이다).
function insideFolder(
  project: Project,
  path: string,
): { root: string; relative: string } | null {
  const root = deepestRegisteredRoot(
    path,
    project.folders.map((folder) => ({
      project: project.id,
      path: folder.path,
    })),
  );
  if (!root.ok || root.value === null) return null;
  const prefix = root.value.path === "/" ? "/" : `${root.value.path}/`;
  if (!path.startsWith(prefix)) return null;
  const relative = path.slice(prefix.length);
  if (relative === "" || hardExclusion(relative) !== null) return null;
  return { root: root.value.path, relative };
}

async function tracked(
  ledger: PlacementLedger,
  root: string,
  relative: string,
  tracking: TrackingRuleSet,
): Promise<Result<boolean>> {
  const rules = tracking.use_gitignore
    ? await ledger.gitignore(root, relative)
    : ok<readonly GitignoreRule[]>([]);
  if (!rules.ok) return rules;
  const decision = decideTracking({
    relativePath: relative,
    patterns: tracking.patterns,
    useGitignore: tracking.use_gitignore,
    gitignore: rules.value,
    escapesRoot: false,
    enabled: true,
  });
  return decision.ok ? ok(decision.value.included) : decision;
}

// 두기 전에 읽기만으로 거절할 수 있는 것을 모두 거른다. 하나라도 걸리면 파일을 만들지 않는다.
type Plan = {
  document: Document;
  file: ContentFile;
  root: string;
  relative: string;
  addInclude: boolean;
};

async function planPlacement(
  deps: PlacementDeps,
  request: PlaceRequest,
): Promise<Result<Plan>> {
  const { ledger } = deps;
  const allowed = userOnly(request.actor);
  if (!allowed.ok) return allowed;
  const document = await ledger.document(request.document);
  if (!document.ok) return document;
  if (document.value === null) return fault("not_found", "document not found");
  if (document.value.status !== "active") {
    return fault("conflict", "document is archived");
  }
  if (document.value.file_source !== null) {
    return fault("conflict", "document is already linked to a file");
  }
  const project = await ledger.project(request.project);
  if (!project.ok) return project;
  if (project.value === null) return fault("not_found", "project not found");
  if (project.value.status !== "active") {
    return fault("conflict", "project is archived");
  }
  // 추적이 꺼진 프로젝트에는 두지 않는다. 규칙을 켜는 일은 사람의 별도 적용이다.
  if (!project.value.tracking.enabled) {
    return fault("conflict", "tracking is off for the project");
  }
  const latest = await ledger.latest(request.document);
  if (!latest.ok) return latest;
  if (latest.value === null) return fault("not_found", "document not found");
  if (latest.value.files.length === 0) {
    return fault("unavailable", "the latest version has no readable file");
  }
  // 파일 하나에는 대표 파일 하나만 쓴다. 첨부가 있는 판을 파일 하나로 두지 않는다.
  if (latest.value.files.length > 1) {
    return fault("invalid_input", "document has more than one file");
  }
  const target = insideFolder(project.value, request.path);
  if (target === null) {
    return fault("invalid_input", "target is not available");
  }
  const resolved = await resolveTarget(
    deps.files.ops,
    target.root,
    request.path,
  );
  if (!resolved.ok) return resolved;
  if (resolved.value.stat !== undefined) {
    return fault("conflict", "target already exists");
  }
  const linked = await ledger.linked(request.path);
  if (!linked.ok) return linked;
  if (linked.value !== null) {
    return fault("conflict", "file is already linked to a document");
  }
  const already = await tracked(
    ledger,
    target.root,
    target.relative,
    project.value.tracking,
  );
  if (!already.ok) return already;
  if (!already.value) {
    // 규칙 끝에 그 파일 하나의 include를 더해도 추적되지 않으면(.gitignore) 두지 않는다.
    const next = includeExactFile(project.value.tracking, target.relative);
    if (!next.ok) return next;
    const after = await tracked(
      ledger,
      target.root,
      target.relative,
      next.value,
    );
    if (!after.ok) return after;
    if (!after.value) return fault("conflict", "file cannot be tracked");
  }
  return ok({
    document: document.value,
    file: latest.value.files[0]!,
    root: target.root,
    relative: target.relative,
    addInclude: !already.value,
  });
}

export async function placeDocumentFile(
  deps: PlacementDeps,
  request: PlaceRequest,
): Promise<Result<PlaceResult>> {
  const plan = await planPlacement(deps, request);
  if (!plan.ok) return plan;
  const { ledger, commands } = deps;
  // 최신 고정 판의 바이트를 no-replace로 쓴다. 확인과 생성 사이에 생긴 파일은 덮지 않는다.
  const written = await writeFile(deps.files, {
    root: plan.value.root,
    path: request.path,
    baseHash: null,
    content: ledger.content(plan.value.file),
    contentHash: plan.value.file.blob_hash,
  });
  if (!written.ok) return written;
  const done = written.value;
  const result: PlaceResult = {
    file: done,
    path: request.path,
    recording: "unverified",
    tracking: NOT_ATTEMPTED,
    move: NOT_ATTEMPTED,
    source: NOT_ATTEMPTED,
  };
  // 결과 불명(unverified)은 파일이 있는지 모르는 상태라 연결하지 않고 그대로 알린다.
  if (done.outcome !== "written") return ok(result);
  const recorded = await commands.recordFile({
    operation: "write",
    requestKey: request.requestKey,
    project: request.project,
    path: request.path,
    done,
  });
  if (recorded.ok) result.recording = "recorded";

  // 연결 확정은 순서대로, 각각 지금 읽은 기준으로 한다. 앞 단계가 실패하면 멈춘다.
  result.tracking = await trackStep(deps, request, plan.value);
  if (result.tracking.state === "failed") return ok(result);
  result.move = await moveStep(deps, request);
  if (result.move.state === "failed") return ok(result);
  result.source = await sourceStep(deps, request);
  return ok(result);
}

async function trackStep(
  deps: PlacementDeps,
  request: PlaceRequest,
  plan: Plan,
): Promise<StepOutcome> {
  const { ledger, commands } = deps;
  // 파일을 쓰는 사이 규칙이 바뀌었을 수 있다. 지금 규칙으로 다시 판정한다.
  const fresh = await ledger.project(request.project);
  if (!fresh.ok) return failedStep(fresh.error);
  if (fresh.value === null) {
    return failedStep({ code: "not_found", message: "project not found" });
  }
  const project = fresh.value;
  const already = await tracked(
    ledger,
    plan.root,
    plan.relative,
    project.tracking,
  );
  if (!already.ok) return failedStep(already.error);
  if (already.value) {
    return { state: "skipped", reason: "the file is already tracked" };
  }
  const next = includeExactFile(project.tracking, plan.relative);
  if (!next.ok) return failedStep(next.error);
  const preview = await ledger.previewTracking({
    project: project.id,
    baseRevision: project.revision,
    folders: project.folders,
    tracking: next.value,
  });
  if (!preview.ok) return failedStep(preview.error);
  if (!preview.value.complete) {
    return failedStep({
      code: "unavailable",
      message: "tracking preview is not complete",
    });
  }
  const applied = await commands.setTracking({
    project: project.id,
    folders: project.folders,
    tracking: next.value,
    preview: preview.value,
  }, { base_revision: project.revision });
  return applied.ok ? { state: "done" } : failedStep(applied.error);
}

async function moveStep(
  deps: PlacementDeps,
  request: PlaceRequest,
): Promise<StepOutcome> {
  const { ledger, commands } = deps;
  const fresh = await ledger.document(request.document);
  if (!fresh.ok) return failedStep(fresh.error);
  if (fresh.value === null) {
    return failedStep({ code: "not_found", message: "document not found" });
  }
  // 이미 자리가 있는 문서는 그 자리를 그대로 둔다. 파일을 두는 일이 자리를 옮기지 않는다.
  if (fresh.value.place !== null) {
    return { state: "skipped", reason: "the document already has a place" };
  }
  const place: PlaceRef = { kind: "project", id: request.project };
  const name = await ledger.placeName(place, fresh.value);
  if (!name.ok) return failedStep(name.error);
  const moved = await commands.move(
    { document: request.document, place, name: name.value },
    { base_revision: fresh.value.revision },
  );
  return moved.ok ? { state: "done" } : failedStep(moved.error);
}

async function sourceStep(
  deps: PlacementDeps,
  request: PlaceRequest,
): Promise<StepOutcome> {
  const { ledger, commands } = deps;
  const fresh = await ledger.document(request.document);
  if (!fresh.ok) return failedStep(fresh.error);
  if (fresh.value === null) {
    return failedStep({ code: "not_found", message: "document not found" });
  }
  const linked = await commands.setSource({
    document: request.document,
    file_source: {
      kind: "project_file",
      project: request.project,
      path: request.path,
    },
  }, { base_revision: fresh.value.revision });
  return linked.ok ? { state: "done" } : failedStep(linked.error);
}

export type RemoveRequest = {
  actor: string;
  requestKey: string;
  document: string;
  // 사람이 확인한 디스크 내용의 hash. 최신 판의 원문과 같아야 지운다.
  baseHash: string;
};

export type RemoveResult = {
  // 지운 파일의 사실. 이미 없던 파일이면 null이다.
  file: FileDone | null;
  recording: "recorded" | "unverified" | "not_requested";
  source: StepOutcome;
  move: StepOutcome;
};

// 파일로 둔 문서를 자리 없음으로 되돌리며 파일을 지운다. 디스크 내용이 최신 판의 원문과 같을
// 때만 지우고(다르면 conflict로 파일을 남기고 아무것도 바꾸지 않는다), 지운 뒤에 연결 해제와
// 자리 되돌리기를 각각 현재 기준으로 확정한다.
export async function removeDocumentFile(
  deps: PlacementDeps,
  request: RemoveRequest,
): Promise<Result<RemoveResult>> {
  const { ledger, commands } = deps;
  const allowed = userOnly(request.actor);
  if (!allowed.ok) return allowed;
  const document = await ledger.document(request.document);
  if (!document.ok) return document;
  if (document.value === null) return fault("not_found", "document not found");
  const source = document.value.file_source;
  if (source === null || source.kind !== "project_file") {
    return fault("conflict", "document is not placed as a file");
  }
  const latest = await ledger.latest(request.document);
  if (!latest.ok) return latest;
  if (latest.value === null) return fault("not_found", "document not found");
  if (latest.value.files.length !== 1) {
    return fault("invalid_input", "document has more than one file");
  }
  const expected = latest.value.files[0]!.blob_hash;
  // 사람이 확인한 내용이 최신 판의 원문이 아니면 지우지 않는다.
  if (request.baseHash !== expected) {
    return fault("conflict", "the confirmed content is not the latest version");
  }
  const project = await ledger.project(source.project);
  if (!project.ok) return project;
  if (project.value === null) return fault("not_found", "project not found");
  const target = insideFolder(project.value, source.path);
  if (target === null) {
    return fault("invalid_input", "target is not available");
  }
  const resolved = await resolveTarget(
    deps.files.ops,
    target.root,
    source.path,
  );
  if (!resolved.ok) return resolved;
  const result: RemoveResult = {
    file: null,
    recording: "not_requested",
    source: NOT_ATTEMPTED,
    move: NOT_ATTEMPTED,
  };
  // 파일이 이미 없으면 지울 것이 없다. 연결을 푸는 단계로 간다.
  if (resolved.value.stat !== undefined) {
    const deleted = await deleteFile(deps.files, {
      root: target.root,
      path: source.path,
      baseHash: expected,
    });
    if (!deleted.ok) return deleted;
    result.file = deleted.value;
    const recorded = await commands.recordFile({
      operation: "delete",
      requestKey: request.requestKey,
      project: source.project,
      path: source.path,
      done: deleted.value,
    });
    result.recording = recorded.ok ? "recorded" : "unverified";
  }
  result.source = await unlinkStep(deps, request.document);
  if (result.source.state === "failed") return ok(result);
  result.move = await unplaceStep(deps, request.document);
  return ok(result);
}

async function unlinkStep(
  deps: PlacementDeps,
  document: string,
): Promise<StepOutcome> {
  const fresh = await deps.ledger.document(document);
  if (!fresh.ok) return failedStep(fresh.error);
  if (fresh.value === null) {
    return failedStep({ code: "not_found", message: "document not found" });
  }
  if (fresh.value.file_source === null) {
    return { state: "skipped", reason: "the document is already unlinked" };
  }
  const unlinked = await deps.commands.setSource(
    { document, file_source: null },
    { base_revision: fresh.value.revision },
  );
  return unlinked.ok ? { state: "done" } : failedStep(unlinked.error);
}

async function unplaceStep(
  deps: PlacementDeps,
  document: string,
): Promise<StepOutcome> {
  const fresh = await deps.ledger.document(document);
  if (!fresh.ok) return failedStep(fresh.error);
  if (fresh.value === null) {
    return failedStep({ code: "not_found", message: "document not found" });
  }
  if (fresh.value.place === null) {
    return { state: "skipped", reason: "the document has no place" };
  }
  const moved = await deps.commands.move(
    { document, place: null, name: null },
    { base_revision: fresh.value.revision },
  );
  return moved.ok ? { state: "done" } : failedStep(moved.error);
}

// ScanPort(준비 worker의 비동기 순회)로 경로의 상위 디렉터리마다 .gitignore를 읽는다.
export async function gitignoreChain(
  scan: Pick<ScanPort, "gitignore">,
  root: string,
  relativePath: string,
): Promise<Result<readonly GitignoreRule[]>> {
  const parts = relativePath.split("/").slice(0, -1);
  const rules: GitignoreRule[] = [];
  let directory = "";
  for (let depth = 0; depth <= parts.length; depth++) {
    if (depth > 0) {
      directory = directory === ""
        ? parts[depth - 1]!
        : `${directory}/${parts[depth - 1]}`;
    }
    const text = await scan.gitignore(root, directory);
    if (!text.ok) return text;
    if (text.value !== null) rules.push({ directory, text: text.value });
  }
  return ok(rules);
}
