'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

type Row = {
  id: string
  gene_mutation: string
  age_min: number
  age_max: number
  sex: 'M' | 'F'
  recommendations: string
}

export default function AdminClient({ email }: { email: string }) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [geneMutation, setGeneMutation] = useState('')
  const [ageMin, setAgeMin] = useState<number>(0)
  const [ageMax, setAgeMax] = useState<number>(0)
  const [sex, setSex] = useState<'M' | 'F'>('M')
  const [recs, setRecs] = useState('')

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function loadRows() {
    setError(null)
    setLoading(true)

    const { data, error } = await supabase
      .from('mutation_recommendations')
      .select('id, gene_mutation, age_min, age_max, sex, recommendations, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setRows((data ?? []) as Row[])
    setLoading(false)
  }

  useEffect(() => {
    loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addRow() {
    setError(null)

    if (!geneMutation.trim()) return setError('Gene mutation is required.')
    if (ageMin < 0 || ageMax < 0 || ageMax < ageMin)
      return setError('Age range invalid: age_max must be >= age_min and both >= 0.')
    if (!recs.trim()) return setError('Recommendations are required.')

    const { error } = await supabase.from('mutation_recommendations').insert({
      gene_mutation: geneMutation.trim(),
      age_min: ageMin,
      age_max: ageMax,
      sex,
      recommendations: recs.trim(),
    })

    if (error) return setError(error.message)

    setGeneMutation('')
    setAgeMin(0)
    setAgeMax(0)
    setSex('M')
    setRecs('')
    await loadRows()
  }

  async function updateRow(id: string, patch: Partial<Row>) {
    setError(null)
    const { error } = await supabase.from('mutation_recommendations').update(patch).eq('id', id)
    if (error) return setError(error.message)
    await loadRows()
  }

  async function deleteRow(id: string) {
    setError(null)
    if (!confirm('Delete this row?')) return
    const { error } = await supabase.from('mutation_recommendations').delete().eq('id', id)
    if (error) return setError(error.message)
    await loadRows()
  }

  return (
    <main className="p-6 space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin area</h1>
          <p className="mt-2 opacity-80">Logged in as: {email}</p>
        </div>

        <button className="rounded-xl border px-4 py-3" onClick={logout}>
          Log out
        </button>
      </header>

      <section className="rounded-2xl border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Add a new recommendation</h2>

        {error && <div className="rounded-xl border p-3 text-sm">{error}</div>}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm">Gene mutation</label>
            <input
              className="w-full rounded-xl border p-3"
              value={geneMutation}
              onChange={(e) => setGeneMutation(e.target.value)}
              placeholder="e.g. BRCA1 c.68_69delAG"
            />
          </div>

          <div className="grid gap-3 grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm">Age min</label>
              <input
                className="w-full rounded-xl border p-3"
                type="number"
                value={ageMin}
                onChange={(e) => setAgeMin(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm">Age max</label>
              <input
                className="w-full rounded-xl border p-3"
                type="number"
                value={ageMax}
                onChange={(e) => setAgeMax(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm">Sex</label>
            <select
              className="w-full rounded-xl border p-3"
              value={sex}
              onChange={(e) => setSex(e.target.value as 'M' | 'F')}
            >
              <option value="M">Male (M)</option>
              <option value="F">Female (F)</option>
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-sm">Recommendations</label>
            <textarea
              className="w-full rounded-xl border p-3 min-h-[120px]"
              value={recs}
              onChange={(e) => setRecs(e.target.value)}
              placeholder="Write recommendations..."
            />
          </div>
        </div>

        <button className="rounded-xl border px-4 py-3" onClick={addRow}>
          Add row
        </button>
      </section>

      <section className="rounded-2xl border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Existing rows</h2>
          <button className="rounded-xl border px-4 py-2" onClick={loadRows}>
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="opacity-80">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="opacity-80">No rows yet.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.id} className="rounded-2xl border p-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm">Gene mutation</label>
                    <input
                      className="w-full rounded-xl border p-3"
                      defaultValue={r.gene_mutation}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v !== r.gene_mutation) updateRow(r.id, { gene_mutation: v })
                      }}
                    />
                  </div>

                  <div className="grid gap-3 grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm">Age min</label>
                      <input
                        className="w-full rounded-xl border p-3"
                        type="number"
                        defaultValue={r.age_min}
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (v !== r.age_min) updateRow(r.id, { age_min: v })
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm">Age max</label>
                      <input
                        className="w-full rounded-xl border p-3"
                        type="number"
                        defaultValue={r.age_max}
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (v !== r.age_max) updateRow(r.id, { age_max: v })
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm">Sex</label>
                    <select
                      className="w-full rounded-xl border p-3"
                      defaultValue={r.sex}
                      onChange={(e) => updateRow(r.id, { sex: e.target.value as 'M' | 'F' })}
                    >
                      <option value="M">Male (M)</option>
                      <option value="F">Female (F)</option>
                    </select>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label className="text-sm">Recommendations</label>
                    <textarea
                      className="w-full rounded-xl border p-3 min-h-[120px]"
                      defaultValue={r.recommendations}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v !== r.recommendations) updateRow(r.id, { recommendations: v })
                      }}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button className="rounded-xl border px-4 py-2" onClick={() => deleteRow(r.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
