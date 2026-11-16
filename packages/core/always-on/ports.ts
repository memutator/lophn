// OS 등록과 keep-awake의 port. `os/`가 구현하고 core 입구가 설치 layout일 때만 `startCore`의 `alwaysOn`으로 준다.
// `always-os`가 같은 모양을 따로 적어 구현하므로 모양을 바꾸지 않는다.

export type ServiceEnv = { PATH: string; TMPDIR?: string };

export type Registration =
  // OS가 답했다: 항목이 있고, 지금 쓸 내용과 같고, 켜져 있다
  | { state: "registered" }
  // 이 data root의 항목이 없다
  | { state: "absent" }
  // 항목은 있으나 지금 쓸 내용(실행 경로, entry, data root, env)과 다르다
  | { state: "stale" }
  // 항목은 있으나 OS나 사람이 OS 설정에서 껐다
  | { state: "off_in_system" }
  | {
      state: "unavailable";
      reason: "no_service_manager" | "unverified_path" | "os_failed";
    };

export type Registrar = {
  mechanism: "systemd" | "launchd" | "windows_run";
  read(env: ServiceEnv): Promise<Registration>;
  // 쓰고 켠다(OS 설정에서 꺼진 것도 다시 켠다). 끝에 read한 값
  register(env: ServiceEnv): Promise<Registration>;
  // 지운다. 도는 core를 멈추지 않는다. 끝에 read한 값
  unregister(): Promise<Registration>;
};

export type KeepAwake = {
  hold(): Promise<
    | { state: "held" }
    | { state: "unavailable"; reason: "no_inhibitor" | "os_failed" }
  >;
  release(): void;
  // 쥔 child가 스스로 끝났을 때 한 번 부른다(OS가 거절, 명령 없음).
  onLost(listener: (reason: "no_inhibitor" | "os_failed") => void): void;
};

export type AlwaysOnOs = {
  registrar: Registrar;
  keepAwake: KeepAwake;
  captureEnv(): ServiceEnv;
};

export type AlwaysOnHost = (dataRoot: string) => AlwaysOnOs;
