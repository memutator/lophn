import { shellPieces } from "../../../approvals/gate/shell-match.ts";

// shell 명령을 read·list·search·command로 가른다. 화면의 묶기에만 쓰고 판정에는 쓰지 않는다.
// 따옴표와 escape를 풀지 않는다(명령 parser 없음). 앞머리의 `cd …`는 어디서 도는지만 정하므로 뗀다.
const READ = new Set(["cat", "head", "tail", "nl"]);
const LIST = new Set(["ls", "tree", "find", "fd"]);
const SEARCH = new Set(["rg", "grep"]);

type Category = "read" | "list" | "search" | "command";

function firstWord(piece: string): string {
  return piece.split(" ")[0] ?? "";
}

function pieceCategory(piece: string): Category {
  const first = firstWord(piece);
  const second = piece.split(" ")[1];
  if (READ.has(first)) return "read";
  if (first === "sed" && second === "-n") return "read";
  if (LIST.has(first)) return "list";
  if (SEARCH.has(first)) return "search";
  if (first === "git" && second === "grep") return "search";
  // 환경 변수 앞붙임(`FOO=1 rg …`)과 경로가 붙은 명령(`/usr/bin/rg`)은 command다.
  return "command";
}

export function shellCategory(command: string): Category {
  const pieces = shellPieces(command);
  let start = 0;
  while (start < pieces.length && firstWord(pieces[start]!) === "cd") {
    start += 1;
  }
  const rest = pieces.slice(start);
  if (rest.length === 0) return "command";
  if (rest.some((piece) => pieceCategory(piece) === "command")) {
    return "command";
  }
  // 뒤 조각은 출력을 줄이는 일이 많으므로(`rg foo | head`) 첫 조각의 분류를 쓴다.
  return pieceCategory(rest[0]!);
}
