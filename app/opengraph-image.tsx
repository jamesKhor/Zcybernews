import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "ZCyberNews — Cybersecurity & Tech Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(135deg, #0a0a0f 0%, #0d1117 50%, #161b22 100%)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #22d3ee, #06b6d4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "28px",
            fontWeight: 800,
            color: "#0a0a0f",
          }}
        >
          Z
        </div>
        <div
          style={{
            fontSize: "48px",
            fontWeight: 800,
            color: "#e5e7eb",
            letterSpacing: "-1px",
          }}
        >
          ZCyberNews
        </div>
      </div>
      <div
        style={{
          fontSize: "22px",
          color: "#9ca3af",
          maxWidth: "600px",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Cybersecurity & Tech Intelligence
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "40px",
          fontSize: "16px",
          color: "#4b5563",
        }}
      >
        zcybernews.com
      </div>
    </div>,
    { ...size },
  );
}
