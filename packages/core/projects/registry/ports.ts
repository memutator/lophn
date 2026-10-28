import { definePort } from "../../../protocol/base/mod.ts";
import type { FolderResolver } from "../ports.ts";

// 하위 폴더 검사와 등록 폴더 존재 확인. 기본 구현은 `folder-resolver.ts`다.
export const folderResolverPort = definePort<FolderResolver>(
  "projects.folder_resolver",
);
