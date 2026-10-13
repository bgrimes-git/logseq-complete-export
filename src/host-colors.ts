let loading: Promise<unknown> | undefined;
export async function readClassColors(
  classes: string[],
  marks: string[] = [],
): Promise<{
  colors: Record<string, string>;
  highlights: Record<string, string>;
}> {
  try {
    return await readOnce(classes, marks);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !["COLOR_HELPER_LOAD_FAILED", "COLOR_HELPER_TIMEOUT"].includes(
        error.message,
      )
    )
      throw error;
    loading = undefined;
    return readOnce(classes, marks);
  }
}

async function readOnce(
  classes: string[],
  marks: string[],
): Promise<{
  colors: Record<string, string>;
  highlights: Record<string, string>;
}> {
  if (!classes.length && !marks.length) return { colors: {}, highlights: {} };
  const sdk = logseq as typeof logseq & {
    _execCallableAPIAsync(method: string, ...args: unknown[]): Promise<unknown>;
  };
  if (typeof sdk._execCallableAPIAsync !== "function")
    throw new Error("COLOR_TRANSPORT_UNAVAILABLE");
  // Route the bundled host helper over the SDK transport, not cross-origin DOM access.
  loading ??= sdk
    ._execCallableAPIAsync(
      "exper_load_scripts",
      logseq.baseInfo.id,
      logseq.resolveResourceFullUrl("dist/export-colors.js") + "?styles=v2",
    )
    .catch(() => {
      loading = undefined;
      throw new Error("COLOR_HELPER_LOAD_FAILED");
    });
  await loading;
  return new Promise((resolve, reject) => {
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
    const host = window.parent;
    const timer = setTimeout(() => {
      window.removeEventListener("message", receive);
      loading = undefined;
      reject(new Error("COLOR_HELPER_TIMEOUT"));
    }, 5000);
    function receive(event: MessageEvent) {
      if (
        event.source !== host ||
        event.data?.type !== "complete-export:styles-v2" ||
        event.data.id !== id ||
        !event.data.colors ||
        typeof event.data.colors !== "object"
      )
        return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      const colors: Record<string, string> = {};
      for (const name of [...classes, ...marks.map((name) => `mark:${name}`)]) {
        const color = event.data.colors?.[name];
        if (typeof color === "string" && /^rgba?\([\d.,\s]+\)$/.test(color))
          colors[name] = color;
      }
      const highlights: Record<string, string> = {};
      for (const name of marks) {
        const color = event.data.highlights?.[name];
        if (typeof color === "string" && /^rgba?\([\d.,\s]+\)$/.test(color))
          highlights[name] = color;
      }
      resolve({ colors, highlights });
    }
    window.addEventListener("message", receive);
    host.postMessage(
      { type: "complete-export:styles-v2", id, classes, marks },
      "*",
    );
  });
}
