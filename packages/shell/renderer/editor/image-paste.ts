// 문서에 붙여넣은 이미지가 저장될 이름. MIME → 확장자 표는 여기 하나만 둔다(그 file을 다시 열 때
// main이 확장자로 content type을 정한다).
import { freeName } from "../workspace/files/paste-names.ts";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * 붙여넣은 그림을 저장할 이름. 클립보드가 준 이름의 확장자를 MIME에 맞게 바꾸고, `taken`에 이미
 * 있는 이름이면 `image 2.png`처럼 비켜 간다. 이 편집기가 저장하는 형식이 아니면 null이다.
 */
export function pastedImageName(
  file: File,
  taken: Iterable<string>,
): string | null {
  const extension = EXTENSIONS[file.type.toLowerCase()];
  if (extension === undefined) return null;
  const stem = file.name.replace(/\.[^.]*$/, "") || "image";
  return freeName(`${stem}.${extension}`, taken, "number");
}

/** 이 문서가 놓인 폴더. 붙여넣은 file과 상대 경로 그림의 자리다. */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : "/";
}
