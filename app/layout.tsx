import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRT Lab",
  description: "Daily and weekly CRT setups on live prices, a call with your checklist percent when there is an entry, and every trade the rules would have taken."
};

export const viewport: Viewport = {
  themeColor: "#131922",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
