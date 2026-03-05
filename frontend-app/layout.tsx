import React from "react"
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from 'sonner'
import { UserProvider } from '@/lib/user-context'
import { DemoClockProvider } from '@/lib/demo-clock-context'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'LOOK - 환자 전원 관리 시스템',
  description: 'LOOK: Human-in-the-loop Clinical Agent for patient transfer management',
  generator: 'v0.app',
  icons: {
    icon: '/look_img.png',
    apple: '/look_img.png',
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <UserProvider>
            <DemoClockProvider>
              {children}
            </DemoClockProvider>
          </UserProvider>
        </ThemeProvider>
        <Toaster position="top-right" richColors />
        <Analytics />
      </body>
    </html>
  )
}
