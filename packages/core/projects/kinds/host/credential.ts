import {
  KINDS_DISPATCH_PRINCIPAL,
  KINDS_WORKER_KIND,
} from "../../../../protocol/projects/mod.ts";
import { problemSyncDomain } from "../../../../protocol/problems/mod.ts";

// 위반을 problem으로 올리는 좁은 machine 자격의 발급 요청이다. worker를 띄우는 쪽이 registry.issue에 넘긴다.
export function kindsDispatchCredential() {
  return {
    actor: "machine" as const,
    principal: KINDS_DISPATCH_PRINCIPAL,
    scope: {
      operations: [problemSyncDomain.name],
      targets: { task: "kinds" },
    },
    conditions: { task: "kinds", process: KINDS_WORKER_KIND },
  };
}
