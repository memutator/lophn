import { err, ok, type Result } from "../../../base/mod.ts";
import {
  activateProviderCredential,
  addProviderCredential,
  connectProvider,
  disconnectProvider,
  loginCancel,
  type ProviderAccount,
  type ProviderCredential,
  type ProviderRecord,
  recordProviderAvailability,
  recordProviderModels,
  refreshProviderCredential,
  refreshProviderModels,
  removeProviderCredential,
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
  endpointForCredential,
  nextCredentialState,
  providerFromRow,
} from "./model.ts";
import { defaultCredentialId, providerSecretName } from "./oauth-secrets.ts";

// 등록 순서: 입력 검사 → CAS 비교 → 쓰기 → event. 짧은 transaction 하나.
// provider 아래에 여러 credential(다계정 OAuth + 다중 API key)을 두고 그중 활성(active) 1개를 쓴다.

function notFound(message = "provider not found"): Result<never> {
  return err({ code: "not_found", message });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

// Connect, Disconnect와 credential 추가·전환·삭제는 사람만 결정한다.
function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user"
    ? ok(undefined)
    : err({
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

function findTargetCredential(
  provider: ProviderRecord,
  credentialId: string | undefined,
): Result<ProviderCredential> {
  if (credentialId === undefined) return ok(provider.credential);
  const found = provider.credentials.find((item) => item.id === credentialId);
  return found === undefined ? notFound("credential not found") : ok(found);
}

// 같은 provider 안에서 같은 OAuth 계정인지 판정한다. id가 있으면 id로, 없으면 email(대소문자 무시)로 비교한다.
function sameOAuthAccount(
  existing: ProviderAccount | null,
  incoming: ProviderAccount | null,
): boolean {
  if (existing === null || incoming === null) return false;
  if (existing.id !== null && incoming.id !== null) {
    return existing.id === incoming.id;
  }
  if (existing.email !== null && incoming.email !== null) {
    return existing.email.toLowerCase() === incoming.email.toLowerCase();
  }
  return false;
}

function insertCredential(
  tx: Tx,
  providerId: string,
  value: ProviderCredential,
): void {
  tx.sql.run(
    `insert into provider_credentials
      (id, provider, active, kind, secret_name, label, key_hint, revision,
       state, unavailable_reason, until, expires_at, logged_in_at, refreshed_at, account)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      value.id,
      providerId,
      value.active ? 1 : 0,
      value.kind,
      value.secret_ref?.name ?? null,
      value.label,
      value.key_hint,
      value.revision,
      value.state,
      value.unavailable_reason,
      value.until,
      value.expires_at,
      value.logged_in_at,
      value.refreshed_at,
      value.account === null ? null : JSON.stringify(value.account),
    ],
  );
}

// identity(id·provider·kind)는 SET에 넣지 않는다. trigger가 같은 값도 막는다.
function updateCredential(tx: Tx, value: ProviderCredential): void {
  tx.sql.run(
    `update provider_credentials set
       active = ?, secret_name = ?, label = ?, key_hint = ?, revision = ?,
       state = ?, unavailable_reason = ?, until = ?, expires_at = ?,
       logged_in_at = ?, refreshed_at = ?, account = ?
     where id = ?`,
    [
      value.active ? 1 : 0,
      value.secret_ref?.name ?? null,
      value.label,
      value.key_hint,
      value.revision,
      value.state,
      value.unavailable_reason,
      value.until,
      value.expires_at,
      value.logged_in_at,
      value.refreshed_at,
      value.account === null ? null : JSON.stringify(value.account),
      value.id,
    ],
  );
}

// model block은 바꿀 때 통째로 교체한다.
function replaceModelBlocks(
  tx: Tx,
  credentialId: string,
  blocks: ProviderCredential["model_blocks"],
): void {
  tx.sql.run(
    "delete from provider_credential_model_blocks where credential = ?",
    [credentialId],
  );
  for (const block of blocks) {
    tx.sql.run(
      `insert into provider_credential_model_blocks
        (credential, model_name, reason, until) values (?, ?, ?, ?)`,
      [credentialId, block.model_name, block.reason, block.until],
    );
  }
}

export function createProviderCommands(): {
  connect: CommandDefinition<typeof connectProvider>;
  addCredential: CommandDefinition<typeof addProviderCredential>;
  activateCredential: CommandDefinition<typeof activateProviderCredential>;
  removeCredential: CommandDefinition<typeof removeProviderCredential>;
  disconnect: CommandDefinition<typeof disconnectProvider>;
  refreshCredential: CommandDefinition<typeof refreshProviderCredential>;
  recordAvailability: CommandDefinition<typeof recordProviderAvailability>;
  recordModels: CommandDefinition<typeof recordProviderModels>;
  refreshModels: CommandDefinition<typeof refreshProviderModels>;
  cancelLogin: CommandDefinition<typeof loginCancel>;
} {
  return {
    // 목록 읽기는 network를 쓰므로 writer queue 앞의 처리기가 돌린다. 이 등록은 경로만 열어 둔다.
    refreshModels: {
      route: refreshProviderModels,
      handle() {
        return err({
          code: "unavailable",
          message: "provider model refresh runs outside the ledger writer",
        });
      },
    },
    // 로그인 취소는 writer queue 앞의 처리기가 실제로 돌린다(withProviderLogin). 이 등록은 경로를 route registry에 열어 두는 자리다.
    cancelLogin: {
      route: loginCancel,
      handle() {
        return err({
          code: "unavailable",
          message: "provider login runs outside the ledger writer",
        });
      },
    },
    // Connect: provider와 첫 credential 하나를 함께 둔다. secret 값은 이미 secrets.json에 있고 이름만 받는다.
    connect: {
      route: connectProvider,
      handle(tx, ctx, input) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const definition = assertDefinition(input.definition);
        if (!definition.ok) return definition;
        const existing = tx.sql.get("select id from providers where id = ?", [
          input.id,
        ]);
        if (existing !== undefined) {
          return conflict("provider id already exists");
        }
        const credentialId =
          input.credential_id ?? defaultCredentialId(input.id);
        // provider가 앱·MCP의 다른 secret 이름을 가리켜 그 값이 endpoint로 가는 일을 막는다.
        if (
          input.credential !== null &&
          input.credential.secret !== providerSecretName(credentialId)
        ) {
          return err({
            code: "invalid_input",
            message: "secret name must be provider.<credential_id>",
          });
        }
        const credential = assertCredential({
          id: credentialId as ProviderCredential["id"],
          active: true,
          kind: input.auth_kind,
          secret_ref:
            input.credential === null
              ? null
              : { name: input.credential.secret },
          label: input.label ?? null,
          key_hint: input.key_hint ?? null,
          revision: 1,
          state: "available",
          unavailable_reason: null,
          until: null,
          // OAuth access token의 만료다. API key는 없다.
          expires_at: input.expires_at ?? null,
          // 이 연결의 identity다.
          logged_in_at: tx.now(),
          refreshed_at: null,
          model_blocks: [],
          reported_models: null,
          account: input.account ?? null,
        });
        if (!credential.ok) return credential;
        const record = assertRecord({
          id: input.id,
          name: input.name,
          definition: definition.value,
          endpoint: input.endpoint,
          protocol: input.protocol,
          credential: credential.value,
          credentials: [credential.value],
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
    // AddCredential: 이미 연결된 provider에 새 credential을 추가한다. 같은 OAuth 계정이면 중복 대신 갱신한다.
    addCredential: {
      route: addProviderCredential,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        if (!current.value.definition.auth_kinds.includes(input.auth_kind)) {
          return err({
            code: "invalid_input",
            message: "auth_kind is not supported by this provider definition",
          });
        }
        const remote = current.value.endpoint.startsWith("https://");
        if (remote && input.auth_kind === "none") {
          return err({
            code: "invalid_input",
            message: "remote provider requires a credential",
          });
        }
        const activate = input.activate !== false;
        const incomingAccount = input.account ?? null;
        const matched =
          input.auth_kind === "oauth"
            ? current.value.credentials.find(
                (item) =>
                  item.kind === "oauth" &&
                  sameOAuthAccount(item.account, incomingAccount),
              )
            : undefined;
        let targetId: string;
        let activeKind = current.value.credential.kind;
        if (matched !== undefined) {
          targetId = matched.id;
          if (
            input.credential !== null &&
            input.credential.secret !== providerSecretName(matched.id) &&
            input.credential.secret !== providerSecretName(input.credential_id)
          ) {
            return err({
              code: "invalid_input",
              message: "secret name must be provider.<credential_id>",
            });
          }
          const nextActive = activate ? true : matched.active;
          const updated = assertCredential({
            ...matched,
            active: nextActive,
            secret_ref: { name: providerSecretName(matched.id) },
            label: input.label !== undefined ? input.label : matched.label,
            revision: matched.revision + 1,
            state: "available",
            unavailable_reason: null,
            until: null,
            expires_at: input.expires_at ?? null,
            logged_in_at: tx.now(),
            refreshed_at: null,
            account: incomingAccount,
          });
          if (!updated.ok) return updated;
          if (activate && !matched.active) {
            tx.sql.run(
              "update provider_credentials set active = 0 where provider = ? and active = 1",
              [input.provider],
            );
          }
          updateCredential(tx, updated.value);
          if (nextActive) activeKind = updated.value.kind;
        } else {
          targetId = input.credential_id;
          if (
            current.value.credentials.some(
              (item) => item.id === input.credential_id,
            )
          ) {
            return conflict("credential id already exists");
          }
          if (
            input.credential !== null &&
            input.credential.secret !== providerSecretName(input.credential_id)
          ) {
            return err({
              code: "invalid_input",
              message: "secret name must be provider.<credential_id>",
            });
          }
          const created = assertCredential({
            id: input.credential_id as ProviderCredential["id"],
            active: activate,
            kind: input.auth_kind,
            secret_ref:
              input.credential === null
                ? null
                : { name: input.credential.secret },
            label: input.label ?? null,
            key_hint: input.key_hint ?? null,
            revision: 1,
            state: "available",
            unavailable_reason: null,
            until: null,
            expires_at: input.expires_at ?? null,
            logged_in_at: tx.now(),
            refreshed_at: null,
            model_blocks: [],
            reported_models: null,
            account: incomingAccount,
          });
          if (!created.ok) return created;
          if (activate) {
            tx.sql.run(
              "update provider_credentials set active = 0 where provider = ? and active = 1",
              [input.provider],
            );
          }
          insertCredential(tx, input.provider, created.value);
          if (activate) activeKind = created.value.kind;
        }
        const nextEndpoint = endpointForCredential(
          current.value.definition,
          current.value.endpoint,
          activeKind,
        );
        const revision = compare.revision + 1;
        tx.sql.run(
          "update providers set endpoint = ?, revision = ? where id = ? and revision = ?",
          [nextEndpoint, revision, input.provider, compare.revision],
        );
        const reloaded = requireProvider(tx, input.provider);
        if (!reloaded.ok) return reloaded;
        return ok({
          provider: reloaded.value,
          credential_id: targetId as ProviderCredential["id"],
        });
      },
    },
    // ActivateCredential: 등록된 credential 중 하나를 활성(active)으로 전환한다.
    activateCredential: {
      route: activateProviderCredential,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const target = current.value.credentials.find(
          (item) => item.id === input.credential,
        );
        if (target === undefined) return notFound("credential not found");
        if (target.active) {
          return ok({ provider: current.value });
        }
        tx.sql.run(
          "update provider_credentials set active = 0 where provider = ? and active = 1",
          [input.provider],
        );
        tx.sql.run("update provider_credentials set active = 1 where id = ?", [
          target.id,
        ]);
        const nextEndpoint = endpointForCredential(
          current.value.definition,
          current.value.endpoint,
          target.kind,
        );
        const revision = compare.revision + 1;
        tx.sql.run(
          "update providers set endpoint = ?, revision = ? where id = ? and revision = ?",
          [nextEndpoint, revision, input.provider, compare.revision],
        );
        const reloaded = requireProvider(tx, input.provider);
        if (!reloaded.ok) return reloaded;
        return ok({ provider: reloaded.value });
      },
    },
    // RemoveCredential: credential 하나를 지운다. 마지막 하나는 DisconnectProvider로 끊어야 한다.
    removeCredential: {
      route: removeProviderCredential,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const target = current.value.credentials.find(
          (item) => item.id === input.credential,
        );
        if (target === undefined) return notFound("credential not found");
        if (current.value.credentials.length <= 1) {
          return conflict(
            "cannot remove the last credential; disconnect the provider instead",
          );
        }
        tx.sql.run(
          "delete from provider_credential_model_blocks where credential = ?",
          [target.id],
        );
        tx.sql.run("delete from provider_credentials where id = ?", [
          target.id,
        ]);
        let activeKind = current.value.credential.kind;
        if (target.active) {
          const remaining = current.value.credentials
            .filter((item) => item.id !== target.id)
            .sort((a, b) => {
              const ta = a.logged_in_at ?? "";
              const tb = b.logged_in_at ?? "";
              if (ta !== tb) return tb.localeCompare(ta);
              return b.id.localeCompare(a.id);
            });
          const successor = remaining[0]!;
          tx.sql.run(
            "update provider_credentials set active = 1 where id = ?",
            [successor.id],
          );
          activeKind = successor.kind;
        }
        const nextEndpoint = endpointForCredential(
          current.value.definition,
          current.value.endpoint,
          activeKind,
        );
        const revision = compare.revision + 1;
        tx.sql.run(
          "update providers set endpoint = ?, revision = ? where id = ? and revision = ?",
          [nextEndpoint, revision, input.provider, compare.revision],
        );
        const reloaded = requireProvider(tx, input.provider);
        if (!reloaded.ok) return reloaded;
        return ok({
          provider: reloaded.value,
          removed_credential: target.id,
        });
      },
    },
    // Disconnect: 확인 창을 거쳐 provider와 모든 credential(secret 참조)을 함께 지운다.
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
          `delete from provider_credential_model_blocks
            where credential in (select id from provider_credentials where provider = ?)`,
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
        const target = findTargetCredential(current.value, input.credential);
        if (!target.ok) return target;
        const existing = target.value;
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
        updateCredential(tx, checked.value);
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision, input.provider, compare.revision],
        );
        const reloaded = requireProvider(tx, input.provider);
        if (!reloaded.ok) return reloaded;
        return ok({ provider: reloaded.value });
      },
    },
    // provider가 알려 준 model 목록만 바꾼다. credential.revision은 올리지 않는다: 그 판은 model 호출 기록이 가리키는 데
    // 쓰이고(credential_revision) 목록을 읽는 일이 호출 기록의 판을 흔들면 안 된다.
    recordModels: {
      route: recordProviderModels,
      handle(tx, _ctx, input: Input<typeof recordProviderModels>, compare) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const target = findTargetCredential(current.value, input.credential);
        if (!target.ok) return target;
        const models = [...new Set(input.models)].sort();
        // 한도는 이름 순으로 저장해 같은 읽기가 같은 JSON이 되게 한다. 없으면 앞서 저장한 한도를 지운다.
        const limitEntries = Object.entries(input.model_limits ?? {});
        limitEntries.sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        );
        const limits = Object.fromEntries(limitEntries);
        const credential = {
          ...target.value,
          reported_models: models,
        };
        delete credential.reported_model_limits;
        if (limitEntries.length > 0) {
          credential.reported_model_limits = limits;
        }
        const checked = assertCredential(credential);
        if (!checked.ok) return checked;
        const revision = compare.revision + 1;
        tx.sql.run(
          "update provider_credentials set reported_models = ?, reported_model_limits = ? where id = ?",
          [
            JSON.stringify(models),
            limitEntries.length === 0 ? null : JSON.stringify(limits),
            target.value.id,
          ],
        );
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision, input.provider, compare.revision],
        );
        const reloaded = requireProvider(tx, input.provider);
        if (!reloaded.ok) return reloaded;
        return ok({ provider: reloaded.value });
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
        const target = findTargetCredential(current.value, input.credential);
        if (!target.ok) return target;
        const existing = target.value;
        const state = nextCredentialState(existing.state, input.state);
        if (!state.ok) return state;
        // model 전용 제한은 그 model 하나의 block만 바꾸고 다른 model의 상태는 건드리지 않는다.
        const blocks =
          input.model_block === null
            ? existing.model_blocks
            : [
                ...existing.model_blocks.filter(
                  (block) => block.model_name !== input.model_block!.model_name,
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
        updateCredential(tx, checked.value);
        if (input.model_block !== null) {
          replaceModelBlocks(tx, existing.id, checked.value.model_blocks);
        }
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision, input.provider, compare.revision],
        );
        const reloaded = requireProvider(tx, input.provider);
        if (!reloaded.ok) return reloaded;
        return ok({ provider: reloaded.value });
      },
    },
  };
}
