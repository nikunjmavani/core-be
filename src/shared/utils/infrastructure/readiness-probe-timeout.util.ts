/**
 * Races {@link incomingPromise} against a timer. Used by `/health` so a slow
 * dependency does not wedge the readiness handler.
 */
export function readinessProbeTimeout<T>(
  incomingPromise: Promise<T>,
  timeoutMilliseconds: number,
  probeLabelForErrors: string,
): Promise<T> {
  return Promise.race([
    incomingPromise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`health_ready_timeout:${probeLabelForErrors}`));
      }, timeoutMilliseconds);
    }),
  ]);
}
