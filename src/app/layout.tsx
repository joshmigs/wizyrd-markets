import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import "@/styles/globals.css";
import SiteFooter from "@/app/components/SiteFooter";
import SiteHeader from "@/app/components/SiteHeader";
import WizyrdPromptDock from "@/app/components/WizyrdPromptDock";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap"
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Wizyrd Fantasy Markets",
  description: "Fantasy leagues for financial markets.",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" }
    ],
    apple: "/apple-touch-icon.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${fraunces.variable} font-sans`}>
        <div className="relative min-h-screen md:pr-20 lg:pr-20 xl:pr-0">
          <SiteHeader />
          {children}
          <SiteFooter />
          <WizyrdPromptDock />
        </div>
      </body>
    </html>
  );
}
