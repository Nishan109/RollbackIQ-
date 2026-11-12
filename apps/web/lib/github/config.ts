export function githubAppSettings() {
  const appId = Number(process.env.GITHUB_APP_ID);
  const slug = process.env.GITHUB_APP_SLUG;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (
    !Number.isSafeInteger(appId) ||
    appId <= 0 ||
    !slug ||
    !/^[\w-]+$/.test(slug) ||
    !clientId ||
    !privateKey
  )
    return null;
  let origin: string;
  try {
    origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
  } catch {
    return null;
  }
  if (!origin.startsWith("https:") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    return null;
  return { appId, slug, clientId, privateKey, origin };
}

export function githubSettings() {
  const app = githubAppSettings();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  return app && clientSecret && webhookSecret ? { ...app, clientSecret, webhookSecret } : null;
}

export function githubReady() {
  return (
    !!githubSettings() &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
