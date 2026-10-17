// Explorer 입력 칸이 이름을 검사하는 순수 규칙. 디스크가 최종 판정이고(main의 `conflict`) 여기는 이미 읽은
// 폴더 목록으로 미리 알려 주는 것뿐이다.
import type { FolderEntry } from "../source.ts";
import { joinPath, parentOf } from "./use-file-tree.ts";

export type NameProblem = "required" | "invalid" | "exists";

type EntriesOf = (folder: string) => readonly FolderEntry[] | undefined;

export interface NameCheck {
  readonly problem: NameProblem | null;
  /** 만들 이름의 조각. `a/b/c.md`면 셋이다. */
  readonly parts: readonly string[];
}

const BAD = new Set([".", ".."]);

function partsOf(raw: string, nested: boolean): readonly string[] | null {
  const name = raw.trim().replace(/\/+$/, "");
  if (name === "") return [];
  const parts = nested ? name.split("/") : [name];
  const bad = parts.some((part) =>
    part.trim() === "" || BAD.has(part.trim()) || part.includes("/") ||
    part.includes("\0")
  );
  return bad ? null : parts.map((part) => part.trim());
}

/** 새 파일·폴더 이름. `/`로 중간 폴더를 나눌 수 있다. */
export function checkNewName(
  raw: string,
  parent: string,
  entriesOf: EntriesOf,
): NameCheck {
  const parts = partsOf(raw, true);
  if (parts === null) return { problem: "invalid", parts: [] };
  if (parts.length === 0) return { problem: "required", parts };
  // 이미 읽은 폴더를 따라 내려가며 같은 이름이 있는지 본다. 아직 안 읽은 폴더부터는 main이 판정한다.
  let folder = parent;
  for (const [at, part] of parts.entries()) {
    const hit = entriesOf(folder)?.find((entry) => entry.name === part);
    if (hit === undefined) break;
    if (at === parts.length - 1 || hit.kind === "file") {
      return { problem: "exists", parts };
    }
    folder = joinPath(folder, part);
  }
  return { problem: null, parts };
}

/** 바꿀 이름. 폴더 안에서 하나의 이름이어야 한다. */
export function checkRename(
  raw: string,
  path: string,
  entriesOf: EntriesOf,
): NameCheck {
  const parts = partsOf(raw, false);
  if (parts === null) return { problem: "invalid", parts: [] };
  if (parts.length === 0) return { problem: "required", parts };
  const old = path.slice(path.lastIndexOf("/") + 1);
  const taken = parts[0] !== old &&
    entriesOf(parentOf(path))?.some((entry) => entry.name === parts[0]);
  return { problem: taken ? "exists" : null, parts };
}

/** 이름 바꾸기를 시작할 때 고르는 범위: 파일은 확장자 앞까지. */
export function renameRange(name: string, folder: boolean): [number, number] {
  const dot = name.lastIndexOf(".");
  return folder || dot <= 0 ? [0, name.length] : [0, dot];
}
