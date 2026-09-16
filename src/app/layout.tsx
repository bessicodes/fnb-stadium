import type { Metadata, Viewport } from 'next'

import { Nav } from '@/components/Nav'
import { stadiumCounts } from '@/queries/read'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'FNB Stadium Admin',
    template: '%s · FNB Stadium Admin',
  },
  description:
    'Vendor, kiosk, storage and load-out operations for FNB Stadium: compliance-gated allocation, live loader dispatch and post-event stock reconciliation.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#16130f',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const counts = await stadiumCounts()

  const groups = [
    {
      label: 'Operations',
      items: [
        { href: '/', label: 'Control board' },
        { href: '/dispatch', label: 'Loader dispatch' },
        { href: '/events', label: 'Events' },
      ],
    },
    {
      label: 'The building',
      items: [
        { href: '/kiosks', label: 'Kiosks', count: counts.kiosks },
        { href: '/storage', label: 'Storage', count: counts.rooms },
        { href: '/crews', label: 'Crews', count: counts.crews },
      ],
    },
    {
      label: 'Trade',
      items: [
        { href: '/vendors', label: 'Vendors', count: counts.vendors },
        { href: '/stock', label: 'Stock', count: counts.items },
      ],
    },
  ]

  return (
    <html lang="en-ZA">
      <body>
        <div className="shell">
          <Nav groups={groups} />
          <main className="main">
            <div className="mainInner">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}
