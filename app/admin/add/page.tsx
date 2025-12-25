import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import AddPositionsClient from './ui'

export default async function AddPage() {
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
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 opacity-80">Your account is not in the admins table.</p>
      </main>
    )
  }

  return <AddPositionsClient />
}
