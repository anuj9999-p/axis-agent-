import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AXIS — Anuj Shukla's AI Interface",
  description:
    "A holographic orb interface built with Three.js and Next.js — the visual front-end for Anuj Shukla's personal AI, controllable with your hands through your webcam.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
