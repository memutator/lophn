// 보낼 말에 붙이는 첨부. 사람 메시지 content는 글뿐이라 첨부는 글 끝의 줄로 싣는다(줄 모양은 protocol의
// `message-attachments.ts`). 파일은 경로를, 이미지는 올린 id를 적고 agent가 file tool이나 image.read로 연다.

export type Attachment =
  | { readonly kind: "file"; readonly path: string }
  | {
    readonly kind: "image";
    readonly name: string;
    readonly image: Blob;
    /** 미리 보기 blob 주소. 이 창 안에서 첨부 하나를 가리키는 key이기도 하다. */
    readonly url: string;
  };

// image.read가 여는 형식과 크기.
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 끌어 놓거나 붙여 넣거나 고른 OS 파일을 첨부로 바꾼다. 이미지는 바이트로 싣고, 그 밖은 경로를 싣는다.
 * 경로를 모르거나 너무 큰 이미지는 `skipped`로 센다.
 */
export function attachmentsOf(
  files: readonly File[],
  pathOf: (file: File) => string | null,
  urlOf: (image: Blob) => string,
): { attachments: Attachment[]; skipped: number } {
  const attachments: Attachment[] = [];
  let skipped = 0;
  for (const file of files) {
    if (IMAGE_TYPES.has(file.type)) {
      if (file.size > MAX_IMAGE_BYTES) skipped += 1;
      else {
        attachments.push({
          kind: "image",
          name: file.name,
          image: file,
          url: urlOf(file),
        });
      }
      continue;
    }
    const path = pathOf(file);
    if (path === null) skipped += 1;
    else attachments.push({ kind: "file", path });
  }
  return { attachments, skipped };
}

/** 같은 파일을 두 번 붙이지 않는다. */
export function withAttachments(
  current: readonly Attachment[],
  added: readonly Attachment[],
): Attachment[] {
  const next = [...current];
  for (const item of added) {
    if (
      item.kind === "file" &&
      next.some((other) => other.kind === "file" && other.path === item.path)
    ) continue;
    next.push(item);
  }
  return next;
}
