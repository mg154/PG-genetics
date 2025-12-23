import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import AdminClient from './ui'

export default async function AdminPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // This should now work (no RLS recursion issue)
  const { data: adminRow, error } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Admin check error</h1>
        <pre className="mt-4 whitespace-pre-wrap rounded-xl border p-4 text-sm">{error.message}</pre>
      </main>
    )
  }

  if (!adminRow) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 opacity-80">Your account is not in the admins table.</p>
        <p className="mt-2 opacity-80">User ID: {user.id}</p>
      </main>
    )
  }

  return <AdminClient email={user.email ?? ''} />
}
