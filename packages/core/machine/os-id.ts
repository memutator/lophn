// OS가 이 기계에 매긴 값. 복제 판정의 binding key로만 쓴다. systemd가 machine-id를 비밀로 다루라고 하므로
// 값은 log에도 file에도 남기지 않는다.
export type OsIdIo = {
  readFile(path: string): Promise<string>;
  exec(file: string, args: string[], timeoutMs: number): Promise<string>;
};

const TIMEOUT_MS = 5000;

const LINUX_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"];
const LINUX_ID = /^[0-9a-f]{32}$/;
const UUID =
  "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}";
const MAC_UUID = new RegExp(`"IOPlatformUUID" = "(${UUID})"`);
const WINDOWS_GUID = new RegExp(`MachineGuid\\s+REG_SZ\\s+(${UUID})`);

// 못 읽거나 꼴이 틀리거나 늦으면 null이다. null은 "같은 기계로 본다"로 이어지므로 던지지 않는다.
export async function readOsMachineId(
  platform: NodeJS.Platform,
  io: OsIdIo,
): Promise<string | null> {
  try {
    if (platform === "linux") {
      for (const path of LINUX_FILES) {
        const value = await io.readFile(path).then(
          (text) => text.trim(),
          () => "",
        );
        if (LINUX_ID.test(value)) return value;
      }
      return null;
    }
    if (platform === "darwin") {
      const out = await io.exec(
        "/usr/sbin/ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        TIMEOUT_MS,
      );
      return MAC_UUID.exec(out)?.[1]?.toLowerCase() ?? null;
    }
    if (platform === "win32") {
      // /reg:64: 32bit process가 WOW64 쪽 다른 값을 읽지 않게 한다.
      const out = await io.exec(
        "reg",
        [
          "query",
          "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
          "/v",
          "MachineGuid",
          "/reg:64",
        ],
        TIMEOUT_MS,
      );
      return WINDOWS_GUID.exec(out)?.[1]?.toLowerCase() ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
