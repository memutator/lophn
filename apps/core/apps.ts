import {
  appsSchemaSteps,
  createAppCommands,
  createAppsReads,
  lookupAppRegistration,
} from "../../packages/apps/registration/mod.ts";
import { appRegistrationLookup } from "../../packages/contracts/apps/mod.ts";
import {
  type PlaceNameReservation,
  placeNameReservation,
} from "../../packages/contracts/documents/mod.ts";
import { createPlaceNameReservation } from "../../packages/documents/addressing/mod.ts";
import type { TxPortRegistration } from "../../packages/platform/ledger/mod.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
};

// owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createAppCommands();
  const reads = createAppsReads();
  return {
    // place_names 표는 documents 등록의 몫이다(R6, R10).
    schemaSteps: [...appsSchemaSteps],
    commands: [
      commands.create,
      commands.connectSource,
      commands.archive,
      commands.unarchive,
    ],
    reads: [reads.list, reads.get],
    // coding-agent connection의 app scope 검사와 documents의 자리 해석은 같은 Tx의
    // 존재 조회를 쓴다. TargetAuthorization은 tx.ts가 주입하므로 여기 등록하지 않는다.
    ports: [
      {
        key: appRegistrationLookup,
        create: (tx) => ({
          get: (app: string) => lookupAppRegistration(tx.sql, app),
        }),
      },
      // documents가 하나로 나눈 place 이름 공간이다(dm#C7). documents 조립도 같은
      // 구현을 등록하므로 harness 등록을 겹치지 않게 documents만 실지 등록했다.
      {
        key: placeNameReservation,
        create: (tx) => createPlaceNameReservation(tx) as PlaceNameReservation,
      },
    ],
  };
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: unknown,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
