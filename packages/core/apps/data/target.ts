// worker route target의 형태. supervision/responsiveness의 것과 같은 모양이지만
// packages/core/apps는 core의 platform 쪽 module을 직접 부르지 않으므로(code-map) 이 자리에 둔다.
export type WorkerRouteHandle = {
  observation(): { component: string; available: boolean; observed_at: string };
  forward(
    request: unknown,
    bytes?: Uint8Array,
  ): Promise<unknown>;
};

export type WorkerRouteTarget = {
  handle: WorkerRouteHandle;
};
