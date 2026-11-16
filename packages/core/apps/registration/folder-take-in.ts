// 폴더 take-in이 다른 기계의 앱을 같은 app id로 등록하는 core 안 machine 자격(folder/apps). 앱 id를 정할 수 있는 것은
// 이 자격 하나다. 사람과 agent는 id를 정하지 못한다(id는 기계 사이 앱의 신분이다).
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  appConnectSource,
  appCreate,
  releaseRecord,
} from "../../../protocol/apps/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../../protocol/server/mod.ts";

export const FOLDER_APPS_PRINCIPAL = "machine:folder-apps";
// 조립이 records와 operation 상한에 둔다.
export const FOLDER_APPS_CONTEXT: AuthenticatedContext = {
  principal: FOLDER_APPS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [appCreate.name, appConnectSource.name, releaseRecord.name],
    targets: {},
  },
  conditions: {},
  credential_ref: FOLDER_APPS_PRINCIPAL,
};

export function isFolderTakeIn(ctx: RequestContext): boolean {
  return (
    parseActor(ctx.actor)?.kind === "machine" &&
    ctx.principal === FOLDER_APPS_PRINCIPAL
  );
}
