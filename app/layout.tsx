import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRT Lab",
  description: "Test Candle Range Theory and SMC entry rules on years of real prices, and see every trade they would have taken."
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
