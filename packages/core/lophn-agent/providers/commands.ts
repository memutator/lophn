import { err, ok, type Result } from "../../../base/mod.ts";
import {
  connectProvider,
  disconnectProvider,
  loginBegin,
  loginCancel,
  loginComplete,
  type ProviderCredential,
  type ProviderRecord,
  recordProviderAccountModels,
  recordProviderAvailability,
  refreshProviderCredential,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  assertCredential,
  assertDefinition,
  assertRecord,
  nextCredentialState,
  providerFromRow,
} from "./model.ts";
import { providerSecretName } from "./oauth-secrets.ts";

// 등록 순서: 입력 검사 → CAS 비교 → 쓰기 → event. 짧은 transaction 하나.
// provider에는 credential이 하나다. 계정 목록·순서·끄기는 없고, 바꾸거나 다시 로그인하려면
// Disconnect 뒤 Connect한다.

function notFound(): Result<never> {
  return err({ code: "not_found", message: "provider not found" });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

// Connect와 Disconnect는 사람만 결정한다.
function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : err({
    code: "forbidden",
    message: "provider connections are user only",
  });
}

function requireProvider(tx: Tx, id: string): Result<ProviderRecord> {
  const row = tx.sql.get(
    "select id, name, definition_key, definition, endpoint, protocol, revision from providers where id = ?",
    [id],
  );
  if (row === undefined) return notFound();
  const loaded = providerFromRow(tx.sql, row as never);
  if (!loaded.ok) return loaded;
  if (loaded.value === null) return notFound();
  return ok(loaded.value);
}

function checkRevision(
  provider: ProviderRecord,
  compare: { revision: number },
): Result<void> {
  if (provider.revision !== compare.revision) {
    return conflict("provider revision changed");
  }
  return ok(undefined);
}

// secret 이름은 provider별 하나다. credential이 아니라 provider를 가리킨다.
function insertCredential(
  tx: Tx,
  providerId: string,
  value: ProviderCredential,
): void {
  tx.sql.run(
    `insert into provider_credentials
      (provider, kind, secret_name, revision,
       state, unavailable_reason, until, expires_at, logged_in_at, refreshed_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      providerId,
      value.kind,
      value.secret_ref?.name ?? null,
      value.revision,
      value.state,
      value.unavailable_reason,
      value.until,
      value.expires_at,
      value.logged_in_at,
      value.refreshed_at,
    ],
  );
}

// identity(provider·kind)는 SET에 넣지 않는다. trigger가 같은 값도 막는다.
function updateCredential(
  tx: Tx,
  providerId: string,
  value: ProviderCredential,
): void {
  tx.sql.run(
    `update provider_credentials set
       secret_name = ?, revision = ?,
       state = ?, unavailable_reason = ?, until = ?, expires_at = ?,
       logged_in_at = ?, refreshed_at = ?
     where provider = ?`,
    [
      value.secret_ref?.name ?? null,
      value.revision,
      value.state,
      value.unavailable_reason,
      value.until,
      value.expires_at,
      value.logged_in_at,
      value.refreshed_at,
      providerId,
    ],
  );
}

// model block은 바꿀 때 통째로 교체한다.
function replaceModelBlocks(
  tx: Tx,
  providerId: string,
  blocks: ProviderCredential["model_blocks"],
): void {
  tx.sql.run(
    "delete from provider_credential_model_blocks where provider = ?",
    [providerId],
  );
  for (const block of blocks) {
    tx.sql.run(
      `insert into provider_credential_model_blocks
        (provider, model_name, reason, until) values (?, ?, ?, ?)`,
      [providerId, block.model_name, block.reason, block.until],
    );
  }
}

export function createProviderCommands(): {
  connect: CommandDefinition<typeof connectProvider>;
  disconnect: CommandDefinition<typeof disconnectProvider>;
  refreshCredential: CommandDefinition<typeof refreshProviderCredential>;
  recordAvailability: CommandDefinition<typeof recordProviderAvailability>;
  recordAccountModels: CommandDefinition<typeof recordProviderAccountModels>;
  beginLogin: CommandDefinition<typeof loginBegin>;
  completeLogin: CommandDefinition<typeof loginComplete>;
  cancelLogin: CommandDefinition<typeof loginCancel>;
} {
  return {
    // OAuth 로그인은 writer queue 앞의 처리기가 실제로 돌린다
    // (withProviderLogin). 이 등록은 경로를 route registry에 열어 두는 자리다.
    beginLogin: {
      route: loginBegin,
      handle() {
        return err({
          code: "unavailable",
          message: "provider login runs outside the ledger writer",
        });
      },
    },
    completeLogin: {
      route: loginComplete,
      handle() {
        return err({
          code: "unavailable",
          message: "provider login runs outside the ledger writer",
        });
      },
    },
    cancelLogin: {
      route: loginCancel,
      handle() {
        return err({
          code: "unavailable",
          message: "provider login runs outside the ledger writer",
        });
      },
    },
    // Connect: provider와 그 credential 하나를 함께 둔다. secret 값은 이미 secrets.json에 있고 이름만 받는다.
    connect: {
      route: connectProvider,
      handle(tx, ctx, input) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const definition = assertDefinition(input.definition);
        if (!definition.ok) return definition;
        const existing = tx.sql.get(
          "select id from providers where id = ?",
          [input.id],
        );
        if (existing !== undefined) {
          return conflict("provider id already exists");
        }
        // provider가 앱·MCP의 다른 secret 이름을 가리켜 그 값이 endpoint로 가는 일을 막는다.
        if (
          input.credential !== null &&
          input.credential.secret !== providerSecretName(input.id)
        ) {
          return err({
            code: "invalid_input",
            message: "secret name must be provider.<id>",
          });
        }
        const credential = assertCredential({
          kind: input.auth_kind,
          secret_ref: input.credential === null
            ? null
            : { name: input.credential.secret },
          revision: 1,
          state: "available",
          unavailable_reason: null,
          until: null,
          // OAuth access token의 만료다. API key는 없다.
          expires_at: input.expires_at ?? null,
          // 이 연결의 identity다. Disconnect 뒤 다시 Connect한 것과 구분한다.
          logged_in_at: tx.now(),
          refreshed_at: null,
          model_blocks: [],
          account_models: null,
        });
        if (!credential.ok) return credential;
        const record = assertRecord({
          id: input.id,
          name: input.name,
          definition: definition.value,
          endpoint: input.endpoint,
          protocol: input.protocol,
          credential: credential.value,
          revision: 1,
        });
        if (!record.ok) return record;
        tx.sql.run(
          `insert into providers
            (id, name, definition_key, definition, endpoint, protocol, revision)
           values (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.id,
            input.name,
            definition.value.key,
            JSON.stringify(definition.value),
            input.endpoint,
            input.protocol,
            1,
          ],
        );
        insertCredential(tx, input.id, credential.value);
        return ok({ provider: record.value });
      },
    },
    // Disconnect: 확인 창을 거쳐 provider와 credential(secret 참조)을 함께 지운다. 확인 창의 증거는
    // route의 confirmation 선언을 executor가 검사한다.
    disconnect: {
      route: disconnectProvider,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        tx.sql.run(
          "delete from provider_credential_model_blocks where provider = ?",
          [input.provider],
        );
        tx.sql.run("delete from provider_credentials where provider = ?", [
          input.provider,
        ]);
        tx.sql.run("delete from providers where id = ?", [input.provider]);
        return ok({ provider: input.provider });
      },
    },
    refreshCredential: {
      route: refreshProviderCredential,
      handle(
        tx,
        _ctx,
        input: Input<typeof refreshProviderCredential>,
        compare,
      ) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const existing = current.value.credential;
        let next: ProviderCredential;
        if (input.expires_at !== null) {
          next = {
            ...existing,
            revision: existing.revision + 1,
            expires_at: input.expires_at,
            refreshed_at: tx.now(),
            state: "available",
            unavailable_reason: null,
            until: null,
          };
        } else {
          // 갱신 실패는 안전한 불가 상태만 남긴다. 원문은 어디에도 없다.
          const reason = input.unavailable_reason;
          if (reason === null) {
            return err({
              code: "invalid_input",
              message: "refresh result is empty",
            });
          }
          next = {
            ...existing,
            revision: existing.revision + 1,
            state: reason === "refresh_revoked" ? "revoked" : "rejected",
            unavailable_reason: reason,
          };
        }
        const checked = assertCredential(next);
        if (!checked.ok) return checked;
        const revision = compare.revision + 1;
        updateCredential(tx, input.provider, checked.value);
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision, input.provider, compare.revision],
        );
        return ok({
          provider: {
            ...current.value,
            revision,
            credential: checked.value,
          },
        });
      },
    },
    // 계정이 쓸 수 있는 model 목록만 바꾼다. credential.revision은 올리지 않는다: 그 판은 model 호출 기록이 가리키는 데
    // 쓰이고(credential_revision) 목록을 읽는 일이 호출 기록의 판을 흔들면 안 된다.
    recordAccountModels: {
      route: recordProviderAccountModels,
      handle(
        tx,
        _ctx,
        input: Input<typeof recordProviderAccountModels>,
        compare,
      ) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const models = [...new Set(input.models)].sort();
        const checked = assertCredential({
          ...current.value.credential,
          account_models: models,
        });
        if (!checked.ok) return checked;
        const revision = compare.revision + 1;
        tx.sql.run(
          "update provider_credentials set account_models = ? where provider = ?",
          [JSON.stringify(models), input.provider],
        );
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision, input.provider, compare.revision],
        );
        return ok({
          provider: {
            ...current.value,
            revision,
            credential: checked.value,
          },
        });
      },
    },
    recordAvailability: {
      route: recordProviderAvailability,
      handle(
        tx,
        _ctx,
        input: Input<typeof recordProviderAvailability>,
        compare,
      ) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const existing = current.value.credential;
        const state = nextCredentialState(existing.state, input.state);
        if (!state.ok) return state;
        // model 전용 제한은 그 model 하나의 block만 바꾸고 다른 model의 상태는 건드리지 않는다.
        const blocks = input.model_block === null ? existing.model_blocks : [
          ...existing.model_blocks.filter((block) =>
            block.model_name !== input.model_block!.model_name
          ),
          input.model_block,
        ];
        const checked = assertCredential({
          ...existing,
          state: state.value,
          unavailable_reason: input.unavailable_reason,
          until: input.until,
          revision: existing.revision + 1,
          model_blocks: blocks,
        });
        if (!checked.ok) return checked;
        const revision = compare.revision + 1;
        updateCredential(tx, input.provider, checked.value);
        if (input.model_block !== null) {
          replaceModelBlocks(tx, input.provider, checked.value.model_blocks);
        }
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision, input.provider, compare.revision],
        );
        return ok({
          provider: {
            ...current.value,
            revision,
            credential: checked.value,
          },
        });
      },
    },
  };
}
