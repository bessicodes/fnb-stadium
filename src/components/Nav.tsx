'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The stadium's shell: a gourd bowl, clay-clad, ringed by a band of glass. */
function Mark() {
  return (
    <svg className="navMark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.4c-.9 0-1.6.5-2 1.2C5.9 5.6 3 9 3 13.1 3 17.5 7 21 12 21s9-3.5 9-7.9c0-4.1-2.9-7.5-7-8.5-.4-.7-1.1-1.2-2-1.2Z"
        fill="#b8501b"
      />
      <path
        d="M4.6 11.4c2 1.4 4.6 2.2 7.4 2.2s5.4-.8 7.4-2.2"
        stroke="#f7f3ee"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M12 3.4v10.2" stroke="#f7f3ee" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

type Item = { href: string; label: string; count?: number }

export function Nav({
  groups,
}: {
  groups: Array<{ label: string; items: Item[] }>
}) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <nav className="nav">
      <Link href="/" className="navBrand">
        <Mark />
        <span>
          <span className="navName">FNB Stadium</span>
          <span className="navVenue">Admin</span>
        </span>
      </Link>

      {groups.map((group) => (
        <div className="navGroup" key={group.label}>
          <div className="navGroupLabel">{group.label}</div>
          <div className="navLinks">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="navLink"
                data-active={isActive(item.href)}
              >
                <span>{item.label}</span>
                {item.count !== undefined ? (
                  <span className="navCount">{item.count}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="navFoot">
        Stadium Management
        <br />
        Nasrec, Johannesburg
      </div>
    </nav>
  )
}
