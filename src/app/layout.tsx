import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ReelCraft",
  description: "貼一段小說，出一集短劇。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
