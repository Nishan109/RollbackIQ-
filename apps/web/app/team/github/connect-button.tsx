import { PostForm } from "@/components/post-form";
export function ConnectButton({
  organization,
  installation,
  label,
  install = false,
}: {
  organization: string;
  installation?: number;
  label?: string;
  install?: boolean;
}) {
  const buttonLabel = label ?? (installation ? "Refresh access" : "Connect GitHub");
  return (
    <PostForm
      action="/api/github/connect"
      label={buttonLabel}
      pendingLabel="Opening GitHub…"
      variant="primary"
      newTab
    >
      <input type="hidden" name="organization" value={organization} />
      {!install && <input type="hidden" name="authorize" value="on" />}
      {installation && <input type="hidden" name="installation" value={installation} />}
    </PostForm>
  );
}
