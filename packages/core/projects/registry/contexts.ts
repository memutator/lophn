// project 표에 쓰는 core 안 machine 자격이다. 기록이 없으면 writer가 거절한다.
import {
  projectApi,
  projectIdentityApi,
} from "../../../protocol/projects/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";

function machineContext(
  principal: string,
  operation: string,
): AuthenticatedContext {
  return {
    principal,
    actor: "machine",
    scope: { operations: [operation], targets: {} },
    conditions: {},
    credential_ref: principal,
  };
}

// 폴더의 git 여부와 remote를 읽은 값을 ledger에 적는다.
export const PROJECT_IDENTITY_PRINCIPAL = "machine:projects-identity";
export const PROJECT_IDENTITY_CONTEXT = machineContext(
  PROJECT_IDENTITY_PRINCIPAL,
  projectIdentityApi.recordIdentity.name,
);

// 내 다른 컴퓨터의 같은 저장소와 id를 맞춘다. 폴더 읽기와 같은 principal이다.
export const PROJECT_MATCH_CONTEXT = machineContext(
  PROJECT_IDENTITY_PRINCIPAL,
  projectIdentityApi.matchIdentity.name,
);

// clone한 저장소를 project로 등록한다.
export const PROJECT_CLONE_PRINCIPAL = "machine:projects-clone";
export const PROJECT_CLONE_CONTEXT = machineContext(
  PROJECT_CLONE_PRINCIPAL,
  projectApi.register.name,
);
