// 파일 관측의 실제 읽기. scan·hash·blob은 core 밖 준비 worker가 하고, 여기 함수는
// 그 worker가 주입한 port만 부른다. 동기 file API는 쓰지 않는다.
import { ok, type Result } from "../../base/mod.ts";
import { decideTracking, type GitignoreRule } from "../projects/mod.ts";
import type { TrackingPattern } from "../../contracts/documents/mod.ts";
import { STABLE_READ_RETRIES } from "./model.ts";
import { type FileIdentity, identityMatches } from "./observation.ts";

export type ScanEntry = {
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  // symlink가 가리키는 실제 경로. 없으면 경계 밖으로 본다.
  realPath?: string;
  targetKind?: "file" | "directory";
};

// 준비 worker가 채우는 비동기 순회. 한 번에 한 디렉터리만 연다.
export type ScanPort = {
  list(root: string, directory: string): Promise<Result<readonly ScanEntry[]>>;
  gitignore(root: string, directory: string): Promise<Result<string | null>>;
};

export type ScanRequest = {
  root: string;
  patterns: readonly TrackingPattern[];
  useGitignore: boolean;
  enabled: boolean;
};

export type ScannedFile = {
  relative: string;
  realPath: string;
};

// root를 깊이 우선으로 돈다. `.git`·lophn data·root 밖 symlink는 순회와 최종 파일
// 둘 다에서 빠지고, 규칙에 맞는 파일만 남긴다.
export async function scanRoot(
  port: ScanPort,
  request: ScanRequest,
): Promise<Result<readonly ScannedFile[]>> {
  const found: ScannedFile[] = [];
  const gitignore: GitignoreRule[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    if (request.useGitignore) {
      const text = await port.gitignore(request.root, directory);
      if (!text.ok) return text;
      if (text.value !== null) {
        gitignore.push({ directory, text: text.value });
      }
    }
    const listed = await port.list(request.root, directory);
    if (!listed.ok) return listed;
    for (const entry of listed.value) {
      const relative = directory === ""
        ? entry.name
        : `${directory}/${entry.name}`;
      const escapes = entry.kind === "symlink" &&
        (entry.realPath === undefined ||
          !insideRoot(request.root, entry.realPath));
      const decision = decideTracking({
        relativePath: relative,
        patterns: request.patterns,
        useGitignore: request.useGitignore,
        gitignore,
        escapesRoot: escapes,
        enabled: request.enabled,
      });
      if (!decision.ok) return decision;
      if (entry.kind === "directory") {
        // 제외된 디렉터리는 내려가지 않는다. 미일치는 아직 판정이 없으므로 내려간다.
        if (decision.value.reason !== "unmatched" && !decision.value.included) {
          continue;
        }
        pending.push(relative);
        continue;
      }
      if (entry.kind === "symlink" && entry.targetKind === "directory") {
        continue;
      }
      if (!decision.value.included) continue;
      const real = entry.kind === "symlink" ? entry.realPath : undefined;
      if (entry.kind === "symlink" && real === undefined) continue;
      found.push({ relative, realPath: real ?? `${request.root}/${relative}` });
    }
  }
  return ok(found);
}

// 문자열 접두사로는 `/work`이 `/work2`를 안으로 본다. 경로 구분자에서만 비교한다.
// relative()가 `..`를 내면 root 밖이다. symlink의 실제 경로에 쓴다.
function insideRoot(root: string, realPath: string): boolean {
  const relative = relativePath(root, realPath);
  return relative !== null && !relative.split("/").includes("..");
}

function relativePath(root: string, target: string): string | null {
  if (root === target) return "";
  const rootParts = root.split("/");
  const targetParts = target.split("/");
  if (rootParts[0] !== targetParts[0]) return null;
  let shared = 0;
  while (
    shared < rootParts.length && shared < targetParts.length &&
    rootParts[shared] === targetParts[shared]
  ) {
    shared += 1;
  }
  const up = rootParts.length - shared;
  const down = targetParts.slice(shared);
  return [...Array<string>(up).fill(".."), ...down].join("/");
}

export type StableRead = {
  hash: string;
  bytes: Uint8Array;
  identity: FileIdentity;
};

// 한 파일을 여는 port. 열기 전과 읽기 뒤의 identity를 같이 돌려준다.
export type StableReadPort = {
  open(path: string): Promise<
    Result<{ before: FileIdentity; read(): Promise<Result<Uint8Array>> }>
  >;
  identity(path: string): Promise<Result<FileIdentity>>;
  hash(bytes: Uint8Array): Promise<string>;
};

export type StableOutcome =
  | { kind: "stable"; read: StableRead }
  | { kind: "unverified"; reason: string };

// 같은 stream에서 hash와 보존 바이트를 만든다. 열기 전·후 identity가 다르면
// 최대 3번 다시 읽고, 그래도 흔들리면 unverified로 둔다.
export async function readStably(
  port: StableReadPort,
  path: string,
): Promise<Result<StableOutcome>> {
  let last = "file changed while reading";
  for (let attempt = 0; attempt < STABLE_READ_RETRIES; attempt++) {
    const opened = await port.open(path);
    if (!opened.ok) return opened;
    const body = await opened.value.read();
    if (!body.ok) return body;
    const after = await port.identity(path);
    if (!after.ok) return after;
    if (!identityMatches(opened.value.before, after.value)) {
      last = "file changed while reading";
      continue;
    }
    const hash = await port.hash(body.value);
    return ok({
      kind: "stable",
      read: { hash, bytes: body.value, identity: after.value },
    });
  }
  return ok({ kind: "unverified", reason: last });
}
