let loading: Promise<unknown> | undefined;
export async function readClassColors(
  classes: string[],
): Promise<Record<string, string>> {
  if (!classes.length) return {};
  const sdk = logseq as typeof logseq & {
    _execCallableAPIAsync(method: string, ...args: unknown[]): Promise<unknown>;
  };
  // Route the bundled host helper over the SDK transport, not cross-origin DOM access.
  loading ??= sdk
    ._execCallableAPIAsync(
      "exper_load_scripts",
      logseq.baseInfo.id,
      logseq.resolveResourceFullUrl("./export-colors.js"),
    )
    .catch((error) => {
      loading = undefined;
      throw error;
    });
  await loading;
  return new Promise((resolve, reject) => {
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
    const host = window.parent;
    const timer = setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Logseq color helper did not respond."));
    }, 5000);
    function receive(event: MessageEvent) {
      if (
        event.source !== host ||
        event.data?.type !== "complete-export:colors" ||
        event.data.id !== id ||
        !event.data.colors ||
        typeof event.data.colors !== "object"
      )
        return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      const colors: Record<string, string> = {};
      for (const name of classes) {
        const color = event.data.colors?.[name];
        if (typeof color === "string" && /^rgba?\([\d.,\s]+\)$/.test(color))
          colors[name] = color;
      }
      resolve(colors);
    }
    window.addEventListener("message", receive);
    host.postMessage({ type: "complete-export:colors", id, classes }, "*");
  });
}
