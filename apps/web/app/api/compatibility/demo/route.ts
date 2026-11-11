import { getCompatibilityDemo } from "@/lib/compatibility-demo";

export const runtime = "nodejs";
let lastWindow = 0;
let requests = 0;

export async function POST() {
  const now = Date.now();
  if (now - lastWindow >= 60000) {
    lastWindow = now;
    requests = 0;
  }
  if (++requests > 30)
    return Response.json(
      { error: "The demo analyzer is busy. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  try {
    const start = performance.now();
    const report = await getCompatibilityDemo();
    return Response.json(
      { report, durationMs: Math.round(performance.now() - start) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error(JSON.stringify({ event: "compatibility_demo_failed" }));
    return Response.json(
      { error: "The demo analysis could not complete." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
