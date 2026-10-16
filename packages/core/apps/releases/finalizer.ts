// release 준비 확정. `prepare_bundle`이 끝나고 같은 bundle hash의 실제 app test가
// 통과로 기록돼 있으면 core가 봉인 사본에서 blueprint·manifest·data_changes를 모아 `release.prepare`를 낸다.
// coding agent는 확정 command를 부를 수 없고(machine만) 자기가 만든 결과를 싣지도 못한다: 입력은 모두 봉인
// 사본과 ledger의 Verification에서 온다. 확정은 접수한 coding agent의 ticket claim으로 다시 검사된다.
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import { releasePrepare } from "../../../protocol/apps/mod.ts";
import type { RequestContext, Sql } from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { dataChangesOf, readBundleCopy } from "./activation/desired.ts";
import { openConnection } from "../../storage/ledger/mod.ts";
import type { PreparationSnapshot } from "./preparation.ts";

// release 확정에 쓰는 operation 이름이다. core 내부 machine 자격의 scope가 이것을 담는다.
export const FINALIZER_OPERATIONS = [releasePrepare.name];

type Watched = {
  commit: string;
  // 접수한 coding agent. 확정 때 이 연결의 claim을 다시 확인한다.
  actor: string;
  ticket_source: { ticket: string; claim_seq: string };
};

type ReleaseFinalizerDeps = {
  ledgerPath: string;
  dataRoot: string;
  command(
    ctx: RequestContext,
    envelope: {
      command: string;
      input: unknown;
      idempotency_key: string;
      compare: unknown;
      prepared: string[];
    },
  ): Promise<Result<unknown>> | undefined;
  machine(): RequestContext | undefined;
  // 같은 앱·같은 bundle hash로 통과한 app test의 id다(problems 소유 읽기를 wiring이 넘겨준다).
  findPassedAppTest(
    sql: Pick<Sql, "get">,
    app: string,
    bundleHash: string,
  ): Result<string | undefined>;
};

type ReleaseFinalizer = {
  // ticket claim을 가진 coding agent의 준비 접수를 기억한다. 그 밖의 접수는 확정하지 않는다.
  watch(
    app: string,
    requestKey: string,
    request: {
      commit: string;
      actor: string;
      ticket_source: { ticket: string; claim_seq: string };
    },
  ): void;
  // 진행을 읽은 결과를 본다. 끝났고 같은 hash의 통과한 app test가 있으면 release를 확정한다.
  // 확정할 접수가 아니거나 아직 통과한 test가 없으면 아무것도 하지 않고 ok다.
  observe(snapshot: PreparationSnapshot): Promise<Result<void>>;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export function createReleaseFinalizer(
  deps: ReleaseFinalizerDeps,
): ReleaseFinalizer {
  const watched = new Map<string, Watched>();
  const keyOf = (app: string, requestKey: string) => `${app}\n${requestKey}`;

  function hasRelease(app: string, bundleHash: string): Result<boolean> {
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return unavailable("ledger is unavailable");
    try {
      return ok(
        opened.value.sql.get(
          "SELECT id FROM releases WHERE app = ? AND bundle_hash = ?",
          [app, bundleHash],
        ) !== undefined,
      );
    } catch {
      return unavailable("ledger is unavailable");
    } finally {
      opened.value.close();
    }
  }

  function passedTest(
    app: string,
    bundleHash: string,
  ): Result<string | undefined> {
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return unavailable("ledger is unavailable");
    try {
      return deps.findPassedAppTest(opened.value.sql, app, bundleHash);
    } finally {
      opened.value.close();
    }
  }

  async function finalize(
    snapshot: PreparationSnapshot,
    request: Watched,
    ctx: RequestContext,
  ): Promise<Result<void>> {
    if (
      snapshot.bundle_hash === null || snapshot.blueprint_hash === null ||
      snapshot.manifest === null
    ) return unavailable("the preparation result is incomplete");
    const existing = hasRelease(snapshot.app, snapshot.bundle_hash);
    if (!existing.ok) return existing;
    if (existing.value) {
      watched.delete(keyOf(snapshot.app, snapshot.request_key));
      return ok(undefined);
    }
    const test = passedTest(snapshot.app, snapshot.bundle_hash);
    if (!test.ok) return test;
    if (test.value === undefined) return ok(undefined);
    const copy = await readBundleCopy(
      deps.dataRoot,
      snapshot.app,
      snapshot.bundle_hash,
    );
    if (!copy.ok) return copy;
    if (copy.value === undefined) return unavailable("bundle copy is missing");
    const changes = await dataChangesOf(copy.value);
    if (!changes.ok) return changes;
    let blueprint: unknown;
    try {
      blueprint = JSON.parse(
        await Deno.readTextFile(`${copy.value.root}/blueprint.json`),
      );
    } catch {
      return unavailable("bundle blueprint cannot be read");
    }
    const key = `release-prepare-${await sha256Hex(
      `${snapshot.app}\n${snapshot.request_key}\n${snapshot.bundle_hash}`,
    )}`;
    const sent = deps.command(ctx, {
      command: releasePrepare.name,
      input: {
        app: snapshot.app,
        commit: request.commit,
        bundle_hash: snapshot.bundle_hash,
        blueprint_hash: snapshot.blueprint_hash,
        blueprint,
        manifest: copy.value.manifest,
        data_schema: copy.value.dataSchema,
        data_changes: changes.value,
        tests: [test.value],
        ticket_source: request.ticket_source,
        created_by: request.actor,
        key,
      },
      idempotency_key: key,
      compare: {},
      prepared: [],
    });
    if (sent === undefined) return unavailable("app-api are unavailable");
    const done = await sent;
    if (!done.ok) return done;
    watched.delete(keyOf(snapshot.app, snapshot.request_key));
    return ok(undefined);
  }

  return {
    watch(app, requestKey, request) {
      if (parseActor(request.actor)?.kind !== "coding_agent") return;
      watched.set(keyOf(app, requestKey), {
        commit: request.commit,
        actor: request.actor,
        ticket_source: request.ticket_source,
      });
    },
    async observe(snapshot) {
      const key = keyOf(snapshot.app, snapshot.request_key);
      const request = watched.get(key);
      if (request === undefined) return ok(undefined);
      if (snapshot.status !== "completed") {
        // 취소·실패·모름은 확정할 준비가 아니다. 진행 중이면 기다린다.
        if (snapshot.status !== "preparing") watched.delete(key);
        return ok(undefined);
      }
      const ctx = deps.machine();
      if (ctx === undefined) {
        return unavailable("machine credential is unavailable");
      }
      return await finalize(snapshot, request, ctx);
    },
  };
}
