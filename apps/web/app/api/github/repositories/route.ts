import { githubPost } from "@/lib/github/routes";
export const runtime = "nodejs";
export const POST = githubPost("repositories");
