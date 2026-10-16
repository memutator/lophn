import { err, ok } from "../../../../base/mod.ts";
import {
  secretDelete,
  secretPut,
  secretStatus,
} from "../../../../protocol/secrets/mod.ts";
import {
  createFileSecretAttach,
  createSecretFileStore,
  openSecretStore,
  SECRET_SCHEMA_STEPS,
  secretDeleteHandler,
  secretPutHandler,
  secretStatusHandler,
  type SecretStore,
} from "../../../secrets/mod.ts";
import type { KnownSecretMatch } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export const secretsWiring: WiringFactory = () => {
  let store: SecretStore | undefined;
  return {
    name: "secrets",
    // 옛 ledger `secrets` 표. 아직 있는 SetSecret·RemoveSecret command와 runtime.ts의 옛 store가 읽는다.
    schemaStepsAfterTeams: SECRET_SCHEMA_STEPS,
    // 파일 저장소와 port를 런타임 전에 낸다. reader pool 통로는 runtime이 열린 뒤에야 있어 부를 때 읽는다.
    prepare(ctx) {
      const file = createSecretFileStore({
        root: ctx.root.path,
        log: (message) => console.error(`secrets: ${message}`),
      });
      store = openSecretStore({
        file,
        channel: {
          register: (values) => ctx.runtime.readers.known.register(values),
          revoke: (values) => ctx.runtime.readers.known.revoke(values),
          setReady: (ready) => ctx.runtime.readers.known.setReady(ready),
        },
      });
      ctx.provide("secretStore", store);
      // allowance(앱 grant 판정, tx 안의 port)·process 생존·목적지 답은 소유 concern이 낸다. 이 세 입력이
      // context에 아직 없어 모두 거절로 둔다(fail-closed). 칸이 생기면 여기서 끼운다.
      ctx.provide(
        "secretAttach",
        createFileSecretAttach({
          file,
          allowance: () =>
            err({
              code: "forbidden",
              message: "secret 전송을 허용하지 않는다",
            }),
          processes: () => false,
          destinations: { allowed: () => [] },
        }),
      );
    },
    async build(ctx) {
      const secrets = store!;
      // 파일을 열고 값을 reader pool에 올린다. API가 열리기 전이라 첫 요청 전에 알려진 값이 맞다. 못 읽으면
      // secret 기능만 unavailable이고 redactor가 막힌 채 재시도한다.
      const opened = await secrets.open();
      if (!opened.ok) console.error("secrets: secret 파일을 열지 못했다");
      // 다시 뜬 reader는 알려진 값을 모른다. 현재 값을 다시 올린다.
      ctx.runtime.onReaderRespawn(() => secrets.sync());
      // 옛 keychain 값(runtime.ts의 옛 store)과 파일 값을 모두 안다. 어느 쪽이든 준비되지 않았으면 막는다.
      ctx.provide(
        "knownSecrets",
        bothKnown(ctx.runtime.knownSecrets, secrets.known),
      );
      return ok({
        memory: [
          [key(secretStatus), secretStatusHandler(secrets)],
          [key(secretDelete), secretDeleteHandler(secrets)],
        ],
        uploads: [[key(secretPut), secretPutHandler(secrets)]],
      });
    },
    closeIntake() {
      store?.stop();
    },
  };
};

function bothKnown(a: KnownSecretMatch, b: KnownSecretMatch): KnownSecretMatch {
  return {
    match(text) {
      const x = a.match(text);
      const y = b.match(text);
      if (x === undefined || y === undefined) return x ?? y;
      return x.index < y.index || (x.index === y.index && x.length >= y.length)
        ? x
        : y;
    },
    get ready() {
      return a.ready && b.ready;
    },
  };
}
