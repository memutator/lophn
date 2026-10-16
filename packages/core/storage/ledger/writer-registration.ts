import type { Clock, IdSource, Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
} from "../../../protocol/server/mod.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
} from "../../../protocol/storage/mod.ts";
import type { ConfirmationBridge } from "../../server/identity/mod.ts";
import type { TxPortRegistration } from "./tx-ports.ts";
import type { TxCall } from "./tx.ts";

// BEGIN 다음 현재 자격을 다시 본다. 부모 메시지의 주장은 쓰지 않는다.
// 현재 context를 돌려주면 그 actor·scope로 검사한다.
type CredentialCheck = (
  ctx: AuthenticatedContext,
) => Result<AuthenticatedContext>;

// Worker entry가 command 표와 권한을 조립한다. core entry가 authority를 넣는다.
export type WriterRegistration = {
  commands: readonly CommandDefinition[];
  clock: Clock;
  ids: IdSource;
  ports: readonly TxPortRegistration[];
  registerBlobRef: (
    reference: BlobRefRegistration,
  ) => Result<PermanentBlobReference>;
  call: TxCall;
  checkCredential: CredentialCheck;
  // 사람 결정 확인. 없으면 confirmation route는 unavailable이다.
  confirmation?: ConfirmationBridge;
};
