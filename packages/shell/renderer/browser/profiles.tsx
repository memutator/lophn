// browser profile 목록(core의 `browser_profiles/list`, 사람만 바꾼다)과 탭의 partition. 목록이 바뀌면 다시 읽는다.
// gallery와 fake는 provider로 고정 목록을 준다.
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  browserProfilesList,
  type BrowserProfile,
} from "../../../protocol/secrets/browser-vault.ts";
import { browserPartition } from "../../../protocol/shell/browser-profiles.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { followRead, type Read } from "../desktop/connection/core-read.ts";
import { useOptionalEventClient } from "../desktop/connection/events/hooks.tsx";

// provider가 준 고정 목록. 없으면(undefined) core에서 읽는다.
const FixedProfiles = createContext<readonly BrowserProfile[] | undefined>(
  undefined,
);

export function BrowserProfilesProvider(props: {
  profiles: readonly BrowserProfile[];
  children: ReactNode;
}) {
  return (
    <FixedProfiles.Provider value={props.profiles}>
      {props.children}
    </FixedProfiles.Provider>
  );
}

async function readProfiles(core: CoreSource): Read<readonly BrowserProfile[]> {
  const reply = await core.call({
    kind: "memory",
    resource: browserProfilesList.resource,
    method: browserProfilesList.method,
    body: {},
  });
  if (!reply.ok) {
    return {
      ok: false,
      ...(reply.error?.code === undefined ? {} : { code: reply.error.code }),
    };
  }
  const parsed = browserProfilesList.output.safeParse(reply.value);
  return parsed.success
    ? { ok: true, value: parsed.data.profiles }
    : { ok: false };
}

// null은 아직 읽지 못했다. 읽기가 실패해도 null로 둔다: 빈 목록으로 두면 profile 탭이 기본 partition(기본 profile의 cookie)으로
// 열린다. 읽을 길(event client)이 없으면(gallery) 빈 목록이다.
function useProfilesState(): readonly BrowserProfile[] | null {
  const fixed = useContext(FixedProfiles);
  const client = useOptionalEventClient();
  const [live, setLive] = useState<readonly BrowserProfile[] | null>(null);
  useEffect(() => {
    if (fixed !== undefined || client === null) return;
    const follow = followRead(
      client,
      readProfiles,
      ["browser_profiles"],
      (loaded) => {
        if (loaded.state === "ready") setLive(loaded.value);
      },
      () => new Date(),
    );
    return () => follow.stop();
  }, [fixed, client]);
  if (fixed !== undefined) return fixed;
  return client === null ? [] : live;
}

/** 사람이 만든 browser profile 목록. 기본 profile은 들지 않는다. 못 읽었거나 없으면 빈 목록이다. */
export function useBrowserProfiles(): readonly BrowserProfile[] {
  return useProfilesState() ?? [];
}

/** 탭의 profile(없으면 기본)이 쓸 partition. 목록에 없는 profile은 기본 partition이다. */
export function partitionOf(
  profile: string | undefined,
  known: readonly BrowserProfile[],
): string {
  return profile !== undefined && known.some((one) => one.id === profile)
    ? browserPartition(profile)
    : browserPartition(null);
}

/**
 * 탭의 partition. profile이 있는데 목록을 아직 읽지 못했으면 null이다: 그 사이 기본 partition으로 page를 만들면
 * 다른 profile의 cookie로 site에 가고, 같은 탭의 partition은 다시 바뀌지 않는다.
 */
export function useBrowserPartition(
  profile: string | undefined,
): string | null {
  const known = useProfilesState();
  if (profile === undefined) return browserPartition(null);
  return known === null ? null : partitionOf(profile, known);
}
