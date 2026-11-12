// OS clipboard에서 붙여넣을 때의 규칙: text가 절대 경로 목록인지, 이미지 file의 이름은 무엇인지.
// Explorer 화면(explorer.tsx)에 이 규칙을 흩지 않는다.

/** 클립보드 이미지에 붙일 확장자. 확장자 없는 `image/png` 같은 MIME에서 이름을 짓는다. */
export const EXTENSION_OF_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** 붙여넣을 절대 경로만 고른다. 한 줄에 하나이고 CRLF와 줄 앞뒤 공백을 견딘다. */
export function pathsFromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"));
}

/**
 * 붙여넣는 이미지의 이름. 클립보드가 준 이름을 쓰고, 확장자는 MIME이 아는 형식으로 맞춘다.
 * 이름이 없으면 `image.<mime 확장자>`이고, MIME도 모르는 형식이면 `image.png`다.
 */
export function imageNameOf(file: {
  readonly name: string;
  readonly type: string;
}): string {
  const name = file.name.trim();
  const extension = EXTENSION_OF_MIME[file.type];
  if (name === "") return `image.${extension ?? "png"}`;
  return extension === undefined
    ? name
    : `${name.replace(/\.[^.]*$/, "")}.${extension}`;
}
