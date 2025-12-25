import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import AdminNav from './nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: adminRow } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!adminRow) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Not authorized</h1>
        <p className="mt-2 opacity-80">Your account is not in the admins table.</p>
      </main>
    )
  }

  return <AdminNav email={user.email ?? ''}>{children}</AdminNav>
}
