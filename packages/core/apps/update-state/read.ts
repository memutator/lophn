// 앱 하나의 기계 사이 판 차이를 모은다(`apps/update_state`). 따라가기 상태, held, 기계별 꼴 판 범위, 다른 기계 앱 기록의
// 활성 release, 이 기계 release 행을 받아 한 값으로 합친다. 읽기만 한다.
import type { ReleaseRecord, UpdateState } from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { FollowState } from "../follow/mod.ts";
import type { HeldDetail, MachineExchange } from "../../folder/import/mod.ts";

type ActiveRelease = {
  code_commit: string;
  data_schema: number;
};

export type UpdateStateInput = {
  app: Id<"app">;
  me: Id<"mch">;
  /** 이 기계의 활성 release. */
  current: ActiveRelease | null;
  follow: FollowState;
  held: readonly HeldDetail[];
  machines: readonly MachineExchange[];
  /** 다른 기계들의 그 앱 활성 release(앱 기록 사본). 범위 밖 기계의 기록은 없다. */
  offered: readonly { machine: Id<"mch">; release: ActiveRelease | null }[];
  /** 모든 기계의 앱 기록 사본이 있는 (기계, 앱). 범위 밖 기계가 범위 밖이 되기 전에 읽은 옛 사본도 든다. */
  recorded: readonly { machine: Id<"mch">; app: Id<"app"> }[];
  releases: readonly Pick<ReleaseRecord, "code_commit" | "number">[];
};

export function buildUpdateState(input: UpdateStateInput): UpdateState {
  const { me, current } = input;
  const local = new Map(input.releases.map((row) => [row.code_commit, row]));
  const exchange = new Map(input.machines.map((row) => [row.machine, row]));

  const machineRow = (
    machine: Id<"mch">,
    release: ActiveRelease | null,
  ): UpdateState["machines"][number] => {
    const known = exchange.get(machine);
    return {
      machine,
      name: known?.name ?? machine,
      this_machine: machine === me,
      lophn_version: known?.lophn_version ?? null,
      exchange: known?.exchange ?? "ok",
      release:
        release === null
          ? null
          : {
              number: local.get(release.code_commit)?.number ?? null,
              code_commit: release.code_commit,
              data_schema: release.data_schema,
            },
    };
  };

  const others = new Map<Id<"mch">, ActiveRelease | null>();
  for (const row of input.offered) {
    if (row.machine !== me) others.set(row.machine, row.release);
  }
  // 범위 밖 기계는 지금 앱 기록을 읽지 않는다. 범위 밖이 되기 전에 읽은 앱 기록이 있으면 그 앱을 쓰던 기계만 넣고, 하나도
  // 없으면 이 앱을 쓰는지 몰라 넣는다: 주고받지 못한다는 것은 보인다.
  for (const row of input.machines) {
    if (row.machine === me || row.exchange === "ok" || others.has(row.machine))
      continue;
    const apps = input.recorded.filter((each) => each.machine === row.machine);
    if (apps.length > 0 && !apps.some((each) => each.app === input.app))
      continue;
    others.set(row.machine, null);
  }
  const machines = [
    machineRow(me, current),
    ...[...others]
      .map(([machine, release]) => machineRow(machine, release))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];

  // 이 기계가 지금 것보다 먼저 들인 release는 옛 release다. 사람이 이전으로 돌아가 내려놓은 release는 번호가 더 커서 newer다:
  // 그 기계는 내려오지 않으니 "그 기계가 올라오면 온다"고 보이면 틀린다.
  const currentNumber =
    current === null ? null : (local.get(current.code_commit)?.number ?? null);
  const held = input.held
    // 지금 release의 held는 바로 적용되는 중이다.
    .filter((row) => row.code_commit !== current?.code_commit)
    .map((row) => {
      const number = local.get(row.code_commit)?.number ?? null;
      const diverged =
        input.follow.state === "diverged" &&
        row.code_commit === input.follow.release;
      const older =
        row.data_schema < (current?.data_schema ?? 0) ||
        (number !== null && currentNumber !== null && number < currentNumber);
      return {
        machine: row.origin,
        code_commit: row.code_commit,
        data_schema: row.data_schema,
        changes: row.changes,
        bytes: row.bytes,
        full: row.full,
        why: diverged
          ? ("diverged" as const)
          : older
            ? ("older_release" as const)
            : ("newer_release" as const),
      };
    });

  return { app: input.app, follow: input.follow, held, machines };
}
