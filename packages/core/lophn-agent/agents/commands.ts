import { err, ok, type Result } from "../../../base/mod.ts";
import {
  builtinAgentChange,
  operatorChange,
  operatorCreate,
  operatorDelete,
  type Place,
  type Profile,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Compare,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  type AgentContext,
  findOperator,
  loadAgent,
  openAgentContext,
} from "./inspect.ts";
import { agentCallerRule } from "./caller.ts";
import type { AgentDeps } from "./ports.ts";
import { staleImagePaths } from "./profile-asset.ts";
import { checkBuiltin, checkOperator } from "./validate.ts";

// 정의의 삭제와 built-in 저장은 사람만 한다(route actors). Operator는 agent도 만들고 고치되 자기 place 안에서만 한다. 순서는 입력 검사 → CAS 비교 → 쓰기다. 파일은 마지막에 쓰고,
// 쓰기가 실패하면 handler가 err를 돌려 전체가 되돌아간다. 정의 저장은 event를 내지 않는다.
// Project Manager는 place가 생길 때 ensure가 만든다: 사람은 이름이 Operator의 id인 정의만
// 만들고 지울 수 있고(operatorCreate·operatorDelete), built-in은 내용만 바꾼다(builtinAgentChange).

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

function conflict(what: string): Result<never> {
  return err({ code: "conflict", message: `${what} hash changed` });
}

// 정의를 쓴 뒤 저장한 profile이 가리키지 않는 `avatar.*`를 지운다. 정의 파일은 이미 바뀌었으므로
// 여기서 실패해도 저장을 되돌리지 않는다(되돌리면 파일과 ledger가 어긋난다). 지우지 못한 파일은 정의가
// 가리키지 않아 agent의 답을 바꾸지 않고, 다음 저장이 목록을 다시 보고 지운다.
function removeStaleImages(
  deps: AgentDeps,
  context: AgentContext,
  place: Place,
  operator: string,
  profile: Profile | undefined,
): void {
  const folder = context.roles.agentsFolderOf(context.store.root, place);
  for (const path of staleImagePaths(folder, operator, profile)) {
    try {
      deps.files.remove(path);
    } catch {
      // 다음 저장이 다시 지운다.
    }
  }
}

function open(deps: AgentDeps, tx: Tx): Result<AgentContext> {
  return openAgentContext(deps, tx.sql);
}

export function createAgentCommands(deps: AgentDeps): {
  create: CommandDefinition<typeof operatorCreate>;
  change: CommandDefinition<typeof operatorChange>;
  delete: CommandDefinition<typeof operatorDelete>;
  changeBuiltin: CommandDefinition<typeof builtinAgentChange>;
} {
  return {
    create: {
      route: operatorCreate,
      handle(
        tx: Tx,
        ctx: RequestContext,
        input: Input<typeof operatorCreate>,
      ): Result<Output<typeof operatorCreate>> {
        const rule = agentCallerRule(tx.sql, ctx, deps.operatorPlaceAllowed);
        if (!rule.ok) return rule;
        const { place, definition, id } = input;
        if (rule.value !== null) {
          const allowed = rule.value(place);
          if (!allowed.ok) return allowed;
        }
        const context = open(deps, tx);
        if (!context.ok) return context;
        if (!context.value.lookups.placeExists(place)) {
          return notFound("place");
        }
        const existing = findOperator(context.value, id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return err({ code: "conflict", message: "operator already exists" });
        }
        const ref = context.value.roles.operatorRef(id);
        const checked = checkOperator({
          context: context.value,
          role: ref.role,
          place,
          id,
          definition,
        });
        if (!checked.ok) return checked;
        const slot = context.value.roles.slotOf(
          context.value.store.root,
          ref,
          place,
        )!;
        const written = context.value.store.write(slot, checked.value);
        if (!written.ok) return written;
        removeStaleImages(deps, context.value, place, id, definition.profile);
        return ok({ agent: id, hash: written.value });
      },
    },
    change: {
      route: operatorChange,
      handle(
        tx: Tx,
        ctx: RequestContext,
        input: Input<typeof operatorChange>,
        compare: Compare<typeof operatorChange>,
      ): Result<Output<typeof operatorChange>> {
        const rule = agentCallerRule(tx.sql, ctx, deps.operatorPlaceAllowed);
        if (!rule.ok) return rule;
        const context = open(deps, tx);
        if (!context.ok) return context;
        const found = findOperator(context.value, input.agent);
        if (!found.ok) return found;
        if (found.value === null) return notFound("agent");
        const { place, slot, file } = found.value;
        if (rule.value !== null) {
          const allowed = rule.value(place);
          if (!allowed.ok) return allowed;
        }
        if (compare.hash !== file.hash) return conflict("agent file");
        const checked = checkOperator({
          context: context.value,
          role: context.value.roles.operatorRef(input.agent).role,
          place,
          id: input.agent,
          definition: input.definition,
        });
        if (!checked.ok) return checked;
        const written = context.value.store.write(slot, checked.value);
        if (!written.ok) return written;
        removeStaleImages(
          deps,
          context.value,
          place,
          input.agent,
          input.definition.profile,
        );
        return ok({ agent: input.agent, hash: written.value });
      },
    },
    delete: {
      route: operatorDelete,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof operatorDelete>,
        compare: Compare<typeof operatorDelete>,
      ): Result<Output<typeof operatorDelete>> {
        const context = open(deps, tx);
        if (!context.ok) return context;
        const found = findOperator(context.value, input.agent);
        if (!found.ok) return found;
        if (found.value === null) return notFound("agent");
        const { place, slot, file } = found.value;
        if (compare.hash !== file.hash) return conflict("agent file");
        const removed = context.value.store.remove(slot);
        if (!removed.ok) return removed;
        removeStaleImages(deps, context.value, place, input.agent, undefined);
        return ok({ agent: input.agent, hash: file.hash });
      },
    },
    changeBuiltin: {
      route: builtinAgentChange,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof builtinAgentChange>,
        compare: Compare<typeof builtinAgentChange>,
      ): Result<Output<typeof builtinAgentChange>> {
        const context = open(deps, tx);
        if (!context.ok) return context;
        // place가 없는 Project Manager는 agent가 아니다. 파일이 없어도 있는 place의
        // built-in은 agent이고 처음 저장이 파일을 만든다.
        const loaded = loadAgent(context.value, input.agent);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) return notFound("agent");
        const before = loaded.value.file?.hash ?? null;
        if (compare.hash !== before) return conflict("agent file");
        const checked = checkBuiltin(
          deps.roles,
          input.agent.role,
          input.definition,
        );
        if (!checked.ok) return checked;
        const written = context.value.store.write(
          loaded.value.slot,
          checked.value,
        );
        if (!written.ok) return written;
        return ok({ agent: input.agent, hash: written.value });
      },
    },
  };
}
