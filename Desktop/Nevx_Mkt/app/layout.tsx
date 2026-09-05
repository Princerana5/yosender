import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEVX — Where Needs Meet Offers",
  description:
    "Post what you need. Find people who can help. Let NEVX handle the deal.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
