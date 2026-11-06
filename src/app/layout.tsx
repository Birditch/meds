import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "药品余量",
  description: "药品余量与服用周期推算：按日、按早中晚推演每种药能吃到哪一天。",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <footer className="mt-auto border-t py-6 text-center text-xs text-muted-foreground">
            © 2026 Birditch · 以{" "}
            <a className="underline-offset-4 hover:underline" href="https://github.com/Birditch/meds/blob/main/LICENSE">
              MIT 许可证
            </a>{" "}
            开源 ·{" "}
            <a className="underline-offset-4 hover:underline" href="https://github.com/Birditch/meds">
              GitHub
            </a>
          </footer>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
