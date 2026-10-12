import { err, ok, type Result } from "../../../base/mod.ts";
import {
  agentDeleted,
  type AgentPlace,
  type AgentRole,
  agentSaved,
  agentsDelete,
  agentsSave,
  placeAgentSettingsChange,
  placeAgentSettingsChanged,
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
import { serializeSettingsFile } from "./definition-file.ts";
import { callableIn, openPlaceView, type PlaceView } from "./inspect.ts";
import type { AgentDeps } from "./ports.ts";
import { staleImagePaths } from "./profile-asset.ts";
import { agentFileName, dataRootOf, fileHash, SETTINGS_FILE } from "./store.ts";
import { checkSave, checkSettings } from "./validate.ts";

// 정의와 자리 설정의 저장·삭제는 사람만 한다(route actors). 순서는 입력 검사 → CAS 비교 → 쓰기 → event다.
// 파일은 transaction 안에서 마지막에 쓰고, 쓰기가 실패하면 handler가 err를 돌려 방금 만든 assignment와
// event까지 전체가 되돌아간다. 그래서 실패한 저장은 assignment도 event도 남기지 않는다.

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
  tx: Tx,
  place: AgentPlace,
  role: AgentRole,
  assignment: string,
  profile: Profile | undefined,
): void {
  const root = dataRootOf(tx.sql, deps.dataRoot);
  if (!root.ok) return;
  for (
    const path of staleImagePaths(root.value, place, role, assignment, profile)
  ) {
    try {
      deps.files.remove(path);
    } catch {
      // 다음 저장이 다시 지운다.
    }
  }
}

function placeView(
  deps: AgentDeps,
  tx: Tx,
  place: AgentPlace,
): Result<PlaceView> {
  const view = openPlaceView(deps, tx.sql, place);
  if (!view.ok) return view;
  if (!view.value.context.lookups.placeExists(place)) {
    return notFound("place");
  }
  return view;
}

export function createAgentCommands(deps: AgentDeps): {
  save: CommandDefinition<typeof agentsSave>;
  delete: CommandDefinition<typeof agentsDelete>;
  changeSettings: CommandDefinition<typeof placeAgentSettingsChange>;
} {
  return {
    save: {
      route: agentsSave,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof agentsSave>,
        compare: Compare<typeof agentsSave>,
      ): Result<Output<typeof agentsSave>> {
        const { place, definition } = input;
        const view = placeView(deps, tx, place);
        if (!view.ok) return view;
        const { store, lookups } = view.value.context;

        // 새 Operator는 assignment를 먼저 만든 뒤에야 ID를 알지만 검사는 만들기 전에 끝낸다.
        let role: AgentRole = "operator";
        let assignment: string | null = null;
        if (input.assignment !== undefined) {
          const ref = lookups.assignment(input.assignment);
          if (ref === null) return notFound("agent");
          // 이 자리에서 부를 수 없는 agent(다른 자리의 Operator, 거둔 것)는 이 자리의 agent가 아니다.
          // Context Engineer는 전역이라 앱 자리에도 닿고 그때는 검사가 자리 오류로 알린다.
          const reachable = ref.state !== "withdrawn" &&
            (callableIn(ref, place) || ref.role === "context_engineer");
          if (!reachable) return notFound("agent");
          role = ref.role;
          assignment = ref.id;
        }

        const file = assignment === null
          ? ok(null)
          : store.read(place, agentFileName(role, assignment));
        if (!file.ok) return file;
        const before = file.value?.hash ?? null;
        if (compare.hash !== before) return conflict("agent file");

        const checked = checkSave({
          view: view.value,
          role,
          assignment,
          definition,
        });
        if (!checked.ok) return checked;
        const text = checked.value;

        let id = assignment;
        if (id === null) {
          const created = deps.assignmentWriter(tx).createOperator(place);
          if (!created.ok) return created;
          id = created.value;
        }
        const after = fileHash(text);
        tx.emit(agentSaved, id, {
          place,
          role,
          before_hash: before,
          after_hash: after,
        });
        const written = store.write(place, agentFileName(role, id), text);
        if (!written.ok) return written;
        removeStaleImages(deps, tx, place, role, id, definition.profile);
        return ok({ assignment: id, role, hash: after });
      },
    },
    delete: {
      route: agentsDelete,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof agentsDelete>,
        compare: Compare<typeof agentsDelete>,
      ): Result<Output<typeof agentsDelete>> {
        const ref = deps.lookups(tx.sql).assignment(input.assignment);
        if (ref === null || ref.state === "withdrawn") {
          return notFound("agent");
        }
        // built-in은 이름도 존재도 제품이 정한다.
        if (ref.role !== "operator") {
          return err({
            code: "forbidden",
            message: "only an operator can be deleted",
          });
        }
        if (ref.scope.kind === "all") return notFound("agent");
        const place: AgentPlace = ref.scope as AgentPlace;
        const view = placeView(deps, tx, place);
        if (!view.ok) return view;
        const { store } = view.value.context;
        const file = agentFileName("operator", ref.id);
        const current = store.read(place, file);
        if (!current.ok) return current;
        // 정의 파일이 없는 assignment는 agent가 아니다.
        if (current.value === null) return notFound("agent");
        if (compare.hash !== current.value.hash) return conflict("agent file");

        const withdrawn = deps.assignmentWriter(tx).withdraw(ref.id);
        if (!withdrawn.ok) return withdrawn;
        tx.emit(agentDeleted, ref.id, {
          place,
          role: "operator",
          hash: current.value.hash,
        });
        const removed = store.remove(place, file);
        if (!removed.ok) return removed;
        return ok({ assignment: ref.id, hash: current.value.hash });
      },
    },
    changeSettings: {
      route: placeAgentSettingsChange,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof placeAgentSettingsChange>,
        compare: Compare<typeof placeAgentSettingsChange>,
      ): Result<Output<typeof placeAgentSettingsChange>> {
        const { place, settings } = input;
        const view = placeView(deps, tx, place);
        if (!view.ok) return view;
        const { store } = view.value.context;
        const current = store.read(place, SETTINGS_FILE);
        if (!current.ok) return current;
        const before = current.value?.hash ?? null;
        if (compare.hash !== before) return conflict("settings file");

        const checked = checkSettings({
          settings,
          workspace: view.value.workspace,
          text: serializeSettingsFile(settings),
        });
        if (!checked.ok) return checked;
        const after = fileHash(checked.value);
        tx.emit(placeAgentSettingsChanged, place.id, {
          place,
          before_hash: before,
          after_hash: after,
        });
        const written = store.write(place, SETTINGS_FILE, checked.value);
        if (!written.ok) return written;
        return ok({ place, hash: after });
      },
    },
  };
}
