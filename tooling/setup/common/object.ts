/**
 * Small object helpers shared across the setup-infra module.
 */

/**
 * Strip keys whose value is `undefined`. Lets callers build options objects with
 * conditional fields without the `...(x !== undefined ? { x } : {})` spread dance
 * (and without tripping `exactOptionalPropertyTypes`).
 */
export function omitUndefined<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const result: { [K in keyof T]?: Exclude<T[K], undefined> } = {};
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) result[key] = value[key] as Exclude<T[typeof key], undefined>;
  }
  return result;
}
