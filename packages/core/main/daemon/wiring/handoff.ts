// handoff note route(`handoff/write`, `handoff/list`)를 memory로 낸다. 읽기는 같은 ledger를 읽는 main thread 연결로 한다.
// note file은 `computers` 폴더에 놓이고 folder wiring이 나른다(`folderCarry`, `folderReplica`). 명단은 remote wiring이 늦게
// 내므로 부를 때 읽는다.
import { join } from "node:path";
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  handoffList,
  handoffWrite,
} from "../../../../protocol/lophn-agent/handoff.ts";
import { COMPUTERS_DIR } from "../../../../protocol/remote/carry.ts";
import { ok } from "../../../../base/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { handoffListHandler } from "../../../projects/handoff/list.ts";
import { handoffWriteHandler } from "../../../projects/handoff/write.ts";
import { createGitReader } from "../../../projects/identity/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import { routeKey } from "./app-principal.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

// handoff note의 글은 agent 출력이라 다른 기계로 가기 전에 redaction을 거친다.
const SOURCE = { concern: "handoff", revision: "1", scope: "note" };

export const handoffWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  // 틀린 file은 core가 뜬 동안 file마다 한 번만 적는다.
  const logged = new Set<string>();
  return {
    name: "handoff",
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const root = join(ctx.root.path, COMPUTERS_DIR);
      const me = () => ctx.machine.id;
      const policy = () =>
        ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;
      const git = createGitReader({ logger: ctx.telemetry.logger });
      const write = handoffWriteHandler({
        me,
        root,
        sql,
        session(id) {
          const workspaces = workspaceDepsOf(sql);
          const found = createSessionDirectory({
            ...workspaces,
            // 읽기만 한다. session을 열지 않는다.
            publish: () => {},
            sql: () => sql,
          }).find(id);
          if (found === null) return null;
          const { agent, workspace } = found.agent;
          return {
            workspace,
            agent,
            name: workspaces.names.describe(agent).name,
          };
        },
        policy,
        redact: (text) =>
          createProductRedactor(ctx.peek.knownSecrets)(
            SOURCE,
            "text/plain",
            text,
          ),
        head: (dir) => git.head(dir),
        clock: ctx.clock,
        random: ctx.random,
        written: () => ctx.peek.folderCarry?.kick(),
      });
      const list = handoffListHandler({
        me,
        root,
        sql,
        // 받는 자리(folder)가 없으면 믿을 file이 없다.
        holds: (machine, path) =>
          ctx.peek.folderReplica?.holds(machine, path) ??
          Promise.resolve(false),
        computerName: (machine) =>
          ctx.peek.machineLinks
            ?.computers()
            .find((each) => each.machine === machine && !each.self)?.name ??
          null,
        policy,
        clock: ctx.clock,
        logged,
        log: (message) =>
          ctx.telemetry.logger.warn({
            component: "handoff",
            event: "note_file_skipped",
            message,
          }),
      });
      return ok({
        memory: [
          [routeKey(handoffWrite), write],
          [routeKey(handoffList), list],
        ],
      });
    },
    closeWork() {
      connection?.close();
      connection = undefined;
    },
  };
};
