import scittleUrl from "scittle/dist/scittle.js?url";
import rules from "./logseq-db-rules.cljc?raw";
import { initRules, type Evaluator } from "./query-engine";
let loading: Promise<Evaluator> | undefined;
export function engine(): Promise<Evaluator> {
  loading ??= new Promise<Evaluator>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scittleUrl;
    script.onload = () => {
      try {
        const e = (window as any).scittle.core;
        initRules(e, rules);
        resolve(e);
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () =>
      reject(new Error("Could not load the bundled query evaluator."));
    document.head.append(script);
  });
  return loading;
}
