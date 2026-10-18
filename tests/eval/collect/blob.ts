import { sha256Hex } from "../../../packages/base/mod.ts";
import { objectPathFor } from "../../../packages/core/storage/blobs/model.ts";

export type BlobReader = (hash: string) => Promise<Uint8Array | null>;

// model call의 요청 body를 읽는 제품 route는 없다(blob.read가 막고 turnBody의 kind에도 없다).
// 그래서 trial의 data root에서 파일을 직접 읽는다. hash가 다르거나 파일이 없으면 null이다.
export function diskBlobReader(home: string): BlobReader {
  return async (hash) => {
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(objectPathFor(home, hash));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
    return (await sha256Hex(bytes)) === hash ? bytes : null;
  };
}

// UTF-8 JSON blob의 값. 못 읽거나 파싱이 안 되면 null이다.
export async function readJsonBlob(
  readBlob: BlobReader,
  hash: string,
): Promise<unknown | null> {
  const bytes = await readBlob(hash);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
