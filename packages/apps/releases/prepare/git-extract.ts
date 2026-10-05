// release 준비의 git extract(apps/releases#R2). 연결된 실제 source 경계에서 지정한
// commit의 tree object만 읽는다. working tree 변경·uncommitted 파일·symlink 자체·
// git 관리 정보·개발 credential·agent 도구·임시 설정은 bundle에 넣지 않는다.
// git 권한은 source 경계의 read뿐이다(architecture/apps 2.1). argv 배열만 쓰고 shell은 쓰지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { releaseExcludes } from "../../../contracts/coding-agent/mod.ts";

export type ExtractedFile = {
  path: string;
  bytes: Uint8Array;
};

export type ExtractFailure = {
  code: "invalid_input";
  reason:
    | "source_outside_boundary"
    | "commit_unknown"
    | "working_tree_changed"
    | "uncommitted_file"
    | "symlink_itself"
    | "git_metadata"
    | "excluded_path"
    | "git_failed";
};

// extract는 git 실행을 직접 하지 않는다. git 실행은 주입한다(테스트와 어댑터).
export type GitRunner = {
  // argv 전체를 받아 stdout을 돌려준다. 실패면 err이다. shell을 쓰지 않는다.
  run(args: readonly string[]): Promise<Result<Uint8Array>>;
};

export type ExtractInput = {
  // 연결된 실제 source 경계(app.source_path). 밖의 경로는 거절이다(R2).
  sourceRoot: string;
  // 완전한 40-hex commit ID다. 단축 hash는 받지 않는다.
  commit: string;
  // source가 실제 디렉터리·git root인지 확인한다. 없으면 realpath와 git로 본다.
  // 스크립트 테스트는 이미 안쪽이라고 답하는 함수를 넣는다.
  boundary?: (root: string) => Promise<Result<string, ExtractFailure>>;
};

const ISOCT = /^[0-9a-f]{40}$/;

export function validCommit(commit: string): boolean {
  return ISOCT.test(commit);
}

function fail(reason: ExtractFailure["reason"]): Result<never, ExtractFailure> {
  return err({ code: "invalid_input", reason });
}

function decode(result: Result<Uint8Array, unknown>): string {
  if (!result.ok) return "";
  return new TextDecoder().decode(result.value);
}

// 실제 git. argv 배열만 넘기고 shell은 쓰지 않는다.
export function gitCommandRunner(): GitRunner {
  return {
    async run(args) {
      const command = new Deno.Command("git", {
        args: [...args],
        stdin: "null",
        stdout: "piped",
        stderr: "null",
      });
      const output = await command.output();
      if (!output.success) {
        return err({ code: "invalid_input", message: "git failed" });
      }
      return ok(output.stdout);
    },
  };
}

// source 경계가 실제 디렉터리이고 git 저장소인지 확인한다. 밖 경로는 거절이다.
async function requireRepository(
  git: GitRunner,
  root: string,
): Promise<Result<string, ExtractFailure>> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(root);
  } catch {
    return fail("source_outside_boundary");
  }
  if (!stat.isDirectory) return fail("source_outside_boundary");
  // symlink로 들어온 root도 realpath가 git root와 같으면 같은 경계다.
  let real: string;
  try {
    real = await Deno.realPath(root);
  } catch {
    return fail("source_outside_boundary");
  }
  const rev = await git.run([
    "-C",
    real,
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  // 디렉터리인데 work tree가 아니면 git 저장소가 아니다. 경계 밖이다.
  if (!rev.ok || decode(rev).trim() !== "true") {
    return fail("source_outside_boundary");
  }
  const top = await git.run(["-C", real, "rev-parse", "--show-toplevel"]);
  if (!top.ok) return fail("git_failed");
  let topReal: string;
  try {
    topReal = await Deno.realPath(decode(top).trim());
  } catch {
    return fail("source_outside_boundary");
  }
  if (topReal !== real) return fail("source_outside_boundary");
  return ok(real);
}

type TreeEntry = { mode: string; path: string };

// `ls-tree -r -z` 출력을 path별로 나눈다. -z라 NUL이 경계다.
export function parseLsTree(output: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const meta = record.slice(0, tab);
    const path = record.slice(tab + 1);
    const [mode] = meta.split(" ");
    if (!mode || !path) continue;
    entries.push({ mode, path });
  }
  return entries;
}

type StatusRecord = { status: string; path: string };

// `status --porcelain -z`는 `XY path\0` 형식이다. rename은 XY path\0to\0으로
// 두 record가 나오고 to가 두 번째 record다.
export function parseStatusRecords(output: string): StatusRecord[] {
  const records = output.split("\0").filter((record) => record !== "");
  const parsed: StatusRecord[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const status = record.slice(0, 2);
    const path = record.slice(3);
    parsed.push({ status, path });
    const renamed = status.includes("R") || status.includes("C");
    if (renamed && records[index + 1] !== undefined) {
      parsed.push({ status: "", path: records[index + 1] });
      index += 1;
    }
  }
  return parsed;
}

// porcelain record의 path만 필요할 때 쓴다.
export function parsePorcelain(output: string): string[] {
  return parseStatusRecords(output).map((record) => record.path);
}

// commit과 working tree가 다르면 거절이다(R2). tracked 변경은
// working_tree_changed, untracked(uncommitted) 파일은 uncommitted_file이다.
async function rejectDirtyTree(
  git: GitRunner,
  root: string,
): Promise<Result<void, ExtractFailure>> {
  const status = await git.run(["-C", root, "status", "--porcelain", "-z"]);
  if (!status.ok) return fail("git_failed");
  const records = parseStatusRecords(decode(status));
  if (records.length === 0) return ok(undefined);
  const tracked = records.some((record) => record.status !== "??");
  return fail(tracked ? "working_tree_changed" : "uncommitted_file");
}

function excluded(path: string): boolean {
  if (releaseExcludes(path)) return true;
  const parts = path.split("/");
  for (let end = 1; end < parts.length; end++) {
    if (releaseExcludes(parts.slice(0, end).join("/"))) return true;
  }
  return false;
}

// 지정 commit에 파일이 없으면 단축 hash처럼 commit을 몰라도 같은 거절이다.
export async function extractCommit(
  git: GitRunner,
  input: ExtractInput,
): Promise<Result<ExtractedFile[], ExtractFailure>> {
  if (!validCommit(input.commit)) return fail("commit_unknown");
  const inside =
    await (input.boundary ?? ((root) => requireRepository(git, root)))(
      input.sourceRoot,
    );
  if (!inside.ok) return inside;
  const root = inside.value;
  const tree = await git.run([
    "-C",
    root,
    "ls-tree",
    "-r",
    "-z",
    input.commit,
  ]);
  if (!tree.ok) return fail("commit_unknown");
  const clean = await rejectDirtyTree(git, root);
  if (!clean.ok) return clean;
  const entries = parseLsTree(decode(tree));
  const files: ExtractedFile[] = [];
  for (const entry of entries) {
    if (excluded(entry.path)) continue;
    if (entry.mode === "120000") return fail("symlink_itself");
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      return fail("git_metadata");
    }
    if (entry.path.split("/").some((part) => part === ".." || part === "")) {
      return fail("source_outside_boundary");
    }
    const blob = await git.run([
      "-C",
      root,
      "cat-file",
      "blob",
      `${input.commit}:${entry.path}`,
    ]);
    if (!blob.ok) return fail("commit_unknown");
    files.push({ path: entry.path, bytes: blob.value });
  }
  return ok(files);
}
