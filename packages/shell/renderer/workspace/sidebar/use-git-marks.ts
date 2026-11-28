// Explorer 줄의 git 상태 문자와 `.gitignore` 흐림. 체크아웃(원래 폴더, 펼친 worktree)마다 따로 `source_control/status`를 읽어
// 형제 worktree끼리 섞이지 않는다. 폴더 줄에는 안쪽 변경을 올려 보인다(지운 파일은 올리지 않는다).
import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceControlFile } from "../../../../protocol/projects/source-control.ts";
import {
  type CheckoutRef,
  checkoutKey,
  type SourceControlSource,
  targetOf,
} from "../worktrees/source.ts";
import type { FileRow } from "./use-file-tree.ts";

export type GitLetter = "M" | "A" | "U" | "D" | "R" | "C";

export interface GitMark {
  readonly letter: GitLetter;
  /** 안쪽 변경을 올려 받은 폴더 줄. 문자 대신 점을 그린다. */
  readonly inherited: boolean;
}

/** 줄 하나의 git 표시. 상태가 없고 무시된 파일이면 dim만 선다. */
export interface RowGit {
  readonly mark: GitMark | null;
  readonly ignored: boolean;
  /** 이 파일이 든 체크아웃과 그 기준 상대 경로. 변경이 있는 파일의 Open Diff·Discard가 쓴다. */
  readonly checkout: CheckoutRef | null;
  readonly relPath: string | null;
}

export interface GitCheckout {
  readonly checkout: CheckoutRef;
  /** 줄을 이 체크아웃에 묶는 경로(원래 폴더나 worktree 폴더). */
  readonly root: string;
  /** 이 값이 바뀌면 상태를 다시 읽는다(worktree 상태 알림의 updated_at). */
  readonly stamp?: string;
}

const REFRESH_MS = 3000;
const REMOTE_REFRESH_MS = 15_000;
const IGNORE_DEBOUNCE_MS = 300;
const IGNORE_BATCH = 2000;

const RANK: Record<GitLetter, number> = {
  C: 5,
  M: 4,
  A: 3,
  U: 3,
  R: 2,
  D: 1,
};

export function letterOf(file: SourceControlFile): GitLetter {
  if (file.conflicted) return "C";
  if (file.untracked) return "U";
  const codes = `${file.index_status}${file.worktree_status}`;
  if (codes.includes("D")) return "D";
  if (codes.includes("R")) return "R";
  if (file.index_status === "A") return "A";
  return "M";
}

const trim = (path: string) => path.replace(/\/+$/, "") || "/";
const inside = (base: string, path: string) =>
  path === base || path.startsWith(`${trim(base)}/`);

interface Read {
  /** git 최상위(상태의 경로 기준). */
  readonly cwd: string;
  readonly files: ReadonlyMap<string, GitLetter>;
}

export function useGitMarks(
  sc: SourceControlSource | null,
  project: string | null,
  checkouts: readonly GitCheckout[],
  rows: readonly FileRow[],
  remote: boolean,
) {
  const [reads, setReads] = useState<ReadonlyMap<string, Read>>(new Map());
  const [ignored, setIgnored] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const latest = useRef({ checkouts, reads, ignored });
  latest.current = { checkouts, reads, ignored };
  const signature = checkouts
    .map((one) => `${checkoutKey(one.checkout)}@${one.stamp ?? ""}`)
    .join("|");

  const readAll = useCallback(async () => {
    if (sc === null || project === null) return;
    const list = latest.current.checkouts;
    const results = await Promise.all(
      list.map(async (one) => {
        const res = await sc.status(targetOf(project, one.checkout));
        if (!res.ok) return [checkoutKey(one.checkout), null] as const;
        const files = new Map<string, GitLetter>();
        for (const file of res.value.files) {
          files.set(`${trim(res.value.cwd)}/${file.path}`, letterOf(file));
        }
        return [
          checkoutKey(one.checkout),
          { cwd: trim(res.value.cwd), files },
        ] as const;
      }),
    );
    setReads(() => {
      const next = new Map<string, Read>();
      for (const [key, read] of results) if (read !== null) next.set(key, read);
      return next;
    });
  }, [sc, project]);

  useEffect(() => {
    void readAll();
    const tick = () => {
      if (document.visibilityState === "visible") void readAll();
    };
    const timer = setInterval(tick, remote ? REMOTE_REFRESH_MS : REFRESH_MS);
    globalThis.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("focus", tick);
    };
  }, [readAll, signature, remote]);

  /** 그 경로가 든 체크아웃(가장 깊은 것). */
  const ownerOf = (path: string) => {
    let best: GitCheckout | undefined;
    for (const one of checkouts) {
      if (!inside(one.root, path)) continue;
      if (best === undefined || one.root.length > best.root.length) best = one;
    }
    return best;
  };

  // 폴더 줄로 올린 표시. 체크아웃마다 파일에서 위로 올라가며 가장 센 문자를 남긴다.
  const folderMarks = new Map<string, GitLetter>();
  for (const read of reads.values()) {
    for (const [path, letter] of read.files) {
      if (letter === "D") continue;
      let folder = path.slice(0, path.lastIndexOf("/"));
      while (folder.length > read.cwd.length) {
        const before = folderMarks.get(folder);
        if (before === undefined || RANK[letter] > RANK[before]) {
          folderMarks.set(folder, letter);
        }
        folder = folder.slice(0, folder.lastIndexOf("/"));
      }
    }
  }

  // 무시 판정: 자기 상태가 없는 줄만 300ms 묶어 묻는다. 체크아웃마다 cache한다.
  const ignoreKey = (checkout: CheckoutRef, path: string) =>
    `${checkoutKey(checkout)}\0${path}`;
  const pendingSignature = rows.map((row) => row.id).join("\n");
  useEffect(() => {
    if (sc === null || project === null) return;
    const timer = setTimeout(() => {
      const ask = new Map<string, { checkout: CheckoutRef; paths: string[] }>();
      for (const row of rows) {
        if (row.worktree !== undefined) continue;
        const owner = ownerOf(row.id);
        if (owner === undefined) continue;
        const read = latest.current.reads.get(checkoutKey(owner.checkout));
        if (read === undefined || !inside(read.cwd, row.id)) continue;
        if (read.files.has(row.id)) continue;
        if (latest.current.ignored.has(ignoreKey(owner.checkout, row.id))) {
          continue;
        }
        const key = checkoutKey(owner.checkout);
        const entry = ask.get(key) ?? { checkout: owner.checkout, paths: [] };
        if (entry.paths.length < IGNORE_BATCH) entry.paths.push(row.id);
        ask.set(key, entry);
      }
      for (const { checkout, paths } of ask.values()) {
        const read = latest.current.reads.get(checkoutKey(checkout));
        if (read === undefined || paths.length === 0) continue;
        const rel = paths.map((path) => path.slice(read.cwd.length + 1));
        void sc.ignored(targetOf(project, checkout), rel).then((res) => {
          if (!res.ok) return;
          const hit = new Set(res.value.ignored.map((one) => trim(one)));
          setIgnored((current) => {
            const next = new Map(current);
            rel.forEach((one, at) => {
              next.set(ignoreKey(checkout, paths[at]!), hit.has(trim(one)));
            });
            return next;
          });
        });
      }
    }, IGNORE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sc, project, pendingSignature, reads]);

  const gitOf = (row: FileRow): RowGit => {
    const owner = row.worktree === undefined ? ownerOf(row.id) : undefined;
    if (owner === undefined) {
      return { mark: null, ignored: false, checkout: null, relPath: null };
    }
    const read = reads.get(checkoutKey(owner.checkout));
    if (read === undefined || !inside(read.cwd, row.id)) {
      return { mark: null, ignored: false, checkout: null, relPath: null };
    }
    const relPath =
      row.id === read.cwd ? null : row.id.slice(read.cwd.length + 1);
    const own = read.files.get(row.id);
    const inherited = row.folder ? folderMarks.get(row.id) : undefined;
    const mark =
      own !== undefined
        ? { letter: own, inherited: false }
        : inherited !== undefined
          ? { letter: inherited, inherited: true }
          : null;
    const dim =
      mark === null && ignored.get(ignoreKey(owner.checkout, row.id)) === true;
    return { mark, ignored: dim, checkout: owner.checkout, relPath };
  };

  return {
    gitOf,
    /** 그 체크아웃의 git 상태를 읽었다(git 저장소다). */
    tracked: (checkout: CheckoutRef) => reads.has(checkoutKey(checkout)),
    refresh: () => {
      setIgnored(new Map());
      void readAll();
    },
  };
}
