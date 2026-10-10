export interface Evaluator {
  eval_string(code: string): any;
}
export interface QueryPlan {
  query: string;
  inputs: string[];
  transform: string | null;
  view: string | null;
  rules: string | null;
}
const literal = (s: string) => JSON.stringify(s);
export function initRules(engine: Evaluator, source: string) {
  engine.eval_string(source);
  engine.eval_string(
    `(ns complete-export.query (:require [logseq.db.frontend.rules :as rules]))`,
  );
}
export function planQuery(engine: Evaluator, source: string): QueryPlan {
  return engine.eval_string(`(ns complete-export.query)
    (let [spec (read-string ${literal(source)})
          spec (if (map? spec) spec {:query spec})
          query (:query spec)
          _ (when-not (and (vector? query) (= :find (first query))) (throw (js/Error. "Advanced query must contain a :find vector")))
          names (set (keep #(when (and (seq? %) (symbol? (first %))) (keyword (name (first %)))) (tree-seq coll? seq query)))
          builtin (rules/extract-rules rules/db-query-dsl-rules (filter #(contains? rules/db-query-dsl-rules %) names) :deps rules/rules-dependencies)
          in-index (first (keep-indexed #(when (= %2 :in) %1) query))
          end-index (when in-index (or (first (keep-indexed #(when (and (> %1 in-index) (keyword? %2)) %1) query)) (count query)))
          in-forms (if in-index (subvec query (inc in-index) end-index) ['$])
          rule-index (first (keep-indexed (fn [index value] (when (= value (symbol "%")) index)) (remove #{'$} in-forms)))
          provided-rules (when (some? rule-index) (nth (:inputs spec) rule-index nil))
          all-rules (vec (distinct (concat (or (:rules spec) []) (or provided-rules []) builtin)))
          query (if (and (seq all-rules) (nil? rule-index))
                  (if in-index (vec (concat (subvec query 0 end-index) ['%] (subvec query end-index))) (into query [:in '$ '%])) query)
          inputs (vec (map pr-str (:inputs spec)))
          inputs (if (and (seq all-rules) (nil? rule-index)) (conj inputs (pr-str all-rules))
                   (if (and (seq all-rules) (some? rule-index))
                     (if (< rule-index (count inputs)) (assoc inputs rule-index (pr-str all-rules)) (conj inputs (pr-str all-rules))) inputs))]
      (clj->js {:query (pr-str query) :inputs inputs :rules (when (seq all-rules) (pr-str all-rules))
        :transform (when (:result-transform spec) (pr-str (:result-transform spec)))
        :view (when (:view spec) (pr-str (:view spec)))}))`);
}
export function applyQueryFunction(
  engine: Evaluator,
  fn: string,
  data: any,
  definitions: Record<string, any> = {},
): any {
  const code = fn.startsWith(":")
    ? (definitions[fn.slice(1)] ?? definitions[fn])
    : fn;
  if (typeof code !== "string")
    throw new Error(`Missing query function definition: ${fn}`);
  return engine.eval_string(`(ns complete-export.query)
    (let [f ${code} result (js->clj (js/JSON.parse ${literal(JSON.stringify(data))}) :keywordize-keys true)] (clj->js (f result)))`);
}
export function queryEntity(value: any): any {
  if (Array.isArray(value)) return value.map(queryEntity);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, any> = {};
  for (const [key, v] of Object.entries(value)) {
    const target =
      key === "id"
        ? "db/id"
        : [
              "uuid",
              "title",
              "name",
              "content",
              "page",
              "parent",
              "order",
              "refs",
              "tags",
            ].includes(key)
          ? "block/" + key
          : key.replace(/^:/, "");
    result[target] = queryEntity(v);
  }
  return result;
}
