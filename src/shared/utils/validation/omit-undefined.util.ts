/**
 * Removes keys whose value is `undefined` so objects satisfy `exactOptionalPropertyTypes`.
 */
export type OmitUndefinedKeys<T extends Record<string, unknown>> = {
  [K in keyof T as undefined extends T[K] ? never : K]: Exclude<T[K], undefined>;
};

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
