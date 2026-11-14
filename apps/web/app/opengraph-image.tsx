import { ImageResponse } from "next/og";

export const alt = "RollbackIQ · PostgreSQL migration compatibility";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 26,
        background: "linear-gradient(140deg, #090d16, #202650)",
        width: "100%",
        height: "100%",
        padding: 82,
        color: "#f8fafc",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 15, fontSize: 30, fontWeight: 700 }}
      >
        <div
          style={{ display: "flex", width: 22, height: 22, background: "#a5b4fc", borderRadius: 6 }}
        />
        RollbackIQ
      </div>
      <div style={{ display: "flex", fontSize: 72, fontWeight: 750, maxWidth: 960 }}>
        Catch migration risks before you deploy.
      </div>
      <div style={{ display: "flex", fontSize: 26, color: "#c5cef5" }}>
        PostgreSQL compatibility · GitHub Checks · JSON and SARIF
      </div>
    </div>,
    size,
  );
}
