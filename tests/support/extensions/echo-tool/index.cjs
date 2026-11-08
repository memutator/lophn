// extension tool 호출 길을 보는 test fixture다. 제품 roots에 두지 않고 test가 root를 주입한다.
exports.activate = (ctx) => {
  ctx.tools.handle("echo", (input) =>
    Promise.resolve({
      ok: true,
      value: [{ type: "text", text: JSON.stringify(input) }],
    }),
  );
};
exports.deactivate = () => {};
