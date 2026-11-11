import { apiJson } from "@/lib/bounded-json";
import { githubReady, githubSettings } from "@/lib/github/config";
import { githubStore } from "@/lib/github/store";
import { receiveWebhook } from "@/lib/github/webhook";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const settings = githubSettings();
  if (!settings || !githubReady()) return apiJson({ error: "GitHub App is unconfigured." }, 503);
  return receiveWebhook(request, settings.webhookSecret, githubStore());
}
