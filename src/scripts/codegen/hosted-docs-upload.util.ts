/**
 * Shared helpers for optional hosted API doc uploads (Postman, Scalar Registry).
 * Upload scripts skip with exit 0 when credentials are unset (local dev, fork CI).
 */

export interface HostedUploadCredentialCheck {
  skip: boolean;
  missingVariables: string[];
}

export function checkHostedUploadCredentials(
  requiredVariableNames: readonly string[],
): HostedUploadCredentialCheck {
  const missingVariables = requiredVariableNames.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === '';
  });
  return {
    skip: missingVariables.length > 0,
    missingVariables,
  };
}

export function logHostedUploadSkipped(targetName: string, missingVariables: string[]): void {
  console.warn(
    `Skipping ${targetName} upload: missing ${missingVariables.join(', ')}. Set env vars to publish.`,
  );
}

/** Returns true when the upload should not run (caller should exit 0). */
export function shouldSkipHostedUpload(
  targetName: string,
  requiredVariableNames: readonly string[],
): boolean {
  const check = checkHostedUploadCredentials(requiredVariableNames);
  if (check.skip) {
    logHostedUploadSkipped(targetName, check.missingVariables);
    return true;
  }
  return false;
}
