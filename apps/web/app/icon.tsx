import { ImageResponse } from "next/og";

export const size = { width: 48, height: 48 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        background: "#5656de",
        color: "white",
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: -2,
      }}
    >
      RI
    </div>,
    size,
  );
}
