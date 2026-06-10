import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ZEUS CSMS",
  description: "Charging Station Management System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="bg-gray-950">
      <body className={`${inter.className} bg-gray-950 min-h-screen`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
