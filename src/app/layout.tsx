import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/context/ThemeContext";
import { SocketProvider } from "@/context/SocketContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { SessionProvider } from "@/components/SessionProvider";
import { AccessibilityProvider } from "@/components/AccessibilityProvider";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "ChatFlow - Real-time Chat Application",
  description: "A modern real-time messaging platform with instant delivery and user presence indicators",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white dark:bg-gray-900`}
      >
        <a 
          href="#main-content" 
          className="skip-link focus:top-6"
        >
          Skip to main content
        </a>
        <SessionProvider>
          <ThemeProvider>
            <AccessibilityProvider>
              <SocketProvider>
                <NotificationProvider>
                  <main id="main-content" tabIndex={-1}>
                    {children}
                  </main>
                </NotificationProvider>
              </SocketProvider>
            </AccessibilityProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
