'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

type Sex = 'M' | 'F' | 'ANY'
type RiskSex = 'M' | 'F' | 'ANY'
type Pathogenicity = 'pathogenic' | 'likely_pathogenic'

type Gene = { id: string; symbol: string; name: string | null; created_at?: string | null }
type RecClass = { id: string; gene_id: string; name: string; created_at?: string | null }

type RecGroup = {
  id: string
  gene_id: string
  sex: Sex
  age_min: number | null
  age_max: number | null
  recommendations: string
  created_at?: string | null
  applies_to_all_classes: boolean
  // legacy column exists in DB, but we ignore it to avoid ambiguity:
  class_id?: string | null
}

type GroupClassLink = { group_id: string; class_id: string; created_at?: string | null }

type MutationRow = {
  id: string
  gene_id: string
  mutation: string
  pathogenicity: Pathogenicity
  created_at?: string | null
}

type MutationGroupLink = { mutation_id: string; group_id: string; created_at?: string | null }
type MutationClassLink = { mutation_id: string; class_id: string; created_at?: string | null }

type RiskRow = { id: string; gene_id: string; sex: RiskSex; risk: string; created_at?: string | null }

function sexLabel(s: Sex) {
  return s === 'M' ? 'M' : s === 'F' ? 'F' : 'ANY'
}
function parseSexFromUI(v: string): Sex {
  if (v === 'M') return 'M'
  if (v === 'F') return 'F'
  return 'ANY'
}

function prettyAge(min: number | null, max: number | null) {
  const a = min == null ? 'any' : String(min)
  const b = max == null ? 'any' : String(max)
  if (min == null && max == null) return 'any age'
  if (min != null && max == null) return `≥ ${a}`
  if (min == null && max != null) return `≤ ${b}`
  return `${a}–${b}`
}

function btn(base: string, busy?: boolean) {
  return `${base} transition active:translate-y-[1px] active:opacity-80 ${busy ? 'opacity-60 cursor-not-allowed' : ''}`
}

function groupMatchesClass(group: RecGroup, classId: string | null, groupClassIds: Map<string, Set<string>>) {
  if (!classId) return true
  if (group.applies_to_all_classes) return true
  const ids = groupClassIds.get(group.id) ?? new Set<string>()
  return ids.has(classId)
}

export default function EditPositionsClient() {
  const supabase = useMemo(() => createClient(), [])

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const setBusyKey = (k: string, v: boolean) => setBusy((p) => ({ ...p, [k]: v }))

  const [genes, setGenes] = useState<Gene[]>([])
  const [classes, setClasses] = useState<RecClass[]>([])
  const [groups, setGroups] = useState<RecGroup[]>([])
  const [groupClassLinks, setGroupClassLinks] = useState<GroupClassLink[]>([])
  const [mutations, setMutations] = useState<MutationRow[]>([])
  const [mutationLinks, setMutationLinks] = useState<MutationGroupLink[]>([])
  const [mutationClassLinks, setMutationClassLinks] = useState<MutationClassLink[]>([])
  const [risks, setRisks] = useState<RiskRow[]>([])

  // drafts keyed by id
  const [geneDraft, setGeneDraft] = useState<Record<string, { symbol: string; name: string }>>({})
  const [classDraft, setClassDraft] = useState<Record<string, { name: string }>>({})
  const [groupDraft, setGroupDraft] = useState<
    Record<
      string,
      {
        sexUI: 'ANY' | 'M' | 'F'
        ageMin: string
        ageMax: string
        recs: string
        appliesAll: boolean
      }
    >
  >({})
  const [groupClassPick, setGroupClassPick] = useState<Record<string, Record<string, boolean>>>({})
  const [mutationDraft, setMutationDraft] = useState<Record<string, { mutation: string; pathogenicity: Pathogenicity }>>({})
  const [mutationGroupPick, setMutationGroupPick] = useState<Record<string, Record<string, boolean>>>({})
  const [mutationClassPick, setMutationClassPick] = useState<Record<string, Record<string, boolean>>>({})
  const [riskDraft, setRiskDraft] = useState<Record<string, { sex: RiskSex; risk: string }>>({})

  // dropdown state
  const [openGeneId, setOpenGeneId] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<Record<string, { recs: boolean; muts: boolean; risks: boolean }>>({})

  // per-mutation UI helper (bulk pick by class)
  const [mutBulkClassIdByMutation, setMutBulkClassIdByMutation] = useState<Record<string, string>>({})

  function toggleGene(geneId: string) {
    setOpenGeneId((cur) => (cur === geneId ? null : geneId))
  }

  function toggleSection(geneId: string, key: 'recs' | 'muts' | 'risks') {
    const cur = openSection[geneId] ?? { recs: false, muts: false, risks: false }
    const next = !cur[key]

    // If we are OPENING the section, init drafts for whatever will render there
    if (next) {
      if (key === 'recs') {
        ;(classesByGene.get(geneId) ?? []).forEach(initClassDraft)
        ;(groupsByGene.get(geneId) ?? []).forEach(initGroupDraft)
      }
      if (key === 'muts') (mutationsByGene.get(geneId) ?? []).forEach((mu) => initMutationDraft(mu))
      if (key === 'risks') (risksByGene.get(geneId) ?? []).forEach(initRiskDraft)
    }

    setOpenSection((p) => ({
      ...p,
      [geneId]: { ...(p[geneId] ?? cur), [key]: next },
    }))
  }

  function parseOptionalInt(s: string): number | null {
    const t = s.trim()
    if (!t) return null
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    return Math.trunc(n)
  }

  async function loadAll() {
    setError(null)
    setBusyKey('load', true)
    try {
      const g = await supabase.from('genes').select('id,symbol,name,created_at').order('symbol', { ascending: true })
      if (g.error) throw g.error
      setGenes(g.data ?? [])

      const c = await supabase.from('recommendation_classes').select('id,gene_id,name,created_at').order('name', { ascending: true })
      if (c.error) throw c.error
      setClasses(c.data ?? [])

      const rg = await supabase
        .from('recommendation_groups')
        .select('id,gene_id,sex,age_min,age_max,recommendations,created_at,applies_to_all_classes')
        .order('created_at', { ascending: false })
      if (rg.error) throw rg.error
      setGroups(rg.data ?? [])

      const gl = await supabase.from('recommendation_group_classes').select('group_id,class_id,created_at')
      if (gl.error) throw gl.error
      setGroupClassLinks(gl.data ?? [])

      const m = await supabase.from('gene_mutations').select('id,gene_id,mutation,pathogenicity,created_at').order('created_at', { ascending: false })
      if (m.error) throw m.error
      setMutations(m.data ?? [])

      const ml = await supabase.from('gene_mutation_groups').select('mutation_id,group_id,created_at')
      if (ml.error) throw ml.error
      setMutationLinks(ml.data ?? [])

      // Optional table: gene_mutation_classes
      const mcl = await supabase.from('gene_mutation_classes').select('mutation_id,class_id,created_at')
      if (mcl.error) {
        // If the user hasn't created the table yet, we just ignore it (admin UI still works with direct group links).
        if ((mcl.error as any).code !== '42P01') throw mcl.error
        setMutationClassLinks([])
      } else {
        setMutationClassLinks(mcl.data ?? [])
      }

      const r = await supabase.from('gene_risks').select('id,gene_id,sex,risk,created_at').order('created_at', { ascending: false })
      if (r.error) throw r.error
      setRisks(r.data ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load data.')
    } finally {
      setBusyKey('load', false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // computed maps
  const classesByGene = useMemo(() => {
    const m = new Map<string, RecClass[]>()
    for (const c of classes) {
      if (!m.has(c.gene_id)) m.set(c.gene_id, [])
      m.get(c.gene_id)!.push(c)
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => a.name.localeCompare(b.name))
      m.set(k, arr)
    }
    return m
  }, [classes])

  const groupsByGene = useMemo(() => {
    const m = new Map<string, RecGroup[]>()
    for (const g of groups) {
      if (!m.has(g.gene_id)) m.set(g.gene_id, [])
      m.get(g.gene_id)!.push(g)
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      m.set(k, arr)
    }
    return m
  }, [groups])

  const groupClassIds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of groupClassLinks) {
      if (!m.has(l.group_id)) m.set(l.group_id, new Set())
      m.get(l.group_id)!.add(l.class_id)
    }
    return m
  }, [groupClassLinks])

  const mutationsByGene = useMemo(() => {
    const m = new Map<string, MutationRow[]>()
    for (const mu of mutations) {
      if (!m.has(mu.gene_id)) m.set(mu.gene_id, [])
      m.get(mu.gene_id)!.push(mu)
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      m.set(k, arr)
    }
    return m
  }, [mutations])

  const mutationGroupIds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of mutationLinks) {
      if (!m.has(l.mutation_id)) m.set(l.mutation_id, new Set())
      m.get(l.mutation_id)!.add(l.group_id)
    }
    return m
  }, [mutationLinks])

  const mutationClassIds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of mutationClassLinks) {
      if (!m.has(l.mutation_id)) m.set(l.mutation_id, new Set())
      m.get(l.mutation_id)!.add(l.class_id)
    }
    return m
  }, [mutationClassLinks])

  const risksByGene = useMemo(() => {
    const m = new Map<string, RiskRow[]>()
    for (const r of risks) {
      if (!m.has(r.gene_id)) m.set(r.gene_id, [])
      m.get(r.gene_id)!.push(r)
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      m.set(k, arr)
    }
    return m
  }, [risks])

  // ---------- init draft helpers ----------
  function initGeneDraft(g: Gene) {
    setGeneDraft((p) => {
      if (p[g.id]) return p
      return { ...p, [g.id]: { symbol: g.symbol ?? '', name: g.name ?? '' } }
    })
  }

  function initClassDraft(c: RecClass) {
    setClassDraft((p) => {
      if (p[c.id]) return p
      return { ...p, [c.id]: { name: c.name ?? '' } }
    })
  }

  function initGroupDraft(gr: RecGroup) {
    setGroupDraft((p) => {
      if (p[gr.id]) return p
      return {
        ...p,
        [gr.id]: {
          sexUI: gr.sex === 'M' ? 'M' : gr.sex === 'F' ? 'F' : 'ANY',
          ageMin: gr.age_min == null ? '' : String(gr.age_min),
          ageMax: gr.age_max == null ? '' : String(gr.age_max),
          recs: gr.recommendations ?? '',
          appliesAll: !!gr.applies_to_all_classes,
        },
      }
    })

    setGroupClassPick((p) => {
      if (p[gr.id]) return p
      const current = groupClassIds.get(gr.id) ?? new Set<string>()
      const map: Record<string, boolean> = {}
      for (const cid of current) map[cid] = true
      return { ...p, [gr.id]: map }
    })
  }

  function initMutationDraft(mu: MutationRow) {
    setMutationDraft((p) => {
      if (p[mu.id]) return p
      return { ...p, [mu.id]: { mutation: mu.mutation ?? '', pathogenicity: mu.pathogenicity } }
    })

    setMutationGroupPick((p) => {
      if (p[mu.id]) return p
      const current = mutationGroupIds.get(mu.id) ?? new Set<string>()
      const map: Record<string, boolean> = {}
      for (const gid of current) map[gid] = true
      return { ...p, [mu.id]: map }
    })

    setMutationClassPick((p) => {
      if (p[mu.id]) return p
      const current = mutationClassIds.get(mu.id) ?? new Set<string>()
      const map: Record<string, boolean> = {}
      for (const cid of current) map[cid] = true
      return { ...p, [mu.id]: map }
    })
  }

  function initRiskDraft(r: RiskRow) {
    setRiskDraft((p) => {
      if (p[r.id]) return p
      return { ...p, [r.id]: { sex: r.sex, risk: r.risk ?? '' } }
    })
  }

  // ---------- actions ----------
  async function saveGene(geneId: string) {
    setError(null)
    const d = geneDraft[geneId]
    if (!d) return
    const symbol = d.symbol.trim()
    const name = d.name.trim() || null
    if (!symbol) {
      setError('Gene symbol cannot be empty.')
      return
    }

    setBusyKey(`gene:${geneId}`, true)
    try {
      const { error } = await supabase.from('genes').update({ symbol, name }).eq('id', geneId)
      if (error) throw error
      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save gene.')
    } finally {
      setBusyKey(`gene:${geneId}`, false)
    }
  }

  async function saveClass(classId: string) {
    setError(null)
    const d = classDraft[classId]
    if (!d) return
    const name = d.name.trim()
    if (!name) return setError('Class name cannot be empty.')

    setBusyKey(`class:${classId}`, true)
    try {
      const { error } = await supabase.from('recommendation_classes').update({ name }).eq('id', classId)
      if (error) throw error
      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save class.')
    } finally {
      setBusyKey(`class:${classId}`, false)
    }
  }

  async function deleteGroup(groupId: string) {
    setError(null)
    setBusyKey(`delgroup:${groupId}`, true)
    try {
      // remove links first
      const a = await supabase.from('gene_mutation_groups').delete().eq('group_id', groupId)
      if (a.error) throw a.error
      const b = await supabase.from('recommendation_group_classes').delete().eq('group_id', groupId)
      if (b.error) throw b.error

      const { error } = await supabase.from('recommendation_groups').delete().eq('id', groupId)
      if (error) throw error
      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete recommendation group.')
    } finally {
      setBusyKey(`delgroup:${groupId}`, false)
    }
  }

  async function saveGroup(gr: RecGroup) {
    setError(null)
    const d = groupDraft[gr.id]
    if (!d) return

    const sex = parseSexFromUI(d.sexUI)
    const age_min = parseOptionalInt(d.ageMin)
    const age_max = parseOptionalInt(d.ageMax)
    const recommendations = d.recs

    setBusyKey(`group:${gr.id}`, true)
    try {
      const { error: upErr } = await supabase
        .from('recommendation_groups')
        .update({
          sex,
          age_min,
          age_max,
          recommendations,
          applies_to_all_classes: d.appliesAll,
        })
        .eq('id', gr.id)

      if (upErr) throw upErr

      // handle class assignment:
      // IMPORTANT: when appliesAll=true, DB triggers manage class links.
      // We do NOT delete links here (otherwise we'd fight the triggers).
      if (!d.appliesAll) {
        const picked = groupClassPick[gr.id] ?? {}
        const selectedClassIds = Object.entries(picked)
          .filter(([, v]) => v)
          .map(([k]) => k)

        // rewrite join table as exact set
        const del = await supabase.from('recommendation_group_classes').delete().eq('group_id', gr.id)
        if (del.error) throw del.error

        if (selectedClassIds.length > 0) {
          const ins = await supabase.from('recommendation_group_classes').insert(
            selectedClassIds.map((cid) => ({
              group_id: gr.id,
              class_id: cid,
            }))
          )
          if (ins.error) throw ins.error
        }
      }

      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save recommendation group.')
    } finally {
      setBusyKey(`group:${gr.id}`, false)
    }
  }

  async function deleteMutation(mutationId: string) {
    setError(null)
    setBusyKey(`delmut:${mutationId}`, true)
    try {
      const delLinks = await supabase.from('gene_mutation_groups').delete().eq('mutation_id', mutationId)
      if (delLinks.error) throw delLinks.error

      // optional table
      const delClassLinks = await supabase.from('gene_mutation_classes').delete().eq('mutation_id', mutationId)
      if (delClassLinks.error && (delClassLinks.error as any).code !== '42P01') throw delClassLinks.error

      const { error } = await supabase.from('gene_mutations').delete().eq('id', mutationId)
      if (error) throw error
      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete mutation.')
    } finally {
      setBusyKey(`delmut:${mutationId}`, false)
    }
  }

  async function saveMutation(mu: MutationRow, geneId: string) {
    setError(null)
    const d = mutationDraft[mu.id]
    if (!d) return

    const mutation = d.mutation.trim()
    if (!mutation) {
      setError('Mutation cannot be empty.')
      return
    }

    setBusyKey(`mut:${mu.id}`, true)
    try {
      const up = await supabase.from('gene_mutations').update({ mutation, pathogenicity: d.pathogenicity }).eq('id', mu.id)
      if (up.error) throw up.error

      const geneGroups = groupsByGene.get(geneId) ?? []
      const allowedGroupIds = new Set(geneGroups.map((g) => g.id))
      const geneClasses = classesByGene.get(geneId) ?? []
      const allowedClassIds = new Set(geneClasses.map((c) => c.id))

      // update direct links to groups (only groups of same gene)
      {
        const picked = mutationGroupPick[mu.id] ?? {}
        const selectedGroupIds = Object.entries(picked)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .filter((gid) => allowedGroupIds.has(gid))

        const del = await supabase.from('gene_mutation_groups').delete().eq('mutation_id', mu.id)
        if (del.error) throw del.error

        if (selectedGroupIds.length > 0) {
          const ins = await supabase.from('gene_mutation_groups').insert(selectedGroupIds.map((gid) => ({ mutation_id: mu.id, group_id: gid })))
          if (ins.error) throw ins.error
        }
      }

      // update class links (optional table)
      {
        const picked = mutationClassPick[mu.id] ?? {}
        const selectedClassIds = Object.entries(picked)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .filter((cid) => allowedClassIds.has(cid))

        const del = await supabase.from('gene_mutation_classes').delete().eq('mutation_id', mu.id)
        if (del.error) {
          if ((del.error as any).code !== '42P01') throw del.error
        } else {
          if (selectedClassIds.length > 0) {
            const ins = await supabase.from('gene_mutation_classes').insert(selectedClassIds.map((cid) => ({ mutation_id: mu.id, class_id: cid })))
            if (ins.error) throw ins.error
          }
        }
      }

      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save mutation.')
    } finally {
      setBusyKey(`mut:${mu.id}`, false)
    }
  }

  async function deleteRisk(riskId: string) {
    setError(null)
    setBusyKey(`delrisk:${riskId}`, true)
    try {
      const { error } = await supabase.from('gene_risks').delete().eq('id', riskId)
      if (error) throw error
      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete risk.')
    } finally {
      setBusyKey(`delrisk:${riskId}`, false)
    }
  }

  async function saveRisk(r: RiskRow) {
    setError(null)
    const d = riskDraft[r.id]
    if (!d) return
    const sex = parseSexFromUI(d.sex)
    const risk = d.risk.trim()
    if (!risk) {
      setError('Risk cannot be empty.')
      return
    }

    setBusyKey(`risk:${r.id}`, true)
    try {
      const { error } = await supabase.from('gene_risks').update({ sex, risk }).eq('id', r.id)
      if (error) throw error
      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save risk.')
    } finally {
      setBusyKey(`risk:${r.id}`, false)
    }
  }

  async function deleteClass(classId: string) {
    setError(null)
    setBusyKey(`delclass:${classId}`, true)
    try {
      const { error } = await supabase.from('recommendation_classes').delete().eq('id', classId)
      if (error) throw error
      await loadAll()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete class (it may still be used by recommendations).')
    } finally {
      setBusyKey(`delclass:${classId}`, false)
    }
  }

  function bulkSelectMutationGroups(muId: string, geneId: string, classId: string | undefined, mode: 'replace' | 'add') {
    if (!classId) return
    const geneGroups = groupsByGene.get(geneId) ?? []
    const ids = geneGroups.filter((g) => groupMatchesClass(g, classId, groupClassIds)).map((g) => g.id)

    setMutationGroupPick((p) => {
      const cur = p[muId] ?? {}
      let next: Record<string, boolean> = {}

      if (mode === 'add') next = { ...cur }
      for (const gid of ids) next[gid] = true

      // for replace mode, anything not in ids becomes false (we just omit it)
      return { ...p, [muId]: next }
    })
  }

  return (
    <main className="p-6 space-y-6 text-white">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Edit positions in the database</h1>
          <p className="mt-2 opacity-80">Genes are not deletable. Everything else can be edited/deleted here.</p>
        </div>

        <button className={btn('rounded-xl border px-5 py-3', busy.load)} onClick={loadAll} disabled={!!busy.load}>
          {busy.load ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="rounded-xl border p-3 text-sm">{error}</div>}

      <section className="space-y-3">
        {genes.length === 0 ? (
          <div className="opacity-70">No genes yet.</div>
        ) : (
          genes.map((g) => {
            const isOpen = openGeneId === g.id
            const sec = openSection[g.id] ?? { recs: false, muts: false, risks: false }

            const geneGroups = groupsByGene.get(g.id) ?? []
            const geneClasses = classesByGene.get(g.id) ?? []
            const geneMuts = mutationsByGene.get(g.id) ?? []
            const geneRisks = risksByGene.get(g.id) ?? []

            return (
              <div key={g.id} className="rounded-2xl border p-4">
                {/* Gene header */}
                <div className="flex items-start justify-between gap-4">
                  <button
                    className={btn('text-left', false)}
                    onClick={() => {
                      initGeneDraft(g)
                      toggleGene(g.id)
                    }}
                    type="button"
                  >
                    <div className="text-xl font-semibold">
                      {g.symbol} {g.name ? <span className="opacity-70">— {g.name}</span> : null}
                    </div>
                    <div className="text-sm opacity-70">{isOpen ? 'Click to collapse' : 'Click to expand'}</div>
                  </button>

                  <div className="flex gap-2">
                    <span className="text-xs opacity-60 self-center">Gene is protected</span>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-4 space-y-5">
                    {/* Gene edit */}
                    <div className="rounded-2xl border p-4 space-y-3">
                      <h3 className="text-lg font-semibold">Edit gene</h3>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-sm">Symbol</label>
                          <input
                            className="w-full rounded-xl border p-3 bg-black text-white"
                            value={(geneDraft[g.id]?.symbol ?? g.symbol) as string}
                            onChange={(e) =>
                              setGeneDraft((p) => ({
                                ...p,
                                [g.id]: { symbol: e.target.value, name: p[g.id]?.name ?? (g.name ?? '') },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm">Name (optional)</label>
                          <input
                            className="w-full rounded-xl border p-3 bg-black text-white"
                            value={(geneDraft[g.id]?.name ?? (g.name ?? '')) as string}
                            onChange={(e) =>
                              setGeneDraft((p) => ({
                                ...p,
                                [g.id]: { symbol: p[g.id]?.symbol ?? g.symbol, name: e.target.value },
                              }))
                            }
                          />
                        </div>
                      </div>
                      <button className={btn('rounded-xl border px-4 py-3', busy[`gene:${g.id}`])} onClick={() => saveGene(g.id)} disabled={!!busy[`gene:${g.id}`]}>
                        {busy[`gene:${g.id}`] ? 'Saving…' : 'Save gene'}
                      </button>
                    </div>

                    {/* Recommendations dropdown */}
                    <div className="rounded-2xl border p-4">
                      <button className={btn('w-full text-left flex items-center justify-between', false)} type="button" onClick={() => toggleSection(g.id, 'recs')}>
                        <span className="text-lg font-semibold">Recommendations</span>
                        <span className="opacity-70">{sec.recs ? '▲' : '▼'}</span>
                      </button>

                      {sec.recs && (
                        <div className="mt-4 space-y-4">
                          {/* Classes */}
                          <div className="rounded-2xl border p-4">
                            <h4 className="font-semibold">Recommendation classes (gene-specific)</h4>
                            {geneClasses.length === 0 ? (
                              <p className="opacity-70 mt-2 text-sm">No classes yet for this gene.</p>
                            ) : (
                              <div className="mt-3 space-y-2">
                                {geneClasses.map((c) => {
                                  const d = classDraft[c.id] ?? { name: c.name }
                                  return (
                                    <div key={c.id} className="rounded-xl border p-3 space-y-2">
                                      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] items-center">
                                        <input
                                          className="w-full rounded-xl border p-3 bg-black text-white"
                                          value={d.name}
                                          onChange={(e) => setClassDraft((p) => ({ ...p, [c.id]: { name: e.target.value } }))}
                                        />
                                        <button className={btn('rounded-xl border px-3 py-2 text-sm', busy[`class:${c.id}`])} onClick={() => saveClass(c.id)} disabled={!!busy[`class:${c.id}`]}>
                                          {busy[`class:${c.id}`] ? 'Saving…' : 'Save'}
                                        </button>
                                        <button className={btn('rounded-xl border px-3 py-2 text-sm', busy[`delclass:${c.id}`])} onClick={() => deleteClass(c.id)} disabled={!!busy[`delclass:${c.id}`]}>
                                          {busy[`delclass:${c.id}`] ? 'Deleting…' : 'Delete'}
                                        </button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          {/* Groups */}
                          <div className="rounded-2xl border p-4">
                            <h4 className="font-semibold">Recommendation groups</h4>

                            {geneGroups.length === 0 ? (
                              <p className="opacity-70 mt-2 text-sm">No recommendation groups yet for this gene.</p>
                            ) : (
                              <div className="mt-3 space-y-3">
                                {geneGroups.map((gr) => {
                                  const d = groupDraft[gr.id]
                                  const picked = groupClassPick[gr.id] ?? {}
                                  const appliesAll = !!d?.appliesAll

                                  return (
                                    <div key={gr.id} className="rounded-2xl border p-4 space-y-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="text-sm opacity-80">
                                          {/* removed the previous “bullshit” summary block; keep only a tiny hint */}
                                          <span className="opacity-70">
                                            {sexLabel(gr.sex)} · {prettyAge(gr.age_min, gr.age_max)}
                                          </span>
                                        </div>

                                        <button className={btn('rounded-xl border px-3 py-2 text-sm', busy[`delgroup:${gr.id}`])} onClick={() => deleteGroup(gr.id)} disabled={!!busy[`delgroup:${gr.id}`]}>
                                          {busy[`delgroup:${gr.id}`] ? 'Deleting…' : 'Delete group'}
                                        </button>
                                      </div>

                                      <div className="grid gap-3 md:grid-cols-4">
                                        <div className="space-y-1">
                                          <label className="text-sm">Sex</label>
                                          <select
                                            className="w-full rounded-xl border p-3 bg-black text-white"
                                            value={d?.sexUI ?? (gr.sex === 'M' ? 'M' : gr.sex === 'F' ? 'F' : 'ANY')}
                                            onChange={(e) =>
                                              setGroupDraft((p) => ({
                                                ...p,
                                                [gr.id]: { ...(p[gr.id] ?? { sexUI: 'ANY', ageMin: '', ageMax: '', recs: gr.recommendations ?? '', appliesAll: gr.applies_to_all_classes }), sexUI: e.target.value as any },
                                              }))
                                            }
                                          >
                                            <option value="ANY">ANY</option>
                                            <option value="M">M</option>
                                            <option value="F">F</option>
                                          </select>
                                        </div>

                                        <div className="space-y-1">
                                          <label className="text-sm">Age min</label>
                                          <input
                                            className="w-full rounded-xl border p-3 bg-black text-white"
                                            placeholder="blank = any"
                                            value={d?.ageMin ?? (gr.age_min == null ? '' : String(gr.age_min))}
                                            onChange={(e) =>
                                              setGroupDraft((p) => ({
                                                ...p,
                                                [gr.id]: { ...(p[gr.id] ?? { sexUI: 'ANY', ageMin: '', ageMax: '', recs: gr.recommendations ?? '', appliesAll: gr.applies_to_all_classes }), ageMin: e.target.value },
                                              }))
                                            }
                                          />
                                        </div>

                                        <div className="space-y-1">
                                          <label className="text-sm">Age max</label>
                                          <input
                                            className="w-full rounded-xl border p-3 bg-black text-white"
                                            placeholder="blank = any"
                                            value={d?.ageMax ?? (gr.age_max == null ? '' : String(gr.age_max))}
                                            onChange={(e) =>
                                              setGroupDraft((p) => ({
                                                ...p,
                                                [gr.id]: { ...(p[gr.id] ?? { sexUI: 'ANY', ageMin: '', ageMax: '', recs: gr.recommendations ?? '', appliesAll: gr.applies_to_all_classes }), ageMax: e.target.value },
                                              }))
                                            }
                                          />
                                        </div>

                                        <div className="space-y-1">
                                          <label className="text-sm">Applies to all classes</label>
                                          <button
                                            className={btn(`w-full rounded-xl border px-4 py-3 text-left ${appliesAll ? 'bg-white text-black' : 'bg-black text-white'}`, false)}
                                            type="button"
                                            onClick={() =>
                                              setGroupDraft((p) => ({
                                                ...p,
                                                [gr.id]: { ...(p[gr.id] ?? { sexUI: 'ANY', ageMin: '', ageMax: '', recs: gr.recommendations ?? '', appliesAll: gr.applies_to_all_classes }), appliesAll: !appliesAll },
                                              }))
                                            }
                                          >
                                            {appliesAll ? 'Yes (all, including future)' : 'No (choose classes below)'}
                                          </button>
                                        </div>
                                      </div>

                                      {!appliesAll && (
                                        <div className="rounded-xl border p-3">
                                          <div className="text-sm font-semibold mb-2">Assigned classes</div>
                                          {geneClasses.length === 0 ? (
                                            <div className="text-sm opacity-70">No classes exist for this gene yet.</div>
                                          ) : (
                                            <div className="grid gap-2 md:grid-cols-2">
                                              {geneClasses.map((c) => (
                                                <label key={c.id} className="flex items-center gap-2 rounded-lg border p-2">
                                                  <input
                                                    type="checkbox"
                                                    checked={!!picked[c.id]}
                                                    onChange={(e) =>
                                                      setGroupClassPick((p) => ({
                                                        ...p,
                                                        [gr.id]: { ...(p[gr.id] ?? {}), [c.id]: e.target.checked },
                                                      }))
                                                    }
                                                  />
                                                  <span>{c.name}</span>
                                                </label>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      <div className="space-y-1">
                                        <label className="text-sm">Recommendations</label>
                                        <textarea
                                          className="w-full rounded-xl border p-3 min-h-[120px] bg-black text-white"
                                          value={d?.recs ?? gr.recommendations ?? ''}
                                          onChange={(e) =>
                                            setGroupDraft((p) => ({
                                              ...p,
                                              [gr.id]: { ...(p[gr.id] ?? { sexUI: 'ANY', ageMin: '', ageMax: '', recs: gr.recommendations ?? '', appliesAll: gr.applies_to_all_classes }), recs: e.target.value },
                                            }))
                                          }
                                        />
                                      </div>

                                      <button className={btn('rounded-xl border px-4 py-3', busy[`group:${gr.id}`])} onClick={() => saveGroup(gr)} disabled={!!busy[`group:${gr.id}`]}>
                                        {busy[`group:${gr.id}`] ? 'Saving…' : 'Save group'}
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Mutations dropdown */}
                    <div className="rounded-2xl border p-4">
                      <button className={btn('w-full text-left flex items-center justify-between', false)} type="button" onClick={() => toggleSection(g.id, 'muts')}>
                        <span className="text-lg font-semibold">Mutations</span>
                        <span className="opacity-70">{sec.muts ? '▲' : '▼'}</span>
                      </button>

                      {sec.muts && (
                        <div className="mt-4 space-y-3">
                          {geneMuts.length === 0 ? (
                            <p className="opacity-70 text-sm">No mutations for this gene yet.</p>
                          ) : (
                            geneMuts.map((mu) => {
                              const d = mutationDraft[mu.id]
                              const picked = mutationGroupPick[mu.id] ?? {}
                              const classPicked = mutationClassPick[mu.id] ?? {}
                              const geneGroupsLocal = groupsByGene.get(g.id) ?? []
                              const geneClassesLocal = classesByGene.get(g.id) ?? []

                              return (
                                <div key={mu.id} className="rounded-2xl border p-4 space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="text-sm opacity-80">
                                      <div>
                                        <span className="font-semibold">Current:</span> {mu.mutation} · <span className="font-semibold">Pathogenicity:</span> {mu.pathogenicity}
                                      </div>
                                    </div>

                                    <button className={btn('rounded-xl border px-3 py-2 text-sm', busy[`delmut:${mu.id}`])} onClick={() => deleteMutation(mu.id)} disabled={!!busy[`delmut:${mu.id}`]}>
                                      {busy[`delmut:${mu.id}`] ? 'Deleting…' : 'Delete mutation'}
                                    </button>
                                  </div>

                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                      <label className="text-sm">Mutation</label>
                                      <input
                                        className="w-full rounded-xl border p-3 bg-black text-white"
                                        value={d?.mutation ?? mu.mutation ?? ''}
                                        onChange={(e) =>
                                          setMutationDraft((p) => ({
                                            ...p,
                                            [mu.id]: { mutation: e.target.value, pathogenicity: p[mu.id]?.pathogenicity ?? mu.pathogenicity },
                                          }))
                                        }
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-sm">Pathogenicity</label>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          className={btn(
                                            `rounded-xl border px-4 py-3 ${(d?.pathogenicity ?? mu.pathogenicity) === 'pathogenic' ? 'bg-white text-black' : ''}`,
                                            false
                                          )}
                                          onClick={() => setMutationDraft((p) => ({ ...p, [mu.id]: { ...(p[mu.id] ?? { mutation: mu.mutation, pathogenicity: mu.pathogenicity }), pathogenicity: 'pathogenic' } }))}
                                        >
                                          pathogenic
                                        </button>
                                        <button
                                          type="button"
                                          className={btn(
                                            `rounded-xl border px-4 py-3 ${(d?.pathogenicity ?? mu.pathogenicity) === 'likely_pathogenic' ? 'bg-white text-black' : ''}`,
                                            false
                                          )}
                                          onClick={() =>
                                            setMutationDraft((p) => ({ ...p, [mu.id]: { ...(p[mu.id] ?? { mutation: mu.mutation, pathogenicity: mu.pathogenicity }), pathogenicity: 'likely_pathogenic' } }))
                                          }
                                        >
                                          likely pathogenic
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Class links */}
                                  <div className="rounded-xl border p-3">
                                    <div className="text-sm font-semibold mb-2">Linked classes (auto-include new groups in that class)</div>
                                    {geneClassesLocal.length === 0 ? (
                                      <div className="text-sm opacity-70">No classes exist for this gene yet.</div>
                                    ) : (
                                      <div className="grid gap-2 md:grid-cols-2">
                                        {geneClassesLocal.map((c) => (
                                          <label key={c.id} className="flex items-center gap-2 rounded-lg border p-2">
                                            <input
                                              type="checkbox"
                                              checked={!!classPicked[c.id]}
                                              onChange={(e) =>
                                                setMutationClassPick((p) => ({
                                                  ...p,
                                                  [mu.id]: { ...(p[mu.id] ?? {}), [c.id]: e.target.checked },
                                                }))
                                              }
                                            />
                                            <span className="text-sm">{c.name}</span>
                                          </label>
                                        ))}
                                      </div>
                                    )}
                                    <div className="mt-2 text-xs opacity-70">
                                      Works only if you created the <span className="font-semibold">gene_mutation_classes</span> table in Supabase. Otherwise, only direct group links below are used.
                                    </div>
                                  </div>

                                  {/* Direct group links */}
                                  <div className="rounded-xl border p-3 space-y-3">
                                    <div className="flex items-end justify-between gap-3">
                                      <div className="text-sm font-semibold">Linked recommendation groups</div>

                                      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] items-center">
                                        <select
                                          className="w-full rounded-xl border p-2 bg-black text-white text-sm"
                                          value={mutBulkClassIdByMutation[mu.id] ?? ''}
                                          onChange={(e) => setMutBulkClassIdByMutation((p) => ({ ...p, [mu.id]: e.target.value }))}
                                        >
                                          <option value="">Bulk select by class…</option>
                                          {geneClassesLocal.map((c) => (
                                            <option key={c.id} value={c.id}>
                                              {c.name}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          className="rounded-xl border px-3 py-2 text-sm active:translate-y-[1px]"
                                          onClick={() => bulkSelectMutationGroups(mu.id, g.id, mutBulkClassIdByMutation[mu.id], 'replace')}
                                          disabled={!mutBulkClassIdByMutation[mu.id]}
                                        >
                                          Replace
                                        </button>
                                        <button
                                          type="button"
                                          className="rounded-xl border px-3 py-2 text-sm active:translate-y-[1px]"
                                          onClick={() => bulkSelectMutationGroups(mu.id, g.id, mutBulkClassIdByMutation[mu.id], 'add')}
                                          disabled={!mutBulkClassIdByMutation[mu.id]}
                                        >
                                          Add
                                        </button>
                                      </div>
                                    </div>

                                    {geneGroupsLocal.length === 0 ? (
                                      <div className="text-sm opacity-70">No recommendation groups exist for this gene.</div>
                                    ) : (
                                      <div className="space-y-2">
                                        {geneGroupsLocal.map((gr) => {
                                          const dgr = groupDraft[gr.id]
                                          const label = `${sexLabel(gr.sex)} · ${prettyAge(gr.age_min, gr.age_max)}`
                                          return (
                                            <label key={gr.id} className="flex items-start gap-2 rounded-lg border p-2">
                                              <input
                                                type="checkbox"
                                                checked={!!picked[gr.id]}
                                                onChange={(e) =>
                                                  setMutationGroupPick((p) => ({
                                                    ...p,
                                                    [mu.id]: { ...(p[mu.id] ?? {}), [gr.id]: e.target.checked },
                                                  }))
                                                }
                                              />
                                              <span className="text-sm">
                                                <span className="font-semibold">{label}</span>
                                                <span className="opacity-70">
                                                  {' '}
                                                  — {(dgr?.recs ?? gr.recommendations).slice(0, 90)}
                                                  {(dgr?.recs ?? gr.recommendations).length > 90 ? '…' : ''}
                                                </span>
                                              </span>
                                            </label>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  <button className={btn('rounded-xl border px-4 py-3', busy[`mut:${mu.id}`])} onClick={() => saveMutation(mu, g.id)} disabled={!!busy[`mut:${mu.id}`]}>
                                    {busy[`mut:${mu.id}`] ? 'Saving…' : 'Save mutation'}
                                  </button>
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* Risks dropdown */}
                    <div className="rounded-2xl border p-4">
                      <button className={btn('w-full text-left flex items-center justify-between', false)} type="button" onClick={() => toggleSection(g.id, 'risks')}>
                        <span className="text-lg font-semibold">Risks</span>
                        <span className="opacity-70">{sec.risks ? '▲' : '▼'}</span>
                      </button>

                      {sec.risks && (
                        <div className="mt-4 space-y-3">
                          {geneRisks.length === 0 ? (
                            <p className="opacity-70 text-sm">No risks for this gene yet.</p>
                          ) : (
                            geneRisks.map((r) => {
                              const d = riskDraft[r.id] ?? { sex: r.sex, risk: r.risk ?? '' }

                              return (
                                <div key={r.id} className="rounded-2xl border p-4 space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <button className={btn('rounded-xl border px-3 py-2 text-sm', busy[`delrisk:${r.id}`])} onClick={() => deleteRisk(r.id)} disabled={!!busy[`delrisk:${r.id}`]}>
                                      {busy[`delrisk:${r.id}`] ? 'Deleting…' : 'Delete risk'}
                                    </button>
                                  </div>

                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                      <label className="text-sm">Sex</label>
                                      <select
                                        className="w-full rounded-xl border p-3 bg-black text-white"
                                        value={d.sex}
                                        onChange={(e) =>
                                          setRiskDraft((prev) => ({
                                            ...prev,
                                            [r.id]: { ...d, sex: e.target.value as RiskSex },
                                          }))
                                        }
                                      >
                                        <option value="ANY">Any</option>
                                        <option value="F">F</option>
                                        <option value="M">M</option>
                                      </select>
                                    </div>

                                    <div className="space-y-1">
                                      <label className="text-sm">Risk</label>
                                      <textarea
                                        className="w-full rounded-xl border p-3 min-h-[110px] bg-black text-white"
                                        value={d.risk ?? ''}
                                        onChange={(e) =>
                                          setRiskDraft((p) => ({
                                            ...p,
                                            [r.id]: { ...(p[r.id] ?? d), risk: e.target.value },
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>

                                  <button className={btn('rounded-xl border px-4 py-3', busy[`risk:${r.id}`])} onClick={() => saveRisk(r)} disabled={!!busy[`risk:${r.id}`]}>
                                    {busy[`risk:${r.id}`] ? 'Saving…' : 'Save risk'}
                                  </button>
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>
    </main>
  )
}
