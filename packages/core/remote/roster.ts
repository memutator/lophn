// 이 컴퓨터가 든 내 기기 명단의 main thread 사본. 저장한 statement와 주소, 그것으로 계산한 view, 이 컴퓨터의 key를 들고, 명단을
// 고치는 일(받기, 서명, 저장)을 하나씩 한다. 서명 key를 writer Worker에 넘기지 않으려 여기서 서명하고 machine 자격
// `roster/store`로 쓴다. 고치는 순서는 architecture `remote.md` 명단 절의 "컴퓨터가 명단을 고치는 순서"다:
// 저장한 것 + 받은 것 → view → 아직 서명하지 않은 devices·settled removed body에 서명 → 다시 view → keep·주소·folds 저장.
import {
  type Clock,
  canonicalize,
  err,
  formatAt,
  type IdSource,
  type LophnError,
  ok,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import {
  checkInvited,
  generateSigningKey,
  mergeRoster,
  ROSTER_INVITE_LONG_MS,
  ROSTER_INVITE_SHORT_MS,
  type RosterEntryBody,
  type RosterInviteBody,
  type RosterInvitedStatement,
  type RosterInviteText,
  type RosterReach,
  type RosterRemovalBody,
  type RosterSignedStatement,
  type RosterSnapshot,
  type RosterStatement,
  type RosterView,
  remoteKeyBytes,
  remoteKeyText,
  rosterFresh,
  rosterView,
  signRoster,
} from "../../protocol/remote/mod.ts";
import type { RemoteKeys } from "./host-key.ts";

export type RosterChange = {
  before: RosterView;
  after: RosterView;
  snapshot: RosterSnapshot;
  // 이 컴퓨터가 낸 초대장으로 이번에 처음 든 기기와 그 초대장의 허락. 초대장의 허락은 초대한 컴퓨터만 자기 표에 적는다.
  invited: { key: string; terminal_input: boolean }[];
};

export type RosterDeps = {
  clock: Clock;
  random: RandomSource;
  ids: IdSource;
  // `roster/statements`와 `roster/store`(machine 자격).
  load(): Promise<Result<RosterSnapshot>>;
  store(input: {
    statements: RosterStatement[];
    reach: RosterReach[];
    folds: { from: string; to: string }[];
    removed: string[];
    names: { key: string; name: string }[];
  }): Promise<Result<void>>;
  // 저장한 명단(statement나 주소)이 바뀐 뒤 부른다. 돌려준 promise가 끝날 때까지 다음 고치기를 하지 않는다(이 컴퓨터의
  // 이름을 기계 이름으로 받는 동안 ensureSelf가 옛 이름으로 되돌리지 않게).
  changed(change: RosterChange): void | Promise<void>;
};

// 이 컴퓨터. id는 명단의 자기 항목이 정한다(없으면 ensureSelf가 새 id로 만든다).
export type RosterSelf = {
  id: string;
  hostKey: string;
  signingKey: string;
};

// 옛 기기 표에서 옮길 phone 행(아직 이 컴퓨터가 서명하지 않은 것).
export type RosterAdoptRow = {
  id: string;
  key: string;
  name: string;
  os: RosterEntryBody["os"];
};

export type RosterJoined = {
  device: string;
  computer: { id: string; signing_key: string };
  roster: RosterSnapshot;
};

// `prepareJoin`이 확인한 초대장. `storeJoin`이 저장할 것을 든다.
export type RosterPreparedJoin = {
  body: RosterEntryBody;
  issuer: RosterEntryBody;
  statements: RosterStatement[];
  reach: RosterReach;
};

function isSigned(
  statement: RosterStatement,
): statement is RosterSignedStatement {
  return "by" in statement;
}

// 옛 statement의 `terminal_input`은 서명한 bytes라 읽을 수만 있다. 이 컴퓨터가 새로 서명하는 body에는 싣지 않는다.
const bare = ({
  terminal_input: _old,
  ...rest
}: RosterEntryBody): RosterEntryBody => rest;

const unavailable = (): Result<never> =>
  err({ code: "unavailable", message: "remote has not been turned on" });

const notFound = (): Result<never> =>
  err({ code: "not_found", message: "device not found in the roster" });

export function createRoster(deps: RosterDeps) {
  let statements: RosterStatement[] = [];
  let reach: RosterReach[] = [];
  let keys: RemoteKeys | undefined;
  let view = rosterView([], [], null);
  // 고치는 일은 하나씩 한다. 받은 statement 둘이 같이 와도 한쪽이 다른 쪽의 저장을 덮지 않는다.
  let queue: Promise<unknown> = Promise.resolve();

  function run<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  }

  const own = () =>
    keys === undefined ? null : remoteKeyText(keys.signing.publicKey);
  const roots = () => {
    const key = own();
    return key === null ? [] : [key];
  };

  function selfOf(v: RosterView): RosterSelf | undefined {
    if (keys === undefined) return undefined;
    const hostKey = remoteKeyText(keys.host.publicKey);
    const signingKey = remoteKeyText(keys.signing.publicKey);
    const mine = v.devices.find(
      (d) => d.body.key === hostKey && d.body.signing_key === signingKey,
    );
    return mine && { id: mine.body.id, hostKey, signingKey };
  }

  function signed(
    body: RosterEntryBody | RosterRemovalBody,
    by: string,
  ): RosterSignedStatement {
    if (keys === undefined) throw new Error("no signing key");
    return { body, by, signature: signRoster(body, keys.signing.secretKey) };
  }

  // 받은 것을 합친 statement 집합을 이 컴퓨터의 규칙으로 정한다: 닿은 초대 서명 statement를 확인해 맞으면 서명하고 틀리면
  // 버린다(서명자를 아직 모르는 것만 남긴다), view의 devices와 settled removed 가운데 아직 서명하지 않은 body에 서명한다.
  // 서명이 늘면 믿음이 넓어질 수 있어 더 늘지 않을 때까지 한다. 결과는 keep이다.
  function settle(
    input: readonly RosterStatement[],
    now: number,
    id: string | undefined,
  ): { statements: RosterStatement[]; view: RosterView } {
    let all = mergeRoster(rosterFresh(input, now));
    for (;;) {
      const v = rosterView(all, roots(), own());
      if (id === undefined) return { statements: v.keep, view: v };
      const added: RosterStatement[] = [];
      const dropped = new Set<RosterStatement>();
      const held = new Set(v.devices.map((d) => d.body.key));
      for (const statement of v.keep) {
        if (isSigned(statement) || held.has(statement.body.key)) continue;
        const checked = checkInvited(statement, { now, view: v });
        if (checked.ok) added.push(signed(checked.value, id));
        else if (checked.error.details?.reason !== "untrusted") {
          dropped.add(statement);
        }
      }
      for (const d of v.devices) {
        if (!d.signed_by.includes(id)) added.push(signed(d.body, id));
      }
      for (const r of v.removed) {
        if (r.settled && !r.signed_by.includes(id))
          added.push(signed(r.body, id));
      }
      if (added.length === 0 && dropped.size === 0) {
        return { statements: v.keep, view: v };
      }
      all = mergeRoster(
        v.keep.filter((s) => !dropped.has(s)),
        added,
      );
    }
  }

  // 주소는 기기마다 하나이고 마지막에 받은 것이 이긴다. 이 컴퓨터의 주소는 이 컴퓨터만 정한다. 명단에 없는 기기의 것은 버린다.
  function mergeReach(
    incoming: readonly RosterReach[],
    v: RosterView,
    own: RosterReach | undefined,
  ): RosterReach[] {
    const self = selfOf(v)?.id;
    const byDevice = new Map(reach.map((r) => [r.device, r]));
    for (const r of incoming) if (r.device !== self) byDevice.set(r.device, r);
    if (own !== undefined) byDevice.set(own.device, own);
    const ids = new Set(v.devices.map((d) => d.body.id));
    return [...byDevice.values()]
      .filter((r) => ids.has(r.device))
      .sort((a, b) => (a.device < b.device ? -1 : 1));
  }

  async function commit(
    settled: { statements: RosterStatement[]; view: RosterView },
    incoming: readonly RosterReach[] = [],
    own?: RosterReach,
  ): Promise<Result<void>> {
    const nextReach = mergeReach(incoming, settled.view, own);
    const before = view;
    if (
      canonicalize(settled.statements) === canonicalize(statements) &&
      canonicalize(nextReach) === canonicalize(reach)
    ) {
      view = settled.view;
      return ok(undefined);
    }
    const stored = await deps.store({
      statements: settled.statements,
      reach: nextReach,
      folds: settled.view.folded,
      // 정해진 빼기만 기기 행을 지운다: 엇갈림으로 빠진 폰은 풀리면 기준과 push token 그대로 돌아온다.
      removed: settled.view.removed
        .filter((r) => r.settled)
        .map((r) => r.body.key),
      names: settled.view.devices.map((d) => ({
        key: d.body.key,
        name: d.body.name,
      })),
    });
    if (!stored.ok) return stored;
    statements = settled.statements;
    reach = nextReach;
    view = settled.view;
    // 이 컴퓨터가 낸 초대장으로 든 기기가 이 view에 처음 선 때다. 누구의 서명이 그 항목을 들였든(다른 컴퓨터가 먼저 서명한
    // 항목과 같이 닿아도) 같다. 이미 view에 있던 key는 사람이 끈 허락을 같은 statement가 다시 켜지 못하게 늘 거른다.
    const held = new Set(before.devices.map((d) => d.body.key));
    const now = new Set(view.devices.map((d) => d.body.key));
    const mine = selfOf(view)?.id;
    await deps.changed({
      before,
      after: view,
      snapshot: snapshot(),
      invited: statements.flatMap((each) =>
        !isSigned(each) &&
        each.invite.body.by === mine &&
        !held.has(each.body.key) &&
        now.has(each.body.key)
          ? [
              {
                key: each.body.key,
                terminal_input: each.invite.body.terminal_input,
              },
            ]
          : [],
      ),
    });
    return ok(undefined);
  }

  // 지금 명단에 statement를 더해 정하고 저장한다.
  function add(
    more: readonly RosterStatement[],
    incoming: readonly RosterReach[] = [],
    own?: RosterReach,
  ): Promise<Result<void>> {
    return commit(
      settle(
        mergeRoster(statements, more),
        deps.clock.nowMs(),
        selfOf(view)?.id,
      ),
      incoming,
      own,
    );
  }

  function snapshot(): RosterSnapshot {
    return { statements: [...statements], reach: [...reach] };
  }

  function device(id: string) {
    return view.devices.find((d) => d.body.id === id);
  }

  // 이 컴퓨터가 고친 새 rev. 이긴 body에서 시작한다.
  function revise(
    id: string,
    edit: Pick<RosterEntryBody, "name">,
  ): Promise<Result<void>> {
    return run(async () => {
      const self = selfOf(view);
      if (self === undefined) return unavailable();
      const found = device(id);
      if (found === undefined) return notFound();
      if (found.body.name === edit.name) return ok(undefined);
      return add([
        signed(
          { ...bare(found.body), ...edit, rev: found.body.rev + 1 },
          self.id,
        ),
      ]);
    });
  }

  return {
    view: () => view,
    self: () => selfOf(view),
    snapshot,
    // key가 지금 명단의 기기면 그 id.
    find: (key: string) =>
      view.devices.find((d) => d.body.key === key)?.body.id,

    // 저장한 명단을 읽어 view를 다시 계산한다. 기동과 forget_all 뒤에 부른다.
    load(): Promise<Result<void>> {
      return run(async () => {
        const read = await deps.load();
        if (!read.ok) return read;
        statements = read.value.statements;
        reach = read.value.reach;
        view = rosterView(statements, roots(), own());
        return ok(undefined);
      });
    },

    // 이 컴퓨터의 key를 둔다(없으면 undefined: remote를 켠 적이 없거나 key를 버렸다).
    useKeys(next: RemoteKeys | undefined): Promise<void> {
      return run(async () => {
        keys = next;
        view = rosterView(statements, roots(), own());
      });
    },

    // 이 컴퓨터의 자기 항목을 둔다: 없으면 새 id로 만들고, 항목의 이름이 기계 이름과 다르면(machine/rename, 꺼진 동안 hostname이
    // 바뀜) 기계 이름으로 rev를 올려 서명한다. 다른 컴퓨터가 roster/rename으로 바꾼 이 컴퓨터의 이름은 받을 때 wiring이 기계
    // 이름으로 옮기므로(changed) 여기서 되돌리지 않는다. `name`은 차례가 왔을 때 읽는다: 그 옮기기가 끝난 뒤의 이름이다.
    // `reach`는 이 컴퓨터의 지금 주소다(remote가 켜져 있을 때).
    // `adopt`는 옛 기기 표의 phone 행이다: 명단에 그 key의 statement가 하나도 없는 행에 같은 저장에서 서명한다(id, key, 이름,
    // rev 1, 초대 없음. 그 행의 옛 허락은 wiring가 이 컴퓨터의 표로 옮긴다). 저장이 서명한 항목이 없는 행을 지우므로 자기 항목과 따로 저장하면 그 행을 잃는다.
    ensureSelf(input: {
      machine: string;
      name: () => string;
      os: RosterEntryBody["os"];
      reach?: Omit<RosterReach, "device">;
      adopt?: readonly RosterAdoptRow[];
    }): Promise<Result<RosterSelf>> {
      return run(async (): Promise<Result<RosterSelf>> => {
        if (keys === undefined) return unavailable();
        const hostKey = remoteKeyText(keys.host.publicKey);
        const signingKey = remoteKeyText(keys.signing.publicKey);
        const more: RosterStatement[] = [];
        const name = input.name();
        let id = selfOf(view)?.id;
        if (id === undefined) {
          id = deps.ids.newId("dev");
          const body = {
            type: "entry",
            id,
            kind: "computer",
            key: hostKey,
            signing_key: signingKey,
            machine: input.machine,
            name,
            os: input.os,
            rev: 1,
            invite: null,
          } as RosterEntryBody;
          more.push(signed(body, id));
        } else if (device(id)!.body.name !== name) {
          const winner = device(id)!.body;
          more.push(signed({ ...bare(winner), name, rev: winner.rev + 1 }, id));
        }
        const mentioned = new Set(statements.map((s) => s.body.key));
        for (const row of input.adopt ?? []) {
          if (mentioned.has(row.key)) continue;
          const body = {
            type: "entry",
            id: row.id,
            kind: "phone",
            key: row.key,
            signing_key: null,
            machine: null,
            name: row.name,
            os: row.os,
            rev: 1,
            invite: null,
          } as RosterEntryBody;
          more.push(signed(body, id));
        }
        const own =
          input.reach === undefined
            ? undefined
            : { ...input.reach, device: id };
        const done = await commit(
          settle(mergeRoster(statements, more), deps.clock.nowMs(), id),
          [],
          own as RosterReach | undefined,
        );
        if (!done.ok) return done;
        return ok({ id, hostKey, signingKey });
      });
    },

    // 붙은 연결(폰, 컴퓨터)이 보낸 명단을 받아 합치고 이 컴퓨터의 명단을 낸다.
    receive(incoming: RosterSnapshot): Promise<Result<RosterSnapshot>> {
      return run(async () => {
        const done = await add(incoming.statements, incoming.reach);
        return done.ok ? ok(snapshot()) : done;
      });
    },

    // 붙는 쪽의 첫 frame `join`. statement는 모두 그 연결의 key에 대한 것이어야 한다. 그 key가 명단(받은 것을 합친 뒤)에
    // 있으면 저장하고 붙인다. 없으면 아무것도 저장하지 않는다: 아직 누구인지 모르는 쪽이 저장소를 채우지 못하게 한다.
    join(
      key: string,
      offered: readonly RosterStatement[],
    ): Promise<Result<RosterJoined>> {
      return run(async (): Promise<Result<RosterJoined>> => {
        const self = selfOf(view);
        if (self === undefined) return unavailable();
        if (offered.some((s) => s.body.key !== key)) {
          return err({
            code: "invalid_input",
            message: "join statements must be about the connecting key",
          });
        }
        const now = deps.clock.nowMs();
        const trial = settle(mergeRoster(statements, offered), now, self.id);
        const joined = trial.view.devices.find((d) => d.body.key === key);
        if (joined === undefined) return err(refusal(key, offered, now));
        const done = await commit(trial);
        if (!done.ok) return done;
        return ok({
          device: joined.body.id,
          computer: { id: self.id, signing_key: self.signingKey },
          roster: snapshot(),
        });
      });
    },

    rename: (id: string, name: string) => revise(id, { name }),

    // 기기를 뺀다(이 컴퓨터가 서명한 빼기). 이 컴퓨터 자신이면 invalid_input이다. 정해지지 않은 빼기로 빠진 기기(엇갈림)도
    // 뺀다: 이 컴퓨터가 서명한 빼기라 이 view에서 처음부터 효력이 있고, 그 기기가 낸 빼기가 효력을 잃어 그것이 뺀 쪽이 돌아온다.
    // 엇갈린 줄의 id는 빠진 서명자가 스스로 단 것일 수 있어, key로 고르고 id가 두 줄에 맞으면 고르지 않는다(conflict).
    remove(target: { id: string } | { key: string }): Promise<Result<string>> {
      return run(async () => {
        const self = selfOf(view);
        if (self === undefined) return unavailable();
        const rows = [
          ...view.devices.map((d) => d.body),
          ...view.removed.flatMap((r) =>
            r.settled || r.entry === null ? [] : [r.entry],
          ),
        ];
        const matched = rows.filter((row) =>
          "key" in target ? row.key === target.key : row.id === target.id,
        );
        if (matched.length > 1) {
          return err({
            code: "conflict",
            message:
              "more than one device in the roster has this id; remove it by its key",
          });
        }
        const found = matched[0];
        if (found === undefined) return notFound();
        if (
          found.key === self.hostKey ||
          found.signing_key === self.signingKey
        ) {
          return err({
            code: "invalid_input",
            message: "this computer cannot remove itself from the roster",
          });
        }
        const body: RosterRemovalBody = {
          type: "removal",
          id: found.id,
          key: found.key,
          signing_key: found.signing_key,
          at: deps.clock.now(),
        };
        const done = await add([signed(body, self.id)]);
        return done.ok ? ok(found.id) : done;
      });
    },

    // 이 컴퓨터가 다른 컴퓨터의 초대장으로 든다(`roster/join`). issuer 항목의 자기 서명과 초대장 서명, 지금 시각으로 수명을
    // issuer의 서명 key를 root로 더한 view에서 확인하고(`checkInvited`), 이 컴퓨터의 자기 항목을 rev+1로 지어 초대 secret으로
    // 서명한다. 사람이 글을 넣은 것이 믿음의 근거라 이 컴퓨터가 issuer 항목에 서명한다. 여기서는 저장하지 않는다: issuer가
    // 거절하면(used, expired, removed …) 아무것도 남기지 않도록 wiring이 issuer에 붙어 본 뒤 `storeJoin`으로 저장한다.
    // 돌려주는 body는 issuer에 붙어 내밀 이 컴퓨터의 항목이다.
    prepareJoin(text: RosterInviteText): Promise<Result<RosterPreparedJoin>> {
      return run(async (): Promise<Result<RosterPreparedJoin>> => {
        const self = selfOf(view);
        if (self === undefined) return unavailable();
        const { invite, issuer, secret } = text;
        if (invite.body.kind !== "computer") {
          return err({
            code: "invalid_input",
            message: "a computer joins only with an invite for a computer",
          });
        }
        const signer = issuer.body;
        const mine = device(self.id)!.body;
        if (
          signer.type === "entry" &&
          (signer.key === self.hostKey || signer.machine === mine.machine)
        ) {
          return err({
            code: "conflict",
            message: "the invite was made on this computer",
            details: { reason: "this_computer" },
          });
        }
        const secretKey = remoteKeyBytes(secret);
        if (
          signer.type !== "entry" ||
          signer.kind !== "computer" ||
          signer.signing_key === null ||
          secretKey === undefined
        ) {
          return err({
            code: "unauthorized",
            message: "roster invite refused: untrusted",
            details: { reason: "untrusted" },
          });
        }
        const body: RosterEntryBody = {
          ...bare(mine),
          rev: mine.rev + 1,
          invite: invite.body.key,
        };
        const invited: RosterInvitedStatement = {
          body,
          invite,
          signature: signRoster(body, secretKey),
        };
        const trial = rosterView(
          mergeRoster(statements, [issuer]),
          [...roots(), signer.signing_key],
          own(),
        );
        const checked = checkInvited(invited, {
          now: deps.clock.nowMs(),
          view: trial,
        });
        if (!checked.ok) return checked;
        return ok({
          body,
          issuer: signer,
          statements: [issuer, signed(signer, self.id), invited],
          reach: text.reach,
        });
      });
    },

    // `prepareJoin`이 지은 것을 저장한다: issuer 항목, 그 서명, 초대 서명 statement, issuer의 주소. 그 statement는 issuer에
    // 닿을 때(`join`, link) 받아들여지고 그때까지 keep에 남는다.
    storeJoin(prepared: RosterPreparedJoin): Promise<Result<void>> {
      return run(() => add(prepared.statements, [prepared.reach]));
    },

    // 초대장을 낸다. 한 번 쓸 key의 비밀은 글에만 있고 저장하지 않는다: 쓰였는지는 명단의 `invite` 칸이 말한다.
    invite(input: {
      kind: RosterInviteBody["kind"];
      terminal_input: boolean;
      lifetime: "short" | "long";
      reach: Omit<RosterReach, "device">;
    }): Result<{ invite: RosterInviteText; expires_at: string }> {
      const self = selfOf(view);
      if (self === undefined || keys === undefined) return unavailable();
      const issuer = statements.find(
        (s): s is RosterSignedStatement =>
          isSigned(s) &&
          s.by === self.id &&
          canonicalize(s.body) === canonicalize(device(self.id)!.body),
      );
      if (issuer === undefined) return unavailable();
      const once = generateSigningKey(deps.random);
      const expiresAt = formatAt(
        deps.clock.nowMs() +
          (input.lifetime === "long"
            ? ROSTER_INVITE_LONG_MS
            : ROSTER_INVITE_SHORT_MS),
      );
      const body: RosterInviteBody = {
        type: "invite",
        key: remoteKeyText(once.publicKey),
        by: self.id as RosterInviteBody["by"],
        kind: input.kind,
        terminal_input: input.terminal_input,
        expires_at: expiresAt,
      };
      return ok({
        invite: {
          invite: { body, signature: signRoster(body, keys.signing.secretKey) },
          secret: remoteKeyText(once.secretKey),
          issuer,
          reach: { ...input.reach, device: self.id as RosterReach["device"] },
        },
        expires_at: expiresAt,
      });
    },
  };

  // 명단에 들지 못한 `join`의 이유. 빠진 key면 그 빼기 statement를 실어 붙는 쪽이 자기 root로 확인한 뒤 key를 버리게 한다.
  function refusal(
    key: string,
    offered: readonly RosterStatement[],
    now: number,
  ): LophnError {
    const removed = view.removed.find((r) => r.body.key === key);
    if (removed !== undefined) {
      const text = canonicalize(removed.body);
      return {
        code: "unauthorized",
        message: offered.some((s) => !isSigned(s))
          ? "roster invite refused: removed"
          : "this device was removed from the roster",
        details: {
          reason: "removed",
          removal: statements.find(
            (s) => isSigned(s) && canonicalize(s.body) === text,
          ),
        },
      };
    }
    for (const statement of offered) {
      if (isSigned(statement)) continue;
      const checked = checkInvited(statement, { now, view });
      if (!checked.ok) return checked.error;
    }
    return {
      code: "unauthorized",
      message: "roster invite refused: untrusted",
      details: { reason: "untrusted" },
    };
  }
}

export type Roster = ReturnType<typeof createRoster>;
