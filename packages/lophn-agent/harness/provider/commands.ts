import { err, ok, type Result } from "../../../base/mod.ts";
import {
  providerChanged,
  providerChecked,
  providerRegistered,
  type ProviderCheck,
  type ProviderCredential,
  type ProviderDefinition,
  type ProviderRecord,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  changeProviderCredentials,
  changeProvider,
  recordProviderAvailability,
  recordProviderCheck,
  refreshProviderCredential,
  registerProviderCredential,
  registerProvider,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../../contracts/platform/mod.ts";
import {
  assertCredential,
  assertDefinition,
  assertRecord,
  modelBlocksFromRow,
  nextCredentialState,
  providerFromRow,
} from "./model.ts";

// 등록 순서: 입력 검사 → CAS 비교 → 쓰기 → event. 짧은 transaction 하나.

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "provider not found" });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

// credential 등록·교체·삭제·순서 변경은 사람만 결정한다(provider#R6).
function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : err({
    code: "forbidden",
    message: "provider changes are user only",
  });
}

function requireProvider(tx: Tx, id: string): Result<ProviderRecord> {
  const row = tx.sql.get(
    "select id, name, definition_key, definition, endpoint, protocol, enabled, last_check, revision from providers where id = ?",
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

function definitionKeyOf(definition: ProviderDefinition): string {
  return definition.key;
}

// tx.emit은 seq 문자열을 준다. revision은 양의 정수라 여기서 옮긴다.
function revisionFromSeq(tx: Tx, seq: string): Result<number> {
  const parsed = Number(seq);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    void tx;
    return err({ code: "internal", message: "invalid event seq" });
  }
  return ok(parsed);
}

function storeCredential(
  tx: Tx,
  providerId: string,
  value: ProviderCredential,
): void {
  const existing = tx.sql.get(
    "select key from provider_credentials where provider = ? and key = ?",
    [providerId, value.key],
  );
  const secretName = value.secret_ref?.name ?? null;
  const secretSealedRef = value.secret_ref?.sealed_ref ?? null;
  const secretRevision = value.secret_ref?.revision ?? null;
  if (existing === undefined) {
    tx.sql.run(
      `insert into provider_credentials
        (provider, key, kind, label, secret_name, secret_sealed_ref, secret_revision,
         revision, order_index, enabled, account, organization, plan,
         dedup_fingerprint, dedup_product, state, unavailable_reason, until,
         expires_at, logged_in_at, refreshed_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        providerId,
        value.key,
        value.kind,
        value.label,
        secretName,
        secretSealedRef,
        secretRevision,
        value.revision,
        value.order,
        value.enabled ? 1 : 0,
        value.account,
        value.organization,
        value.plan,
        value.dedup_fingerprint,
        value.dedup_fingerprint === null ? null : value.dedup_fingerprint,
        value.state,
        value.unavailable_reason,
        value.until,
        value.expires_at,
        value.logged_in_at,
        value.refreshed_at,
      ],
    );
    return;
  }
  // identity(provider·key·kind)는 SET에 넣지 않는다. trigger가 같은 값도 막는다.
  tx.sql.run(
    `update provider_credentials set
       label = ?, secret_name = ?, secret_sealed_ref = ?, secret_revision = ?,
       revision = ?, order_index = ?, enabled = ?, account = ?, organization = ?, plan = ?,
       dedup_fingerprint = ?, dedup_product = ?, state = ?, unavailable_reason = ?, until = ?,
       expires_at = ?, logged_in_at = ?, refreshed_at = ?
     where provider = ? and key = ?`,
    [
      value.label,
      secretName,
      secretSealedRef,
      secretRevision,
      value.revision,
      value.order,
      value.enabled ? 1 : 0,
      value.account,
      value.organization,
      value.plan,
      value.dedup_fingerprint,
      value.dedup_fingerprint === null ? null : value.dedup_fingerprint,
      value.state,
      value.unavailable_reason,
      value.until,
      value.expires_at,
      value.logged_in_at,
      value.refreshed_at,
      providerId,
      value.key,
    ],
  );
}

function refreshModelBlocks(
  tx: Tx,
  providerId: string,
  credentialKey: string,
  blocks: ProviderCredential["model_blocks"],
): void {
  tx.sql.run(
    "delete from provider_credential_model_blocks where provider = ? and credential_key = ?",
    [providerId, credentialKey],
  );
  for (const block of blocks) {
    tx.sql.run(
      `insert into provider_credential_model_blocks
        (provider, credential_key, model_name, reason, until)
       values (?, ?, ?, ?, ?)`,
      [providerId, credentialKey, block.model_name, block.reason, block.until],
    );
  }
}

export function createProviderCommands(): {
  register: CommandDefinition<typeof registerProvider>;
  change: CommandDefinition<typeof changeProvider>;
  registerCredential: CommandDefinition<typeof registerProviderCredential>;
  changeCredentials: CommandDefinition<typeof changeProviderCredentials>;
  refreshCredential: CommandDefinition<typeof refreshProviderCredential>;
  recordAvailability: CommandDefinition<typeof recordProviderAvailability>;
  recordCheck: CommandDefinition<typeof recordProviderCheck>;
} {
  return {
    register: {
      route: registerProvider,
      handle(tx, _ctx, input) {
        const definition = assertDefinition(input.definition);
        if (!definition.ok) return definition;
        const existing = tx.sql.get(
          "select id from providers where id = ?",
          [input.id],
        );
        if (existing !== undefined) {
          return conflict("provider id already exists");
        }
        // 같은 endpoint는 새 provider다. 진행 run의 이동은 없다(domain model).
        const seq = tx.emit(providerRegistered, input.id, {
          name: input.name,
          endpoint: input.endpoint,
          protocol: input.protocol,
          definition_revision: input.definition.revision,
        });
        const revision = revisionFromSeq(tx, seq);
        if (!revision.ok) return revision;
        const record = assertRecord({
          id: input.id,
          name: input.name,
          definition: definition.value,
          endpoint: input.endpoint,
          protocol: input.protocol,
          enabled: true,
          credentials: [],
          last_check: null,
          revision: revision.value,
        });
        if (!record.ok) return record;
        tx.sql.run(
          `insert into providers
            (id, name, definition_key, definition, endpoint, protocol, enabled, last_check, revision)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.id,
            input.name,
            definitionKeyOf(definition.value),
            JSON.stringify(definition.value),
            input.endpoint,
            input.protocol,
            1,
            null,
            revision.value,
          ],
        );
        return ok({ provider: record.value });
      },
    },
    change: {
      route: changeProvider,
      handle(tx, _ctx, input, compare) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const name = input.name ?? current.value.name;
        const enabled = input.enabled ?? current.value.enabled;
        const seq = tx.emit(providerChanged, input.provider, {
          revision: compare.revision + 1,
          credential_key: null,
          credential_revision: null,
          state: null,
        });
        const revision = revisionFromSeq(tx, seq);
        if (!revision.ok) return revision;
        const record = assertRecord({
          ...current.value,
          name,
          enabled,
          revision: revision.value,
        });
        if (!record.ok) return record;
        tx.sql.run(
          "update providers set name = ?, enabled = ?, revision = ? where id = ? and revision = ?",
          [name, enabled ? 1 : 0, revision.value, input.provider, compare.revision],
        );
        return ok({ provider: record.value });
      },
    },
    registerCredential: {
      route: registerProviderCredential,
      handle(tx, ctx, input: Input<typeof registerProviderCredential>, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const duplicateKey = current.value.credentials.find((credential) =>
          credential.key === input.key
        );
        if (duplicateKey !== undefined) {
          return conflict("credential key already exists");
        }
        // 중복 검사는 같은 provider 안에서 fingerprint로 한다(provider#R9).
        const duplicateFingerprint = current.value.credentials.find((
          credential,
        ) =>
          credential.dedup_fingerprint !== null &&
          credential.dedup_fingerprint === input.dedup_fingerprint
        );
        if (duplicateFingerprint !== undefined) {
          return conflict("credential already registered");
        }
        // 확인되지 않은 계정 정보는 추측하지 않는다. 들어온 값만 남긴다.
        const order = current.value.credentials.length;
        const seq = tx.emit(providerChanged, input.provider, {
          revision: compare.revision + 1,
          credential_key: input.key,
          credential_revision: 1,
          state: "available",
        });
        const revision = revisionFromSeq(tx, seq);
        if (!revision.ok) return revision;
        const credential = assertCredential({
          key: input.key,
          kind: input.kind,
          label: input.label,
          secret_ref: {
            name: secretNameForProvider(input.provider),
            sealed_ref: input.preparation.sealed_ref,
            revision: 1,
          },
          revision: 1,
          order,
          enabled: true,
          account: input.account,
          organization: input.organization,
          plan: input.plan,
          dedup_fingerprint: input.dedup_fingerprint,
          state: "available",
          unavailable_reason: null,
          until: null,
          expires_at: null,
          logged_in_at: null,
          refreshed_at: null,
          model_blocks: [],
        });
        if (!credential.ok) return credential;
        storeCredential(tx, input.provider, credential.value);
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision.value, input.provider, compare.revision],
        );
        return ok({ provider: { ...current.value, revision: revision.value } });
      },
    },
    changeCredentials: {
      route: changeProviderCredentials,
      handle(tx, ctx, input: Input<typeof changeProviderCredentials>, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        let working = current.value;
        for (const change of input.credentials) {
          const existing = working.credentials.find((credential) =>
            credential.key === change.key
          );
          if (existing === undefined) return notFound();
          if (existing.revision !== change.revision) {
            return conflict("credential revision changed");
          }
        }
        // 회수·교체·순서와 enabled를 한 handler에서 옮긴다. 순서는 전체 unique다.
        const orders = new Set(input.credentials.map((c) => c.order));
        if (orders.size !== input.credentials.length) {
          return invalid("duplicate order");
        }
        for (const change of input.credentials) {
          const existing = working.credentials.find((credential) =>
            credential.key === change.key
          )!;
          let next: ProviderCredential;
          if (change.revoke) {
            const state = nextCredentialState(existing.state, "revoked");
            if (!state.ok) return state;
            next = {
              ...existing,
              state: state.value,
              unavailable_reason: "authentication",
              revision: existing.revision + 1,
            };
          } else if (change.replacement !== null) {
            next = {
              ...existing,
              secret_ref: {
                name: existing.secret_ref?.name ?? secretNameForProvider(
                  input.provider,
                ),
                sealed_ref: change.replacement.sealed_ref,
                revision: (existing.secret_ref?.revision ?? 0) + 1,
              },
              revision: existing.revision + 1,
              state: "available",
              unavailable_reason: null,
              until: null,
            };
          } else {
            next = {
              ...existing,
              enabled: change.enabled ?? existing.enabled,
              order: change.order,
            };
          }
          const checked = assertCredential(next);
          if (!checked.ok) return checked;
          working = {
            ...working,
            credentials: working.credentials.map((credential) =>
              credential.key === change.key ? checked.value : credential
            ),
          };
        }
        // 남은 credential의 순서도 유니크를 유지해야 한다.
        const untouchedOrders = working.credentials
          .filter((credential) =>
            !input.credentials.some((change) => change.key === credential.key)
          )
          .map((credential) => credential.order);
        const changedOrders = input.credentials.map((c) => c.order);
        const allOrders = [...untouchedOrders, ...changedOrders];
        if (new Set(allOrders).size !== allOrders.length) {
          return invalid("order overlaps an untouched credential");
        }
        const seq = tx.emit(providerChanged, input.provider, {
          revision: compare.revision + 1,
          credential_key: input.credentials[0]!.key,
          credential_revision: null,
          state: null,
        });
        const revision = revisionFromSeq(tx, seq);
        if (!revision.ok) return revision;
        for (const change of input.credentials) {
          const next = working.credentials.find((credential) =>
            credential.key === change.key
          )!;
          storeCredential(tx, input.provider, next);
        }
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision.value, input.provider, compare.revision],
        );
        const updated = { ...current.value, revision: revision.value };
        for (const change of input.credentials) {
          const found = working.credentials.find((c) => c.key === change.key);
          if (found) {
            updated.credentials = updated.credentials.map((c) =>
              c.key === found.key ? found : c
            );
          }
        }
        return ok({ provider: updated });
      },
    },
    refreshCredential: {
      route: refreshProviderCredential,
      handle(tx, _ctx, input: Input<typeof refreshProviderCredential>, compare) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const existing = current.value.credentials.find((credential) =>
          credential.key === input.key
        );
        if (existing === undefined) return notFound();
        if (existing.revision !== compare.revision) {
          return conflict("credential revision changed");
        }
        let next: ProviderCredential;
        if (input.preparation !== null && input.expires_at !== null) {
          next = {
            ...existing,
            secret_ref: {
              name: existing.secret_ref?.name ?? secretNameForProvider(
                input.provider,
              ),
              sealed_ref: input.preparation.sealed_ref,
              revision: (existing.secret_ref?.revision ?? 0) + 1,
            },
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
          if (reason === null) return invalid("refresh result is empty");
          next = {
            ...existing,
            revision: existing.revision + 1,
            state: reason === "refresh_revoked" ? "revoked" : "rejected",
            unavailable_reason: reason,
          };
        }
        const checked = assertCredential(next);
        if (!checked.ok) return checked;
        const seq = tx.emit(providerChanged, input.provider, {
          revision: compare.revision + 1,
          credential_key: input.key,
          credential_revision: next.revision,
          state: next.state,
        });
        const revision = revisionFromSeq(tx, seq);
        if (!revision.ok) return revision;
        storeCredential(tx, input.provider, checked.value);
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision.value, input.provider, compare.revision],
        );
        return ok({
          provider: {
            ...current.value,
            revision: revision.value,
            credentials: current.value.credentials.map((c) =>
              c.key === checked.value.key ? checked.value : c
            ),
          },
        });
      },
    },
    recordAvailability: {
      route: recordProviderAvailability,
      handle(tx, _ctx, input: Input<typeof recordProviderAvailability>, compare) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const existing = current.value.credentials.find((credential) =>
          credential.key === input.key
        );
        if (existing === undefined) return notFound();
        const state = nextCredentialState(existing.state, input.state);
        if (!state.ok) return state;
        let next: ProviderCredential = {
          ...existing,
          state: state.value,
          unavailable_reason: input.unavailable_reason,
          until: input.until,
          revision: existing.revision + 1,
        };
        if (input.model_block !== null) {
          const blocks = [
            ...modelBlocksFromRow(tx.sql, input.provider, input.key)
              .filter((block) => block.model_name !== input.model_block!.model_name),
            input.model_block,
          ];
          refreshModelBlocks(tx, input.provider, input.key, blocks);
          next = { ...next, model_blocks: blocks };
        } else if (input.model_block === null && input.state === "available") {
          // 회복은 해당 model block만 지운다. 다른 model block은 남는다(provider#R22).
          refreshModelBlocks(tx, input.provider, input.key, existing.model_blocks);
        }
        const checked = assertCredential(next);
        if (!checked.ok) return checked;
        const seq = tx.emit(providerChanged, input.provider, {
          revision: compare.revision + 1,
          credential_key: input.key,
          credential_revision: next.revision,
          state: next.state,
        });
        const revision = revisionFromSeq(tx, seq);
        if (!revision.ok) return revision;
        storeCredential(tx, input.provider, checked.value);
        tx.sql.run(
          "update providers set revision = ? where id = ? and revision = ?",
          [revision.value, input.provider, compare.revision],
        );
        return ok({
          provider: {
            ...current.value,
            revision: revision.value,
            credentials: current.value.credentials.map((c) =>
              c.key === checked.value.key ? withBlocks(checked.value, input.provider, tx) : c
            ),
          },
        });
      },
    },
    recordCheck: {
      route: recordProviderCheck,
      handle(tx, _ctx, input: Input<typeof recordProviderCheck>, compare) {
        const current = requireProvider(tx, input.provider);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        // 명시적 test만 last_check를 갱신한다(domain model). 설정 조회는 갱신하지 않는다.
        const check: ProviderCheck = input.check;
        const seq = tx.emit(providerChecked, input.provider, check);
        const revision = revisionFromSeq(tx, seq);
        if (!revision.ok) return revision;
        tx.sql.run(
          "update providers set last_check = ?, revision = ? where id = ? and revision = ?",
          [JSON.stringify(check), revision.value, input.provider, compare.revision],
        );
        return ok({
          provider: {
            ...current.value,
            last_check: check,
            revision: revision.value,
          },
        });
      },
    },
  };
}

function withBlocks(
  credential: ProviderCredential,
  providerId: string,
  tx: Tx,
): ProviderCredential {
  return {
    ...credential,
    model_blocks: modelBlocksFromRow(tx.sql, providerId, credential.key),
  };
}

// secret 이름은 provider별 하나다. key가 아니라 provider를 가리킨다.
function secretNameForProvider(provider: string): string {
  return `provider.${provider.replace(/^pvd_/, "")}`;
}

