import { definePort } from "../../../protocol/base/mod.ts";
import type { FolderResolver, ProjectManagerProvisioning } from "../ports.ts";

// 등록 command가 같은 tx 안에서 Project Manager를 만든다. 구현은 agent-definition 쪽이 채운다.
export const projectManagerProvisioningPort =
  definePort<ProjectManagerProvisioning>("projects.manager_provisioning");

// 하위 폴더 검사와 등록 폴더 존재 확인. 기본 구현은 `folder-resolver.ts`다.
export const folderResolverPort = definePort<FolderResolver>(
  "projects.folder_resolver",
);
