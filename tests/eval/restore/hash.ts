import { sha256Hex } from "../../../packages/base/mod.ts";

// core의 package bundle hash와 같은 모양이지만 일부러 import하지 않고 따로 쓴다. core를 variant로 바꿔도
// 재료의 hash가 변하면 안 되기 때문이다.
export async function contentHash(
  files: readonly { path: string; bytes: Uint8Array }[],
): Promise<string> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : 1)) {
    chunks.push(encoder.encode(`${file.path}\n${file.bytes.length}\n`));
    chunks.push(file.bytes);
    chunks.push(encoder.encode("\n"));
  }
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return await sha256Hex(out);
}
