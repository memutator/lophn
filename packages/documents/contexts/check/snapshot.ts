import { createHash } from "node:crypto";
import type { ProjectFiles } from "../extract/types.ts";

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

// snapshot_hash: 파일 상태 하나를 가리키는 sha256 소문자 hex.
//
// 바이트 배열 = path의 code unit 순으로 정렬한 파일마다 아래 한 줄을 이은 것.
//   <path의 UTF-8>  0x00  <내용의 sha256 소문자 hex 64자>  0x0A
// 내용은 `read(path)`의 글을 UTF-8로 본다. `read`가 null인 파일(listed but unreadable)은 hex 자리가 빈 글이다
// (빈 파일의 sha256과 구별된다). 파일이 하나도 없으면 빈 바이트 배열의 sha256이다.
// 순서는 이 함수가 다시 정렬한다: `paths()`가 돌려주는 순서에 기대지 않는다.
export function snapshotHash(files: ProjectFiles): string {
  // 기본 sort는 UTF-16 code unit 순이다.
  const paths = [...files.paths()].sort();
  const lines = paths.map((path) => {
    const text = files.read(path);
    return `${path}\u0000${text === null ? "" : sha256(text)}\n`;
  });
  return sha256(new TextEncoder().encode(lines.join("")));
}
