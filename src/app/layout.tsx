import type { Metadata, Viewport } from "next";
import "@fontsource-variable/doto";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import { healScript } from "@/lib/self-heal";

/* Fonts are bundled with the app (no request to Google at build or run time) */

export const metadata: Metadata = {
  title: "NanoCLI Studio",
  description: "Write TypeScript in your browser, compile it to a native binary with scriptc, and run it.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

/*
 * Applies the saved theme before first paint so there is no flash.
 * Kept tiny and dependency-free on purpose.
 */
const themeScript = `try{var s=JSON.parse(localStorage.getItem('nanocli:settings')||'{}');var c=document.documentElement.classList;if(s.theme==='light'){c.remove('dark');c.add('light')}if(s.highContrast)c.add('hc');var v=JSON.parse(localStorage.getItem('nanocli:appearance-vars')||'null');if(v){var m=v[s.theme==='light'?'light':'dark'];for(var k in m)document.documentElement.style.setProperty(k,m[k])}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="dark h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: healScript }} />
      </head>
      <body className="min-h-full flex flex-col text-gray-100">
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
