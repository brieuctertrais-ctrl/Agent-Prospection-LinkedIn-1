import type { Metadata } from "next";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@kairo/shared";
import { getLocale } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} ${PRODUCT_TAGLINE}`,
  description: "Assistant IA de prospection LinkedIn",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
