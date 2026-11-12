export const workerProtocol = 2;

export function releaseVersion() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.ROLLBACKIQ_RELEASE;
  return value && /^[0-9a-f]{40}$/.test(value) ? value : null;
}
