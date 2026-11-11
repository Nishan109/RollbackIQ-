"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { idSchema } from "@/lib/supabase/scans";
import { requireIdentity } from "@/lib/supabase/server";

const name = (max: number) => z.string().trim().min(1).max(max);

export async function createOrganization(form: FormData) {
  const value = name(100).safeParse(form.get("name"));
  if (!value.success) redirect("/team?notice=invalid");
  const { client } = await requireIdentity();
  const { error } = await client.rpc("rollbackiq_create_organization", { p_name: value.data });
  redirect(error ? "/team?notice=failed" : "/team?notice=organization");
}

export async function addRepository(form: FormData) {
  const value = z
    .object({ org: idSchema, name: name(140) })
    .safeParse({ org: form.get("organizationId"), name: form.get("name") });
  if (!value.success) redirect("/team?notice=invalid");
  const { client } = await requireIdentity();
  const { data, error } = await client.rpc("rollbackiq_add_repository", {
    p_organization_id: value.data.org,
    p_name: value.data.name,
  });
  redirect(error || !data ? "/team?notice=failed" : `/team/repositories/${data}`);
}

export async function setMember(form: FormData) {
  const value = z
    .object({ org: idSchema, user: idSchema, role: z.enum(["admin", "developer", "viewer"]) })
    .safeParse({
      org: form.get("organizationId"),
      user: form.get("userId"),
      role: form.get("role"),
    });
  if (!value.success) redirect("/team?notice=invalid");
  const { client } = await requireIdentity();
  const { error } = await client.rpc("rollbackiq_set_member", {
    p_organization_id: value.data.org,
    p_user_id: value.data.user,
    p_role: value.data.role,
  });
  redirect(error ? "/team?notice=failed" : "/team?notice=membership");
}

export async function reviewScan(form: FormData) {
  const value = z
    .object({ repo: idSchema, scan: idSchema, decision: z.enum(["needs_review", "reviewed"]) })
    .safeParse({
      repo: form.get("repositoryId"),
      scan: form.get("scanId"),
      decision: form.get("decision"),
    });
  if (!value.success) redirect("/team?notice=invalid");
  const { client } = await requireIdentity();
  const { error } = await client.rpc("rollbackiq_review_scan", {
    p_scan_id: value.data.scan,
    p_decision: value.data.decision,
  });
  redirect(
    `/team/repositories/${value.data.repo}?scan=${value.data.scan}&notice=${error ? "failed" : "reviewed"}`,
  );
}
