import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RFE Prototype Test-Bed",
  description: "A modular research environment for audio routing, controls and diagnostics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
