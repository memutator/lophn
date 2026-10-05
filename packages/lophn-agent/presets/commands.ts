import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import { createHash } from "node:crypto";
import {
  createPreset,
  presetCreated,
  presetRevised,
  registerDefaultPreset,
  revisePreset,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import type { PresetDefinition } from "../../contracts/lophn-agent/mod.ts";
import { nameKey, parseDefinition } from "./model.ts";
import { validateDefinition, type ValidateDeps } from "./validate.ts";

// 등록 순서: 입력 검사 → 전체 검사(R11) → CAS 비교 → 쓰기 → event. 짧은
// transaction 하나다. 실패하면 이전 판 전체가 유지된다(R12).

function reject(
  code: "invalid_input" | "conflict" | "not_found" | "forbidden",
  message: string,
): Result<never> {
  return err({ code, message });
}

// CreatePreset·RevisePreset은 사람만 저장한다(assignment를 옮기지 않는다). agent는
// lophn-agent/questions로 변경 제안만 한다(domain model command 표).
function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : err({
    code: "forbidden",
    message: "preset changes are user only",
  });
}

// RegisterDefaultPreset은 machine만 보낸다(T8이 역할별 기본 preset을 등록한다).
function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : err({
    code: "forbidden",
    message: "default presets are machine only",
  });
}

type PresetRow = {
  id: string;
  kind: string;
  origin: string;
  name: string;
  name_key: string;
  prompt: string;
  revision: number;
};

function rowOf(row: Record<string, unknown>): PresetRow {
  return {
    id: String(row["id"]),
    kind: String(row["kind"]),
    origin: String(row["origin"]),
    name: String(row["name"]),
    name_key: String(row["name_key"]),
    prompt: String(row["prompt"]),
    revision: Number(row["revision"]),
  };
}

function loadPreset(tx: Tx, id: string): PresetRow | undefined {
  const row = tx.sql.get(
    "select id, kind, origin, name, name_key, prompt, revision from presets where id = ?",
    [id],
  );
  return row === undefined ? undefined : rowOf(row);
}

// user preset의 이름 중복과 product 표시 이름 충돌은 command 검사에서 본다(R3).
// product preset은 kind마다 하나라 partial unique index가 지킨다.

function definitionHash(definition: PresetDefinition): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

// deps는 고정 값이거나 handler tx를 받는 factory다. factory는 같은 Tx의 provider
// 기록 조회(provider 표, provider_credentials 표)로 credential과 provider 정의
// key를 채운다. factory의 조회 실패·없는 대상은 빈 목록·undefined로 fail-closed다.
export function createPresetCommands(
  deps: ValidateDeps | ((tx: Tx) => ValidateDeps),
): {
  registerDefault: CommandDefinition<typeof registerDefaultPreset>;
  create: CommandDefinition<typeof createPreset>;
  revise: CommandDefinition<typeof revisePreset>;
} {
  const resolve = (tx: Tx): ValidateDeps =>
    typeof deps === "function" ? deps(tx) : deps;
  return {
    registerDefault: {
      route: registerDefaultPreset,
      handle(tx, _ctx, input: Input<typeof registerDefaultPreset>) {
        const machine = requireMachine(_ctx);
        if (!machine.ok) return machine;
        const parsed = parseDefinition(input.definition);
        if (!parsed.ok) return parsed;
        const definition: PresetDefinition = parsed.value;
        // 같은 id의 재전송은 기존 결과다(domain model command 표). user 판은
        // 갱신 금지다.
        const existing = loadPreset(tx, input.id);
        if (existing !== undefined) {
          const same = existing.origin === "product" &&
            existing.kind === definition.kind;
          if (!same) {
            return reject("conflict", "preset id already exists");
          }
          const revision = loadRevision(tx, input.id, existing.revision);
          if (revision === undefined) {
            return reject("not_found", "preset revision is missing");
          }
          return ok({ preset: { ...revision, id: input.id } });
        }
        // product preset은 역할별 하나다. 다른 id의 같은 kind는 거절이다.
        const sameKind = tx.sql.get(
          "select id from presets where origin = 'product' and kind = ?",
          [definition.kind],
        );
        if (sameKind !== undefined) {
          return reject(
            "conflict",
            "a default preset for this kind already exists",
          );
        }
        const hash = definitionHash(definition);
        if (hash !== input.definition_hash) {
          return reject("invalid_input", "definition hash does not match");
        }
        const promptHash = definition.prompt;
        const createdAt = tx.now();
        const seq = tx.emit(presetCreated, input.id, {
          kind: definition.kind,
          origin: "product",
          revision: 1,
          definition_hash: hash,
          definition,
        });
        void seq;
        tx.sql.run(
          `insert into presets (id, kind, origin, name, name_key, prompt, revision)
           values (?, ?, 'product', ?, ?, ?, 1)`,
          [
            input.id,
            definition.kind,
            definition.name,
            nameKey(definition.name),
            definition.prompt,
          ],
        );
        tx.sql.run(
          `insert into preset_revisions
            (preset_id, revision, definition, definition_hash, prompt_hash,
             decided_by, proposed_by, reason, before_revision, before_hash, created_at)
           values (?, 1, ?, ?, ?, ?, ?, ?, null, null, ?)`,
          [
            input.id,
            JSON.stringify(definition),
            hash,
            promptHash,
            _ctx.principal,
            _ctx.principal,
            "product seed",
            createdAt,
          ],
        );
        return ok({
          preset: {
            id: input.id,
            revision: 1,
            definition,
            definition_hash: hash,
          },
        });
      },
    },
    create: {
      route: createPreset,
      handle(tx, ctx, input: Input<typeof createPreset>, _compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const parsed = parseDefinition(input.definition);
        if (!parsed.ok) return parsed;
        const definition: PresetDefinition = parsed.value;
        // 전체 검사이다. 하나라도 잘못되면 저장 전체를 거절한다(R11).
        const checked = validateDefinition(definition, resolve(tx));
        if (!checked.ok) return checked;
        const existing = loadPreset(tx, input.id);
        if (existing !== undefined) {
          return reject("conflict", "preset id already exists");
        }
        // 이름 중복은 대소문자·공백을 무시해 거절한다(R3).
        const named = tx.sql.get(
          "select id from presets where origin = 'user' and name_key = ?",
          [nameKey(definition.name)],
        );
        if (named !== undefined) {
          return reject("conflict", "a person preset already uses this name");
        }
        const productNamed = tx.sql.get(
          "select id from presets where origin = 'product' and name_key = ?",
          [nameKey(definition.name)],
        );
        if (productNamed !== undefined) {
          return reject(
            "conflict",
            "the default preset already uses this display name. choose another name",
          );
        }
        // 복사는 구성만 복사한다(R10). copied_from은 근거로 남긴다.
        if (input.copied_from !== null) {
          const source = loadRevision(
            tx,
            input.copied_from.preset,
            input.copied_from.revision,
          );
          if (source === undefined) {
            return reject("not_found", "copy source is missing");
          }
        }
        const hash = definitionHash(definition);
        const createdAt = tx.now();
        tx.emit(presetCreated, input.id, {
          kind: definition.kind,
          origin: "user",
          revision: 1,
          definition_hash: hash,
          definition,
        });
        tx.sql.run(
          `insert into presets (id, kind, origin, name, name_key, prompt, revision)
           values (?, ?, 'user', ?, ?, ?, 1)`,
          [
            input.id,
            definition.kind,
            definition.name,
            nameKey(definition.name),
            definition.prompt,
          ],
        );
        tx.sql.run(
          `insert into preset_revisions
            (preset_id, revision, definition, definition_hash, prompt_hash,
             decided_by, proposed_by, reason, before_revision, before_hash, created_at)
           values (?, 1, ?, ?, ?, ?, ?, ?, null, null, ?)`,
          [
            input.id,
            JSON.stringify(definition),
            hash,
            definition.prompt,
            ctx.principal,
            ctx.principal,
            input.copied_from === null
              ? "created"
              : `copied from ${input.copied_from.preset} rev ${input.copied_from.revision}`,
            createdAt,
          ],
        );
        return ok({
          preset: {
            id: input.id,
            revision: 1,
            definition,
            definition_hash: hash,
          },
        });
      },
    },
    revise: {
      route: revisePreset,
      handle(
        tx,
        ctx,
        input: Input<typeof revisePreset>,
        compare,
      ) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const parsed = parseDefinition(input.definition);
        if (!parsed.ok) return parsed;
        const definition: PresetDefinition = parsed.value;
        const current = loadPreset(tx, input.preset);
        if (current === undefined) {
          return reject("not_found", "preset not found");
        }
        // product 원문 개인화는 새 user preset이다(domain model command 표).
        if (current.origin === "product") {
          return reject(
            "forbidden",
            "personalizing a product preset creates a new user preset",
          );
        }
        // CAS다. 이전 revision이 바뀌었으면 거절이고 이전 판 전체가 남는다(R12).
        if (current.revision !== compare.revision) {
          return reject("conflict", "preset revision changed");
        }
        // 종류는 바꾸지 않는다. 다른 종류는 새 preset이다(표 kind와 정의가 어긋나지 않게).
        if (definition.kind !== current.kind) {
          return reject("invalid_input", "a preset revision keeps its kind");
        }
        // 전체 검사이다. 실패하면 현재 판이 유지된다(R11, R12).
        const checked = validateDefinition(definition, resolve(tx));
        if (!checked.ok) return checked;
        // 이름은 바꿔 맞추지 않고 중복이면 거절이다(R3, R11 확인).
        const named = tx.sql.get(
          "select id from presets where origin = 'user' and name_key = ? and id != ?",
          [nameKey(definition.name), input.preset],
        );
        if (named !== undefined) {
          return reject("conflict", "a person preset already uses this name");
        }
        const productNamed = tx.sql.get(
          "select id from presets where origin = 'product' and name_key = ?",
          [nameKey(definition.name)],
        );
        if (productNamed !== undefined) {
          return reject(
            "conflict",
            "the default preset already uses this display name. choose another name",
          );
        }
        const hash = definitionHash(definition);
        const beforeHash = revisionHash(tx, input.preset, current.revision);
        const createdAt = tx.now();
        tx.emit(presetRevised, input.preset, {
          before: { revision: current.revision, definition_hash: beforeHash },
          after: { revision: current.revision + 1, definition_hash: hash },
          reason: input.reason,
        });
        tx.sql.run(
          "update presets set name = ?, name_key = ?, prompt = ?, revision = ? where id = ?",
          [
            definition.name,
            nameKey(definition.name),
            definition.prompt,
            current.revision + 1,
            input.preset,
          ],
        );
        tx.sql.run(
          `insert into preset_revisions
            (preset_id, revision, definition, definition_hash, prompt_hash,
             decided_by, proposed_by, reason, before_revision, before_hash, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.preset,
            current.revision + 1,
            JSON.stringify(definition),
            hash,
            definition.prompt,
            ctx.principal,
            ctx.principal,
            input.reason,
            current.revision,
            beforeHash,
            createdAt,
          ],
        );
        return ok({
          preset: {
            id: input.preset,
            revision: current.revision + 1,
            definition,
            definition_hash: hash,
          },
        });
      },
    },
  };
}

function loadRevision(
  tx: Tx,
  presetId: string,
  revision: number,
): {
  id: string;
  revision: number;
  definition: PresetDefinition;
  definition_hash: string;
} | undefined {
  const row = tx.sql.get(
    "select preset_id, revision, definition, definition_hash from preset_revisions where preset_id = ? and revision = ?",
    [presetId, revision],
  );
  if (row === undefined) return undefined;
  return {
    id: String(row["preset_id"]),
    revision: Number(row["revision"]),
    definition: JSON.parse(String(row["definition"])) as PresetDefinition,
    definition_hash: String(row["definition_hash"]),
  };
}

function revisionHash(tx: Tx, presetId: string, revision: number): string {
  const row = tx.sql.get(
    "select definition_hash from preset_revisions where preset_id = ? and revision = ?",
    [presetId, revision],
  );
  // 과거 판은 immutable이라 hash가 항상 있다(R12).
  if (row === undefined) return "0".repeat(64);
  return String(row["definition_hash"]);
}
