import type { Metadata, Viewport } from "next";
import "@fontsource-variable/doto";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import { healScript } from "@/lib/self-heal";
import { storageMigrationScript } from "@/lib/legacy-names";
import { SITE, siteUrl } from "@/lib/site";

/* Fonts are bundled with the app (no request to Google at build or run time) */

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE.name} · ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  publisher: SITE.publisher,
  category: "technology",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE.name, title: `${SITE.name} · ${SITE.tagline}`, description: SITE.description, url: "/", locale: "en_US" },
  twitter: { card: "summary_large_image", title: `${SITE.name} · ${SITE.tagline}`, description: SITE.description },
  icons: { icon: [{ url: "/favicon.ico" }, { url: "/icon.svg", type: "image/svg+xml" }], apple: "/icon.svg" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

/*
 * Applies the saved theme before first paint so there is no flash.
 * Kept tiny and dependency-free on purpose.
 */
const themeScript = `try{var s=JSON.parse(localStorage.getItem('aha:settings')||'{}');var c=document.documentElement.classList;if(s.theme==='light'){c.remove('dark');c.add('light')}if(s.highContrast)c.add('hc');var v=JSON.parse(localStorage.getItem('aha:appearance-vars')||'null');if(v){var m=v[s.theme==='light'?'light':'dark'];for(var k in m)document.documentElement.style.setProperty(k,m[k])}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="dark h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: storageMigrationScript + themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: healScript }} />
      </head>
      <body className="min-h-full flex flex-col text-gray-100">
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
