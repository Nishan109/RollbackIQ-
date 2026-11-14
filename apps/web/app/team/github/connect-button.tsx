import { PostForm } from "@/components/post-form";
export function ConnectButton({
  organization,
  installation,
  label,
}: {
  organization: string;
  installation?: number;
  label?: string;
}) {
  const buttonLabel = label ?? (installation ? "Refresh access" : "Connect GitHub");
  return (
    <PostForm
      action="/api/github/connect"
      label={buttonLabel}
      pendingLabel="Opening GitHub…"
      variant="primary"
    >
      <input type="hidden" name="organization" value={organization} />
      {installation && <input type="hidden" name="installation" value={installation} />}
    </PostForm>
  );
}
