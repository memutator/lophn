// take-in·따라가기가 commit이 고정한 `@lophn/*` SDK 판을 이 lophn에서 찾지 못했을 때 사람이 할 일을 말하는 글. 고정한 판이
// 이 lophn의 판보다 옛 것이면 lophn을 올려도 소용이 없다: 앱을 지금 SDK로 옮긴 release가 나와야 한다.
import { readdir } from "node:fs/promises";
import { compareVersions } from "../../../base/mod.ts";

export type MissingSdk = {
  // `@lophn/<part>`
  name: string;
  // commit이 고정한 판.
  version: string;
  // 이 lophn이 가진 그 part의 가장 새 판. 하나도 없으면 null.
  installed: string | null;
};

const VERSION = /^\d+\.\d+\.\d+$/;

/** 이 lophn이 data root에 깐 SDK 사본 가운데 그 part의 가장 새 판. */
export async function installedSdkVersion(
  dataRoot: string,
  name: string,
): Promise<string | null> {
  const part = name.slice("@lophn/".length);
  const versions = await readdir(`${dataRoot}/sdk/${part}`).catch(
    () => [] as string[],
  );
  return (
    versions
      .filter((version) => VERSION.test(version))
      .sort(compareVersions)
      .at(-1) ?? null
  );
}

export async function missingSdkOf(
  dataRoot: string,
  pins: readonly { name: string; version: string }[],
): Promise<MissingSdk[]> {
  return Promise.all(
    pins.map(async (pin) => ({
      ...pin,
      installed: await installedSdkVersion(dataRoot, pin.name),
    })),
  );
}

/** 빠진 판마다 이 lophn이 더 새면 앱을 옮기라고, 더 옛 것이거나 없으면 lophn을 올리라고 말한다. */
export function sdkMissingMessage(missing: readonly MissingSdk[]): string {
  const pin = (one: MissingSdk) => `${one.name}@${one.version}`;
  const older = missing.filter(
    (one) =>
      one.installed !== null && compareVersions(one.installed, one.version) > 0,
  );
  const newer = missing.filter((one) => !older.includes(one));
  const parts: string[] = [];
  if (newer.length > 0) {
    parts.push(
      `this lophn does not have ${newer.map(pin).join(", ")}; update lophn on this machine`,
    );
  }
  if (older.length > 0) {
    parts.push(
      `the app was built with ${older.map(pin).join(", ")}, older than this lophn's ${older
        .map((one) => `${one.name}@${one.installed}`)
        .join(
          ", ",
        )}; update the app to the current SDK on a computer that runs it (its agent releases it again), then take it in here`,
    );
  }
  return parts.join("; ");
}
