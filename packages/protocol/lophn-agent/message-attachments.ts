// 사람 메시지 글 끝의 첨부 줄. content는 글뿐이라 붙인 파일은 경로를, 이미지는 올린 id를 줄로 싣는다
// (`message-images.ts`). renderer는 이 줄을 떼어 chip과 그림으로 보이고, core는 자동 제목에서 뺀다.

const FILE_PREFIX = "Attached file: ";
const IMAGE_LINE =
  /^Attached image: open with image\.read path "attachment:([A-Za-z0-9_-]+)"\.$/;

/** 올린 이미지 하나를 agent에게 알리는 줄. */
export function attachmentImageLine(id: string): string {
  return `Attached image: open with image.read path "attachment:${id}".`;
}

/** 보낼 글. 첨부 줄은 사람이 쓴 글 뒤에 빈 줄을 두고 붙인다. */
export function composeAttachmentText(
  text: string,
  files: readonly string[],
  images: readonly string[],
): string {
  const lines = [
    ...files.map((path) => `${FILE_PREFIX}${path}`),
    ...images.map(attachmentImageLine),
  ];
  if (lines.length === 0) return text;
  return text.trim() === ""
    ? lines.join("\n")
    : `${text}\n\n${lines.join("\n")}`;
}

/** 글 끝의 첨부 줄을 떼어 낸다. 글 사이의 같은 모양은 그대로 둔다. */
export function splitAttachmentText(
  text: string,
): { text: string; files: string[]; images: string[] } {
  const lines = text.split("\n");
  const files: string[] = [];
  const images: string[] = [];
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1]!;
    const image = IMAGE_LINE.exec(line);
    if (image !== null) images.unshift(image[1]!);
    else if (line.startsWith(FILE_PREFIX)) {
      files.unshift(line.slice(FILE_PREFIX.length));
    } else break;
    end -= 1;
  }
  if (files.length === 0 && images.length === 0) {
    return { text, files, images };
  }
  return { text: lines.slice(0, end).join("\n").trimEnd(), files, images };
}
