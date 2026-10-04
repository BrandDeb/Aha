import type { Metadata, Viewport } from "next";
import { Doto, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/* Display: dot-matrix, used sparingly (wordmark, hero) */
const doto = Doto({
  variable: "--font-doto",
  subsets: ["latin"],
  weight: ["700", "900"],
});

/* Body */
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

/* Code, data, captions */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

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
const themeScript = `try{var s=JSON.parse(localStorage.getItem('nanocli:settings')||'{}');var c=document.documentElement.classList;if(s.theme==='light'){c.remove('dark');c.add('light')}if(s.highContrast)c.add('hc')}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${doto.variable} ${hanken.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col text-gray-100">
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
