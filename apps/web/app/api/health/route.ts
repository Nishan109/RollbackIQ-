import { releaseVersion, workerProtocol } from "@/lib/release";

export function GET() {
  return Response.json(
    { status: "ok", release: releaseVersion(), workerProtocol },
    { headers: { "Cache-Control": "no-store" } },
  );
}
