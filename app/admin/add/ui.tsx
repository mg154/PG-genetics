'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

type Gene = { id: string; symbol: string; name: string | null }
type RecClass = { id: string; gene_id: string; name: string; created_at: string }
type GroupRow = {
  id: string
  gene_id: string
  sex: 'M' | 'F' | null
  age_min: number | null
  age_max: number | null
  recommendations: string
  created_at: string
  applies_to_all_classes: boolean
}
type GroupClassLink = { group_id: string; class_id: string }
type MutationRow = {
  id: string
  gene_id: string
  mutation: string
  pathogenicity: 'pathogenic' | 'likely_pathogenic'
  created_at: string
}
type MutGroupLink = { mutation_id: string; group_id: string }
type RiskRow = { id: string; gene_id: string; sex: 'M' | 'F'; risk: string; created_at: string }

type Pathogenicity = 'pathogenic' | 'likely_pathogenic'
type MutDraftRow = { mutation: string; pathogenicity: Pathogenicity }

function clsButton(base: string, busy: boolean) {
  return `${base} ${busy ? 'opacity-60 cursor-not-allowed' : 'active:translate-y-[1px]'}`
}

function prettyAge(min: number | null, max: number | null) {
  const a = min == null ? 'any' : String(min)
  const b = max == null ? 'any' : String(max)
  return `${a}–${b}`
}

function parseOptionalInt(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function ensureTrailingEmptyRow(rows: MutDraftRow[]) {
  const last = rows[rows.length - 1]
  if (!last) return [{ mutation: '', pathogenicity: 'pathogenic' as const }]
  if (last.mutation.trim() !== '') {
    return [...rows, { mutation: '', pathogenicity: last.pathogenicity }]
  }
  return rows
}

export default function AddPositionsClient() {
  const supabase = useMemo(() => createClient(), [])

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const setBusyKey = (k: string, v: boolean) => setBusy((p) => ({ ...p, [k]: v }))

  // Loaded data
  const [genes, setGenes] = useState<Gene[]>([])
  const [classes, setClasses] = useState<RecClass[]>([])
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [groupClassLinks, setGroupClassLinks] = useState<GroupClassLink[]>([])

  // 1) Add gene
  const [geneSymbol, setGeneSymbol] = useState('')
  const [geneName, setGeneName] = useState('')

  // 2) Add recommendation group
  const [groupGeneId, setGroupGeneId] = useState('')
  const [groupSexChoice, setGroupSexChoice] = useState<'ANY' | 'M' | 'F'>('ANY')
  const [groupAgeMinStr, setGroupAgeMinStr] = useState('')
  const [groupAgeMaxStr, setGroupAgeMaxStr] = useState('')
  const [groupRecs, setGroupRecs] = useState('')

  // classes for group (multi)
  const [groupAllClasses, setGroupAllClasses] = useState(false)
  const [groupSelectedClassIds, setGroupSelectedClassIds] = useState<string[]>([])
  const [newClassName, setNewClassName] = useState('')

  // 3) Add mutations group
  const [mutGeneId, setMutGeneId] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [mutRows, setMutRows] = useState<MutDraftRow[]>(
    ensureTrailingEmptyRow([{ mutation: '', pathogenicity: 'pathogenic' }])
  )

  // 4) Add risk (should be in /add)
  const [riskGeneId, setRiskGeneId] = useState('')
  const [riskSex, setRiskSex] = useState<'ANY' | 'M' | 'F'>('ANY')
  const [riskText, setRiskText] = useState('')

  const geneMap = useMemo(() => {
    const m = new Map<string, Gene>()
    genes.forEach((g) => m.set(g.id, g))
    return m
  }, [genes])

  const classMap = useMemo(() => {
    const m = new Map<string, RecClass>()
    classes.forEach((c) => m.set(c.id, c))
    return m
  }, [classes])

  const groupsForGene = useMemo(() => {
    if (!mutGeneId) return []
    return groups
      .filter((g) => g.gene_id === mutGeneId)
      .slice()
      .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
  }, [groups, mutGeneId])

  const groupToClassIds = useMemo(() => {
    const m = new Map<string, string[]>()
    groupClassLinks.forEach((l) => {
      const prev = m.get(l.group_id) ?? []
      prev.push(l.class_id)
      m.set(l.group_id, prev)
    })
    return m
  }, [groupClassLinks])

  async function loadGenes() {
    const { data, error } = await supabase.from('genes').select('id,symbol,name').order('symbol')
    if (error) throw error
    setGenes((data ?? []) as Gene[])
  }

  async function loadClassesForGene(geneId: string) {
    if (!geneId) {
      setClasses([])
      return
    }
    const { data, error } = await supabase
      .from('recommendation_classes')
      .select('id,gene_id,name,created_at')
      .eq('gene_id', geneId)
      .order('name')
    if (error) throw error
    setClasses((data ?? []) as RecClass[])
  }

  async function loadGroupsForGene(geneId: string) {
    if (!geneId) {
      setGroups([])
      setGroupClassLinks([])
      return
    }

    const { data: gData, error: gErr } = await supabase
      .from('recommendation_groups')
      .select('id,gene_id,sex,age_min,age_max,recommendations,created_at,applies_to_all_classes')
      .eq('gene_id', geneId)
      .order('created_at', { ascending: false })
    if (gErr) throw gErr
    const gRows = (gData ?? []) as GroupRow[]
    setGroups(gRows)

    const groupIds = gRows.map((x) => x.id)
    if (groupIds.length === 0) {
      setGroupClassLinks([])
      return
    }

    const { data: linkData, error: linkErr } = await supabase
      .from('recommendation_group_classes')
      .select('group_id,class_id')
      .in('group_id', groupIds)
    if (linkErr) throw linkErr
    setGroupClassLinks((linkData ?? []) as GroupClassLink[])
  }

  async function refreshAll() {
    setError(null)
    setBusyKey('refresh', true)
    try {
      await loadGenes()
      // keep /add working even if user already selected something
      if (groupGeneId) await loadClassesForGene(groupGeneId)
      if (mutGeneId) await loadGroupsForGene(mutGeneId)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusyKey('refresh', false)
    }
  }

  useEffect(() => {
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When gene changes for groups, load gene-specific classes
  useEffect(() => {
    ;(async () => {
      setError(null)
      try {
        await loadClassesForGene(groupGeneId)
        setGroupSelectedClassIds([])
        setGroupAllClasses(false)
        setNewClassName('')
      } catch (e: any) {
        setError(e?.message ?? String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupGeneId])

  // When gene changes for mutation linkage, load groups for that gene
  useEffect(() => {
    ;(async () => {
      setError(null)
      try {
        await loadGroupsForGene(mutGeneId)
        setSelectedGroupIds([])
      } catch (e: any) {
        setError(e?.message ?? String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutGeneId])

  async function addGene() {
    setError(null)
    const symbol = geneSymbol.trim().toUpperCase()
    const name = geneName.trim() || null
    if (!symbol) return setError('Gene symbol is required.')

    setBusyKey('addGene', true)
    try {
      const { error } = await supabase.from('genes').insert({ symbol, name })
      if (error) throw error
      setGeneSymbol('')
      setGeneName('')
      await loadGenes()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusyKey('addGene', false)
    }
  }

  async function addClassForGene() {
    setError(null)
    const geneId = groupGeneId
    if (!geneId) return setError('Pick a gene first (in section 2).')
    const nm = newClassName.trim()
    if (!nm) return setError('Class name cannot be empty.')

    setBusyKey('addClass', true)
    try {
      const { error } = await supabase.from('recommendation_classes').insert({ gene_id: geneId, name: nm })
      if (error) throw error
      setNewClassName('')
      await loadClassesForGene(geneId)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusyKey('addClass', false)
    }
  }

  function toggleClassPick(id: string) {
    setGroupSelectedClassIds((prev: string[]) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id]
    })
  }

  function selectAllClasses() {
    setGroupSelectedClassIds(classes.map((c) => c.id))
  }

  function clearAllClasses() {
    setGroupSelectedClassIds([])
  }

  async function addRecommendationGroup() {
    setError(null)
    const gene_id = groupGeneId
    if (!gene_id) return setError('Pick a gene (section 2).')
    const recommendations = groupRecs.trim()
    if (!recommendations) return setError('Recommendations text is required.')

    const sex = groupSexChoice === 'ANY' ? null : (groupSexChoice as 'M' | 'F')
    const age_min = parseOptionalInt(groupAgeMinStr)
    const age_max = parseOptionalInt(groupAgeMaxStr)

    const applies_to_all_classes = groupAllClasses

    if (!applies_to_all_classes && groupSelectedClassIds.length === 0) {
      return setError('Pick at least one class OR choose “Applies to all classes”.')
    }

    setBusyKey('addGroup', true)
    try {
      const { data: inserted, error: insErr } = await supabase
        .from('recommendation_groups')
        .insert({
          gene_id,
          sex,
          age_min,
          age_max,
          recommendations,
          applies_to_all_classes,
        })
        .select('id')
        .single()

      if (insErr) throw insErr
      const group_id = inserted?.id as string

      if (!applies_to_all_classes) {
        const rows = groupSelectedClassIds.map((class_id) => ({ group_id, class_id }))
        const { error: linkErr } = await supabase.from('recommendation_group_classes').insert(rows)
        if (linkErr) throw linkErr
      }

      // reset form
      setGroupSexChoice('ANY')
      setGroupAgeMinStr('')
      setGroupAgeMaxStr('')
      setGroupRecs('')
      setGroupAllClasses(false)
      setGroupSelectedClassIds([])

      // refresh group list for whichever gene is used in section 3 if same
      if (mutGeneId === gene_id) await loadGroupsForGene(mutGeneId)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusyKey('addGroup', false)
    }
  }

  function toggleGroupPick(id: string) {
    setSelectedGroupIds((prev: string[]) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id]
    })
  }

  function selectAllGroups() {
    const ids = groupsForGene.map((g) => g.id)
    setSelectedGroupIds(ids)
  }

  function clearAllGroups() {
    setSelectedGroupIds([])
  }

  function setRowMutation(i: number, value: string) {
    setMutRows((prev: MutDraftRow[]) => {
      const next = [...prev]
      next[i] = { ...next[i], mutation: value }
      return ensureTrailingEmptyRow(next)
    })
  }

  function setRowPath(i: number, value: Pathogenicity) {
    setMutRows((prev: MutDraftRow[]) => {
      const next = [...prev]
      next[i] = { ...next[i], pathogenicity: value }
      return ensureTrailingEmptyRow(next)
    })
  }

  function removeRow(i: number) {
    setMutRows((prev: MutDraftRow[]) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((_, idx) => idx !== i)
      return ensureTrailingEmptyRow(next)
    })
  }

  async function addMutationsAndLink() {
    setError(null)
    const gene_id = mutGeneId
    if (!gene_id) return setError('Pick a gene in section 3 first.')
    if (selectedGroupIds.length === 0) return setError('Pick at least 1 recommendation group in section 3.')

    const cleaned = mutRows
      .map((r) => ({ mutation: r.mutation.trim(), pathogenicity: r.pathogenicity }))
      .filter((r) => r.mutation !== '')

    if (cleaned.length === 0) return setError('Enter at least 1 mutation.')

    setBusyKey('addMutations', true)
    try {
      // upsert mutations by (gene_id, mutation)
      const upsertRows = cleaned.map((r) => ({
        gene_id,
        mutation: r.mutation,
        pathogenicity: r.pathogenicity,
      }))

      const { data: muts, error: upErr } = await supabase
        .from('gene_mutations')
        .upsert(upsertRows as any, { onConflict: 'gene_id,mutation' })
        .select('id,mutation')

      if (upErr) throw upErr
      const inserted = (muts ?? []) as Array<{ id: string; mutation: string }>

      // Link mutations to groups
      const linkRows: MutGroupLink[] = []
      for (const m of inserted) {
        for (const gid of selectedGroupIds) linkRows.push({ mutation_id: m.id, group_id: gid })
      }

      // avoid duplicates if constraint exists
      const { error: linkErr } = await supabase
        .from('gene_mutation_groups')
        .upsert(linkRows as any, { onConflict: 'mutation_id,group_id' })

      if (linkErr) throw linkErr

      // reset rows but keep 1 empty row
      setMutRows(ensureTrailingEmptyRow([{ mutation: '', pathogenicity: 'pathogenic' }]))
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusyKey('addMutations', false)
    }
  }

  async function addRisk() {
    setError(null)
    const gene_id = riskGeneId
    if (!gene_id) return setError('Pick a gene in section 4.')
    const risk = riskText.trim()
    if (!risk) return setError('Risk text is required.')

    setBusyKey('addRisk', true)
    try {
      const { error } = await supabase.from('gene_risks').insert({
        gene_id,
        sex: riskSex === 'ANY' ? null : riskSex,
        risk,
      } as any)
      if (error) throw error
      setRiskText('')
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusyKey('addRisk', false)
    }
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Add positions to the database</h1>
          <p className="mt-2 opacity-80">Use the sections below to add genes, recommendations, mutation links, and risks.</p>
        </div>

        <button
          className={clsButton('rounded-xl border px-4 py-2', !!busy.refresh)}
          disabled={!!busy.refresh}
          onClick={refreshAll}
        >
          {busy.refresh ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="rounded-xl border p-3 text-sm">{error}</div>}

      {/* 1) Add gene */}
      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="text-lg font-semibold">1) Add a gene</h2>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm">Gene symbol</label>
            <input
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={geneSymbol}
              onChange={(e) => setGeneSymbol(e.target.value)}
              placeholder="e.g., BRCA1"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">Gene name (optional)</label>
            <input
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={geneName}
              onChange={(e) => setGeneName(e.target.value)}
              placeholder="optional"
            />
          </div>
        </div>

        <button
          className={clsButton('rounded-xl border px-4 py-3', !!busy.addGene)}
          disabled={!!busy.addGene}
          onClick={addGene}
        >
          {busy.addGene ? 'Adding…' : 'Add gene'}
        </button>
      </section>

      {/* 2) Add recommendation group */}
      <section className="rounded-2xl border p-4 space-y-4">
        <h2 className="text-lg font-semibold">2) Add a recommendation</h2>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm">Gene</label>
            <select
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={groupGeneId}
              onChange={(e) => setGroupGeneId(e.target.value)}
            >
              <option value="">Select gene…</option>
              {genes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.symbol}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm">Sex (optional)</label>
            <select
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={groupSexChoice}
              onChange={(e) => setGroupSexChoice(e.target.value as any)}
            >
              <option value="ANY">Any</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm">Age min (optional)</label>
            <input
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={groupAgeMinStr}
              onChange={(e) => setGroupAgeMinStr(e.target.value)}
              placeholder="leave blank for any"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">Age max (optional)</label>
            <input
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={groupAgeMaxStr}
              onChange={(e) => setGroupAgeMaxStr(e.target.value)}
              placeholder="leave blank for any"
            />
          </div>
        </div>

        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Recommendation classes (gene-specific)</div>
              <div className="text-xs opacity-70">Pick multiple classes, or use “applies to all”.</div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={groupAllClasses}
                onChange={(e) => setGroupAllClasses(e.target.checked)}
              />
              Applies to all classes (including new)
            </label>
          </div>

          {!groupAllClasses && (
            <>
              <div className="flex gap-2 flex-wrap">
                <button className="rounded-xl border px-3 py-2 text-sm active:translate-y-[1px]" onClick={selectAllClasses}>
                  Select all
                </button>
                <button className="rounded-xl border px-3 py-2 text-sm active:translate-y-[1px]" onClick={clearAllClasses}>
                  Clear
                </button>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {classes.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded-xl border p-2">
                    <input
                      type="checkbox"
                      checked={groupSelectedClassIds.includes(c.id)}
                      onChange={() => toggleClassPick(c.id)}
                    />
                    <span className="text-sm">{c.name}</span>
                  </label>
                ))}
                {groupGeneId && classes.length === 0 && (
                  <div className="text-sm opacity-80">No classes for this gene yet. Add one below.</div>
                )}
              </div>
            </>
          )}

          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              placeholder="Type new class name (e.g., typical) and click Add class"
            />
            <button
              className={clsButton('rounded-xl border px-4 py-3', !!busy.addClass)}
              disabled={!!busy.addClass}
              onClick={addClassForGene}
            >
              {busy.addClass ? 'Adding…' : 'Add class'}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm">Recommendations</label>
          <textarea
            className="w-full rounded-xl border p-3 min-h-[140px] bg-black text-white"
            value={groupRecs}
            onChange={(e) => setGroupRecs(e.target.value)}
            placeholder="Write recommendations here…"
          />
        </div>

        <button
          className={clsButton('rounded-xl border px-4 py-3', !!busy.addGroup)}
          disabled={!!busy.addGroup}
          onClick={addRecommendationGroup}
        >
          {busy.addGroup ? 'Saving…' : 'Add recommendation group'}
        </button>
      </section>

      {/* 3) Add mutations group */}
      <section className="rounded-2xl border p-4 space-y-4">
        <h2 className="text-lg font-semibold">3) Add a mutations group</h2>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm">Gene</label>
            <select
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={mutGeneId}
              onChange={(e) => setMutGeneId(e.target.value)}
            >
              <option value="">Select gene…</option>
              {genes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {mutGeneId && (
          <div className="rounded-xl border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Pick recommendation(s) for this gene</div>
              <div className="flex gap-2">
                <button className="rounded-xl border px-3 py-2 text-sm active:translate-y-[1px]" onClick={selectAllGroups}>
                  Select all
                </button>
                <button className="rounded-xl border px-3 py-2 text-sm active:translate-y-[1px]" onClick={clearAllGroups}>
                  Clear
                </button>
              </div>
            </div>

            <div className="overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="opacity-80">
                  <tr className="border-b">
                    <th className="p-2 text-left">Use</th>
                    <th className="p-2 text-left">Sex</th>
                    <th className="p-2 text-left">Age</th>
                    <th className="p-2 text-left">Classes</th>
                    <th className="p-2 text-left">Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {groupsForGene.map((g) => {
                    const classIds = groupToClassIds.get(g.id) ?? []
                    const classNames = g.applies_to_all_classes
                      ? 'ALL'
                      : classIds
                          .map((id) => classMap.get(id)?.name)
                          .filter(Boolean)
                          .join(', ') || '—'

                    return (
                      <tr key={g.id} className="border-b">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={selectedGroupIds.includes(g.id)}
                            onChange={() => toggleGroupPick(g.id)}
                          />
                        </td>
                        <td className="p-2">{g.sex ?? 'ANY'}</td>
                        <td className="p-2">{prettyAge(g.age_min, g.age_max)}</td>
                        <td className="p-2">{classNames}</td>
                        <td className="p-2">{g.recommendations}</td>
                      </tr>
                    )
                  })}
                  {groupsForGene.length === 0 && (
                    <tr>
                      <td className="p-2 opacity-70" colSpan={5}>
                        No recommendations for this gene yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs opacity-70">
              Tip: you can select multiple recommendations — the mutations you add below will be linked to all selected groups.
            </div>
          </div>
        )}

        <div className="rounded-xl border p-3 space-y-3">
          <div className="text-sm font-semibold">Mutations (type one per row)</div>

          <div className="space-y-2">
            {mutRows.map((r, idx) => (
              <div key={idx} className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] items-center">
                <input
                  className="w-full rounded-xl border p-3 bg-black text-white"
                  value={r.mutation}
                  onChange={(e) => setRowMutation(idx, e.target.value)}
                  placeholder="e.g., c.5266dupC"
                />

                <div className="flex rounded-xl border overflow-hidden">
                  <button
                    className={`px-3 py-2 text-sm ${r.pathogenicity === 'pathogenic' ? 'opacity-100' : 'opacity-60'} active:translate-y-[1px]`}
                    onClick={() => setRowPath(idx, 'pathogenic')}
                    type="button"
                  >
                    Pathogenic
                  </button>
                  <button
                    className={`px-3 py-2 text-sm border-l ${r.pathogenicity === 'likely_pathogenic' ? 'opacity-100' : 'opacity-60'} active:translate-y-[1px]`}
                    onClick={() => setRowPath(idx, 'likely_pathogenic')}
                    type="button"
                  >
                    Likely Pathogenic
                  </button>
                </div>

                <button
                  className="rounded-xl border px-3 py-2 text-sm active:translate-y-[1px]"
                  onClick={() => removeRow(idx)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button
            className={clsButton('rounded-xl border px-4 py-3', !!busy.addMutations)}
            disabled={!!busy.addMutations}
            onClick={addMutationsAndLink}
          >
            {busy.addMutations ? 'Saving…' : 'Add mutations + link to selected recommendation groups'}
          </button>
        </div>
      </section>

      {/* 4) Add risk */}
      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="text-lg font-semibold">4) Add risk</h2>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm">Gene</label>
            <select
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={riskGeneId}
              onChange={(e) => setRiskGeneId(e.target.value)}
            >
              <option value="">Select gene…</option>
              {genes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.symbol}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm">Sex</label>
            <select
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={riskSex}
              onChange={(e) => setRiskSex(e.target.value as any)}
            >
               <option value="ANY">Any</option>
               <option value="F">Female</option>
               <option value="M">Male</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm">Risk</label>
          <textarea
            className="w-full rounded-xl border p-3 min-h-[110px] bg-black text-white"
            value={riskText}
            onChange={(e) => setRiskText(e.target.value)}
            placeholder="e.g., Increased risk of breast cancer…"
          />
        </div>

        <button
          className={clsButton('rounded-xl border px-4 py-3', !!busy.addRisk)}
          disabled={!!busy.addRisk}
          onClick={addRisk}
        >
          {busy.addRisk ? 'Saving…' : 'Add risk'}
        </button>
      </section>
    </main>
  )
}
