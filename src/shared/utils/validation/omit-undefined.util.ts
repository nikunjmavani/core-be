/**
 * Removes keys whose value is `undefined` so objects satisfy `exactOptionalPropertyTypes`.
 */
export type OmitUndefinedKeys<T extends Record<string, unknown>> = {
  [K in keyof T as undefined extends T[K] ? never : K]: Exclude<T[K], undefined>;
};

/**
 * Returns a shallow copy of `record` with every `undefined`-valued key
 * removed. Used to satisfy TypeScript's `exactOptionalPropertyTypes` when
 * spreading optional fields into typed object literals.
 */
export function omitUndefined<T extends Record<string, unknown>>(record: T): OmitUndefinedKeys<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record) as (keyof T)[]) {
    // eslint-disable-next-line security/detect-object-injection -- key from Object.keys iteration of caller-owned record.
    const value = record[key];
    if (value !== undefined) {
      result[key as string] = value;
    }
  }
  return result as OmitUndefinedKeys<T>;
}
