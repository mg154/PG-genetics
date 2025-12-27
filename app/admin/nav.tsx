'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function AdminNav({
  email,
  children,
}: {
  email: string
  children: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const currentLabel = pathname?.startsWith('/admin/edit')
    ? 'Edit positions'
    : pathname?.startsWith('/admin/generator')
      ? 'Generator'
      : 'Add positions'

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function go(path: string) {
    setOpen(false)
    router.push(path)
  }

  return (
    <div className="min-h-screen">
      <header className="p-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-2 opacity-80 text-sm">Logged in as: {email}</p>
        </div>

        <div className="relative">
          <button
            className="rounded-xl border px-4 py-3"
            onClick={() => setOpen((v) => !v)}
          >
            Menu · {currentLabel}
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl border bg-black p-2 shadow-lg">
              <button
                className="w-full text-left rounded-xl px-3 py-2 hover:opacity-80"
                onClick={() => go('/admin/add')}
              >
                1) Add positions to the database
              </button>

              <button
                className="w-full text-left rounded-xl px-3 py-2 hover:opacity-80"
                onClick={() => go('/admin/edit')}
              >
                2) Edit positions in the database
              </button>

              <button
                className="w-full text-left rounded-xl px-3 py-2 hover:opacity-80"
                onClick={() => go('/admin/generator')}
              >
                3) Recommendation generator
              </button>

              <div className="my-2 border-t opacity-50" />

              <button
                className="w-full text-left rounded-xl px-3 py-2 hover:opacity-80"
                onClick={logout}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="p-6 pt-0">{children}</main>
    </div>
  )
}
