import { PillIcon } from "lucide-react";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import { LiveRefresh } from "@/components/live-refresh";
import { SiteNav } from "@/components/meds/site-nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "药品余量", template: "%s · 药品余量" },
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
          <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 px-4 sm:px-6">
              <Link href="/" className="flex items-center gap-2.5 py-2.5" aria-label="药品余量（回到药品）">
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <PillIcon className="size-4" />
                </span>
                <span className="font-semibold tracking-tight">药品余量</span>
              </Link>
              <SiteNav className="w-full sm:w-auto" />
            </div>
          </header>
          <main className="mx-auto grid w-full max-w-6xl content-start gap-6 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
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
          <LiveRefresh />
        </ThemeProvider>
      </body>
    </html>
  );
}
