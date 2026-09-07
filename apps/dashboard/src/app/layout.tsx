import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GodView — Real-Time Product Analytics",
  description: "Privacy-conscious, real-time product analytics at the edge",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
