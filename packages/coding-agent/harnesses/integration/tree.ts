// 디렉터리 내용의 hash다(coding-agent/harnesses#R7, guides#R4). 설치가 기록하는
// digest와 제거가 비교하는 digest가 같은 모양이어야 한다. 파일별 hash를 경로
// 순으로 모아 하나로 접는다.
import { sha256Hex } from "../../../base/mod.ts";
import type { Digest } from "./receipt.ts";

export async function treeDigest(
  files: readonly { path: string; text: string }[],
): Promise<Digest> {
  const lines: string[] = [];
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : 1)) {
    lines.push(`${file.path} ${await sha256Hex(file.text)}`);
  }
  return await sha256Hex(lines.join("\n"));
}

export function plannedDigest(
  files: readonly { path: string; content: string }[],
): Promise<Digest> {
  return treeDigest(
    files.map((file) => ({ path: file.path, text: file.content })),
  );
}
