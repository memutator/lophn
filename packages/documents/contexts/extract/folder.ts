// folder source: root 바로 아래 하위 폴더 중 이름이 child_pattern glob에 맞는 것 하나가 개체 하나다.
// 개체의 path는 폴더 path이고, path capture `folder`는 폴더 이름이다.
import picomatch from "picomatch";
import { childFolderNames } from "./folder-children.ts";
import type { EntityAnchor, KindExtractor } from "./types.ts";

export const folderKind: KindExtractor<"folder"> = (type, context) => {
  const { root, child_pattern } = type.source;
  // 폴더 이름 한 칸을 맞춘다. 숨김 폴더도 "모든 하위 폴더"에 든다(dot).
  const nameMatches = picomatch.makeRe(child_pattern, {
    dot: true,
    fastpaths: false,
    windows: false,
  });
  const anchors: EntityAnchor[] = childFolderNames(context.files.paths(), root)
    .filter((name) => nameMatches.test(name))
    .map((name) => ({
      type: type.name,
      path: `${root}/${name}`,
      section: null,
      captures: { folder: name },
      scope: { kind: "folder" },
    }));
  // 폴더 개체는 파일 글을 읽지 않아 unreadable 위반이 없다.
  return { anchors, violations: [] };
};
