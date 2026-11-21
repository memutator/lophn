// project 표에 쓰는 core 안 machine 자격이다. 기록이 없으면 writer가 거절한다.
import {
  projectApi,
  projectIdentityApi,
} from "../../../protocol/projects/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";

function machineContext(
  principal: string,
  operations: string[],
): AuthenticatedContext {
  return {
    principal,
    actor: "machine",
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: principal,
  };
}

// 폴더의 git 여부와 remote를 읽은 값을 ledger에 적고, 내 다른 컴퓨터의 같은 저장소와 id를 맞춘다. credential 기록은
// principal 하나에 context 하나라(core가 기동마다 덮는다) 두 operation을 한 context에 둔다.
export const PROJECT_IDENTITY_PRINCIPAL = "machine:projects-identity";
export const PROJECT_IDENTITY_CONTEXT = machineContext(
  PROJECT_IDENTITY_PRINCIPAL,
  [
    projectIdentityApi.recordIdentity.name,
    projectIdentityApi.matchIdentity.name,
  ],
);

// clone한 저장소를 project로 등록한다.
export const PROJECT_CLONE_PRINCIPAL = "machine:projects-clone";
export const PROJECT_CLONE_CONTEXT = machineContext(PROJECT_CLONE_PRINCIPAL, [
  projectApi.register.name,
]);
