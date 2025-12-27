'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

// Patient sex (generator input)
type PatientSex = 'M' | 'F'

// DB sex type used in tables
type DBSex = 'M' | 'F' | 'ANY' | null

type GeneRow = { id: string; symbol: string; name: string | null }

type Pathogenicity = 'pathogenic' | 'likely_pathogenic'

type MutationRow = {
  id: string
  gene_id: string
  mutation: string
  pathogenicity: Pathogenicity
}

type RiskRow = { id: string; gene_id: string; sex: DBSex; risk: string }

type RecGroupRow = {
  id: string
  gene_id: string
  sex: DBSex
  age_min: number | null
  age_max: number | null
  recommendations: string
  applies_to_all_classes: boolean
}

type CancerRecRow = {
  id: string
  gene_id: string
  sex: DBSex
  age_min: number | null
  age_max: number | null
  recommendations: string
}

type GroupClassLink = { group_id: string; class_id: string }

type MutationGroupLink = { mutation_id: string; group_id: string }

type MutationClassLink = { mutation_id: string; class_id: string }

type MutationGroupOverrideRow = { mutation_id: string; group_id: string; override: 'include' | 'exclude' }

type GeneratorMutation = {
  text: string
  mutationId: string | null
  error?: string | null
}

type GeneratorGeneEntry = {
  geneText: string
  geneId: string | null
  error?: string | null
  mutations: GeneratorMutation[]
}

type GeneratorCancerGeneEntry = {
  geneText: string
  geneId: string | null
  error?: string | null
}

type ReportGeneBox = {
  gene: GeneRow
  mutations: MutationRow[]
  risks: RiskRow[]
  doneRecs: RecGroupRow[]
  futureRecs: RecGroupRow[]
  cancerDoneRecs: CancerRecRow[]
  cancerFutureRecs: CancerRecRow[]
  cancerOnly: boolean
}

function btn(base: string, busy?: boolean) {
  return `${base} transition active:translate-y-[1px] active:opacity-80 ${busy ? 'opacity-60 cursor-not-allowed' : ''}`
}

function prettyAge(min: number | null, max: number | null) {
  const a = min == null ? 'any' : String(min)
  const b = max == null ? 'any' : String(max)
  if (min == null && max == null) return 'any age'
  if (min != null && max == null) return `≥ ${a}`
  if (min == null && max != null) return `≤ ${b}`
  return `${a}–${b}`
}

function normalize(s: string) {
  return s.trim().toLowerCase()
}

function startsWithCI(value: string, prefix: string) {
  return normalize(value).startsWith(normalize(prefix))
}

function sexMatches(dbSex: DBSex, patientSex: PatientSex) {
  // Support BOTH encodings:
  // - NULL = ANY (your intended schema)
  // - "ANY" = ANY (if any rows were saved that way)
  return dbSex === null || dbSex === 'ANY' || dbSex === patientSex
}

function pathogenicityLabel(p: Pathogenicity) {
  return p === 'pathogenic' ? 'pathogenic' : 'likely pathogenic'
}

function uniqById<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}

function Typeahead({
  label,
  placeholder,
  value,
  error,
  options,
  getOptionLabel,
  onChange,
  onPick,
  disabled,
}: {
  label: string
  placeholder?: string
  value: string
  error?: string | null
  options: any[]
  getOptionLabel: (o: any) => string
  onChange: (v: string) => void
  onPick: (o: any) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const q = value.trim()
    if (!q) return options
    return options.filter((o) => startsWithCI(getOptionLabel(o), q))
  }, [options, value, getOptionLabel])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current) return
      if (!boxRef.current.contains(e.target as any)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div className="space-y-1" ref={boxRef}>
      <label className="text-sm">{label}</label>
      {error ? <div className="text-sm text-red-400">{error}</div> : null}
      <input
        className="w-full rounded-xl border p-3 bg-black text-white"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
      />

      {open && filtered.length > 0 && (
        <div className="rounded-xl border bg-black max-h-56 overflow-auto">
          {filtered
            .slice(0, 50)
            .sort((a, b) => getOptionLabel(a).localeCompare(getOptionLabel(b)))
            .map((o) => (
              <button
                key={getOptionLabel(o)}
                type="button"
                className="w-full text-left px-3 py-2 hover:opacity-80"
                onClick={() => {
                  onPick(o)
                  setOpen(false)
                }}
              >
                {getOptionLabel(o)}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

export default function GeneratorClient() {
  const supabase = useMemo(() => createClient(), [])

  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const setBusyKey = (k: string, v: boolean) => setBusy((p) => ({ ...p, [k]: v }))

  const [error, setError] = useState<string | null>(null)

  const [patientAge, setPatientAge] = useState<string>('')
  const [patientSex, setPatientSex] = useState<PatientSex | null>(null)

  // NEW: cancer status inputs
  const [cancerPositive, setCancerPositive] = useState<boolean | null>(null)
  const [cancerLinkedToGene, setCancerLinkedToGene] = useState<boolean | null>(null)
  const [cancerGeneEntries, setCancerGeneEntries] = useState<GeneratorCancerGeneEntry[]>([{ geneText: '', geneId: null }])

  const [genes, setGenes] = useState<GeneRow[]>([])
  const [mutationsByGeneId, setMutationsByGeneId] = useState<Record<string, MutationRow[]>>({})

  const [entries, setEntries] = useState<GeneratorGeneEntry[]>([
    { geneText: '', geneId: null, mutations: [{ text: '', mutationId: null }] },
  ])

  const [report, setReport] = useState<ReportGeneBox[] | null>(null)

  async function loadGenes() {
    setError(null)
    setBusyKey('loadGenes', true)
    try {
      const res = await supabase.from('genes').select('id,symbol,name').order('symbol', { ascending: true })
      if (res.error) throw res.error
      setGenes(res.data ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load genes.')
    } finally {
      setBusyKey('loadGenes', false)
    }
  }

  async function ensureMutationsLoaded(geneId: string) {
    if (mutationsByGeneId[geneId]) return
    const res = await supabase
      .from('gene_mutations')
      .select('id,gene_id,mutation,pathogenicity')
      .eq('gene_id', geneId)
      .order('mutation', { ascending: true })
    if (res.error) throw res.error
    setMutationsByGeneId((p) => ({ ...p, [geneId]: res.data ?? [] }))
  }

  useEffect(() => {
    loadGenes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setGeneText(idx: number, v: string) {
    setEntries((prev) => {
      const next = [...prev]
      const row = { ...next[idx] }
      row.geneText = v
      row.error = null

      // typing invalidates selection until re-picked
      row.geneId = null
      row.mutations = [{ text: '', mutationId: null }]
      next[idx] = row

      // Auto-add next gene row when user starts typing in the last row
      const last = next[next.length - 1]
      if (last.geneText.trim() !== '' && next.length < 20) {
        next.push({ geneText: '', geneId: null, mutations: [{ text: '', mutationId: null }] })
      }
      return next
    })
  }

  function pickGene(idx: number, g: GeneRow) {
    setEntries((prev) => {
      const next = [...prev]
      const row = { ...next[idx] }
      row.geneText = g.symbol
      row.geneId = g.id
      row.error = null
      row.mutations = [{ text: '', mutationId: null }]
      next[idx] = row

      const last = next[next.length - 1]
      if (last.geneText.trim() !== '' && next.length < 20) {
        next.push({ geneText: '', geneId: null, mutations: [{ text: '', mutationId: null }] })
      }
      return next
    })

    ensureMutationsLoaded(g.id).catch((e: any) => setError(e?.message ?? 'Failed to load mutations.'))
  }

  function setMutationText(geneIdx: number, mutIdx: number, v: string) {
    setEntries((prev) => {
      const next = [...prev]
      const g = { ...next[geneIdx] }
      const muts = [...g.mutations]
      const m = { ...muts[mutIdx] }
      m.text = v
      m.error = null

      // typing invalidates selection until re-picked
      m.mutationId = null
      muts[mutIdx] = m

      // Auto-add next mutation row when user starts typing in the last mutation row
      const last = muts[muts.length - 1]
      if (last.text.trim() !== '' && muts.length < 20) {
        muts.push({ text: '', mutationId: null })
      }

      g.mutations = muts
      next[geneIdx] = g
      return next
    })
  }

  function pickMutation(geneIdx: number, mutIdx: number, mu: MutationRow) {
    setEntries((prev) => {
      const next = [...prev]
      const g = { ...next[geneIdx] }
      const muts = [...g.mutations]
      muts[mutIdx] = { text: mu.mutation, mutationId: mu.id, error: null }

      const last = muts[muts.length - 1]
      if (last.text.trim() !== '' && muts.length < 20) {
        muts.push({ text: '', mutationId: null })
      }

      g.mutations = muts
      next[geneIdx] = g
      return next
    })
  }

  // NEW: cancer gene typeahead handlers
  function setCancerGeneText(idx: number, v: string) {
    setCancerGeneEntries((prev) => {
      const next = [...prev]
      const row = { ...next[idx] }
      row.geneText = v
      row.error = null
      row.geneId = null
      next[idx] = row

      const last = next[next.length - 1]
      if (last.geneText.trim() !== '' && next.length < 20) {
        next.push({ geneText: '', geneId: null })
      }
      return next
    })
  }

  function pickCancerGene(idx: number, g: GeneRow) {
    setCancerGeneEntries((prev) => {
      const next = [...prev]
      const row = { ...next[idx] }
      row.geneText = g.symbol
      row.geneId = g.id
      row.error = null
      next[idx] = row

      const last = next[next.length - 1]
      if (last.geneText.trim() !== '' && next.length < 20) {
        next.push({ geneText: '', geneId: null })
      }
      return next
    })
  }

  function validateAndGetActiveEntries() {
    const ageNum = Number(patientAge)
    const ageOk = Number.isFinite(ageNum) && ageNum >= 0 && Number.isInteger(ageNum)

    let ok = true

    if (!ageOk) {
      ok = false
      setError('Patient age must be a non-negative whole number.')
    }
    if (!patientSex) {
      ok = false
      setError((prev) => prev ?? 'Pick patient sex.')
    }

    // NEW: cancer validation
    if (cancerPositive === null) {
      ok = false
      setError((prev) => prev ?? 'Pick whether the patient is cancer-positive.')
    }
    if (cancerPositive === true && cancerLinkedToGene === null) {
      ok = false
      setError((prev) => prev ?? 'Pick whether the cancer is linked to any gene.')
    }

    const nextEntries = entries.map((e) => ({ ...e, mutations: e.mutations.map((m) => ({ ...m })) }))

    // only keep rows the user touched
    const active = nextEntries.filter((e) => e.geneText.trim() !== '' || e.geneId)

    for (const e of active) {
      if (!e.geneId) {
        e.error = 'Invalid input'
        ok = false
      }

      const activeMuts = e.mutations.filter((m) => m.text.trim() !== '' || m.mutationId)
      if (activeMuts.length === 0) {
        ok = false
        e.error = e.error ?? 'Add at least 1 mutation'
      }

      for (const m of activeMuts) {
        if (!m.mutationId) {
          m.error = 'Invalid input'
          ok = false
        }
      }
    }

    // cancer gene entries
    const nextCancer = cancerGeneEntries.map((e) => ({ ...e }))
    const activeCancer = nextCancer.filter((e) => e.geneText.trim() !== '' || e.geneId)

    if (cancerPositive === true && cancerLinkedToGene === true) {
      if (activeCancer.length === 0) {
        ok = false
        setError((prev) => prev ?? 'Add at least 1 cancer-linked gene (or set “linked to gene” = No).')
      }
      for (const e of activeCancer) {
        if (!e.geneId) {
          e.error = 'Invalid input'
          ok = false
        }
      }
    }

    setEntries(nextEntries)
    setCancerGeneEntries(nextCancer)

    if (!ok) return null

    return {
      age: ageNum,
      sex: patientSex as PatientSex,
      cancerPositive: cancerPositive as boolean,
      cancerLinkedToGene: cancerLinkedToGene as boolean,
      activeEntries: active.map((e) => ({
        geneId: e.geneId as string,
        geneText: e.geneText,
        mutationIds: e.mutations.filter((m) => m.mutationId).map((m) => m.mutationId as string),
      })),
      cancerGeneIds:
        cancerPositive === true && cancerLinkedToGene === true
          ? Array.from(new Set(activeCancer.map((e) => e.geneId as string)))
          : ([] as string[]),
    }
  }

  async function generate() {
    setError(null)
    setReport(null)

    const validated = validateAndGetActiveEntries()
    if (!validated) return

    const { age, sex, cancerPositive, cancerLinkedToGene, activeEntries, cancerGeneIds } = validated

    const includeCancer = cancerPositive === true && cancerLinkedToGene === true && cancerGeneIds.length > 0
    const cancerGeneIdSet = new Set(cancerGeneIds)


    setBusyKey('generate', true)
    try {
      const mutationGeneIds = Array.from(new Set(activeEntries.map((e) => e.geneId)))
      const cancerIdsForFetch = includeCancer ? cancerGeneIds : []
      const allRelevantGeneIds = Array.from(new Set([...mutationGeneIds, ...cancerIdsForFetch]))
      const mutationIds = Array.from(new Set(activeEntries.flatMap((e) => e.mutationIds)))

      // Preload mutations lists (for genes picked in this session)
      await Promise.all(mutationGeneIds.map((gid) => ensureMutationsLoaded(gid)))

      const [
        genesRes,
        mutsRes,
        risksRes,
        groupsRes,
        mutGroupLinksRes,
        mutClassLinksRes,
        overridesRes,
        cancerRecsRes,
      ] = await Promise.all([
        supabase.from('genes').select('id,symbol,name').in('id', allRelevantGeneIds),
        mutationIds.length
          ? supabase.from('gene_mutations').select('id,gene_id,mutation,pathogenicity').in('id', mutationIds)
          : Promise.resolve({ data: [] as any[], error: null as any }),
        mutationGeneIds.length
          ? supabase.from('gene_risks').select('id,gene_id,sex,risk').in('gene_id', mutationGeneIds)
          : Promise.resolve({ data: [] as any[], error: null as any }),
        mutationGeneIds.length
          ? supabase
              .from('recommendation_groups')
              .select('id,gene_id,sex,age_min,age_max,recommendations,applies_to_all_classes')
              .in('gene_id', mutationGeneIds)
          : Promise.resolve({ data: [] as any[], error: null as any }),
        mutationIds.length
          ? supabase.from('gene_mutation_groups').select('mutation_id,group_id').in('mutation_id', mutationIds)
          : Promise.resolve({ data: [] as any[], error: null as any }),
        mutationIds.length
          ? supabase.from('gene_mutation_classes').select('mutation_id,class_id').in('mutation_id', mutationIds)
          : Promise.resolve({ data: [] as any[], error: null as any }),
        mutationIds.length
          ? supabase.from('gene_mutation_group_overrides').select('mutation_id,group_id,override').in('mutation_id', mutationIds)
          : Promise.resolve({ data: [] as any[], error: null as any }),
        cancerIdsForFetch.length
        ? supabase
            .from('gene_cancer_recommendations')
            .select('id,gene_id,sex,age_min,age_max,recommendations')
            .in('gene_id', cancerIdsForFetch)
        : Promise.resolve({ data: [] as any[], error: null as any }),
      ])

      if (genesRes.error) throw genesRes.error
      if (mutsRes.error) throw mutsRes.error
      if (risksRes.error) throw risksRes.error
      if (groupsRes.error) throw groupsRes.error
      if (mutGroupLinksRes.error) throw mutGroupLinksRes.error
      if (mutClassLinksRes.error) throw mutClassLinksRes.error
      if (overridesRes.error) throw overridesRes.error
      if (cancerRecsRes.error) throw cancerRecsRes.error

      const genesRows = (genesRes.data ?? []) as GeneRow[]
      const mutsRows = (mutsRes.data ?? []) as MutationRow[]
      const risksRows = (risksRes.data ?? []) as RiskRow[]
      const groupsRows = (groupsRes.data ?? []) as RecGroupRow[]
      const cancerRows = (cancerRecsRes.data ?? []) as CancerRecRow[]

      const groupIds = groupsRows.map((g) => g.id)
      const groupLinks = groupIds.length
        ? await supabase.from('recommendation_group_classes').select('group_id,class_id').in('group_id', groupIds)
        : { data: [] as any[], error: null as any }
      if ((groupLinks as any).error) throw (groupLinks as any).error

      const groupClassLinks = ((groupLinks as any).data ?? []) as GroupClassLink[]
      const mutGroupLinks = (mutGroupLinksRes.data ?? []) as MutationGroupLink[]
      const mutClassLinks = (mutClassLinksRes.data ?? []) as MutationClassLink[]
      const overrides = (overridesRes.data ?? []) as MutationGroupOverrideRow[]

      const geneById = new Map<string, GeneRow>()
      for (const g of genesRows) geneById.set(g.id, g)

      const mutsById = new Map<string, MutationRow>()
      for (const m of mutsRows) mutsById.set(m.id, m)

      const risksByGene = new Map<string, RiskRow[]>()
      for (const r of risksRows) {
        if (!risksByGene.has(r.gene_id)) risksByGene.set(r.gene_id, [])
        risksByGene.get(r.gene_id)!.push(r)
      }

      const groupsByGene = new Map<string, RecGroupRow[]>()
      for (const gr of groupsRows) {
        if (!groupsByGene.has(gr.gene_id)) groupsByGene.set(gr.gene_id, [])
        groupsByGene.get(gr.gene_id)!.push(gr)
      }

      const cancerByGene = new Map<string, CancerRecRow[]>()
      for (const r of cancerRows) {
        if (!cancerByGene.has(r.gene_id)) cancerByGene.set(r.gene_id, [])
        cancerByGene.get(r.gene_id)!.push(r)
      }

      const classIdsByGroup = new Map<string, Set<string>>()
      for (const l of groupClassLinks) {
        if (!classIdsByGroup.has(l.group_id)) classIdsByGroup.set(l.group_id, new Set())
        classIdsByGroup.get(l.group_id)!.add(l.class_id)
      }

      const manualGroupIdsByMutation = new Map<string, Set<string>>()
      for (const l of mutGroupLinks) {
        if (!manualGroupIdsByMutation.has(l.mutation_id)) manualGroupIdsByMutation.set(l.mutation_id, new Set())
        manualGroupIdsByMutation.get(l.mutation_id)!.add(l.group_id)
      }

      const classIdsByMutation = new Map<string, Set<string>>()
      for (const l of mutClassLinks) {
        if (!classIdsByMutation.has(l.mutation_id)) classIdsByMutation.set(l.mutation_id, new Set())
        classIdsByMutation.get(l.mutation_id)!.add(l.class_id)
      }

      const overrideByMutation = new Map<string, Map<string, 'include' | 'exclude'>>()
      for (const o of overrides) {
        if (!overrideByMutation.has(o.mutation_id)) overrideByMutation.set(o.mutation_id, new Map())
        overrideByMutation.get(o.mutation_id)!.set(o.group_id, o.override)
      }

      const boxes: ReportGeneBox[] = []

      // 1) Boxes based on mutations (normal flow)
      for (const entry of activeEntries) {
        const gene = geneById.get(entry.geneId)
        if (!gene) continue

        const muts = uniqById(entry.mutationIds.map((id) => mutsById.get(id)).filter(Boolean) as MutationRow[])

        const geneRisks = (risksByGene.get(entry.geneId) ?? []).filter((r) => sexMatches(r.sex, sex))
        const geneGroups = groupsByGene.get(entry.geneId) ?? []

        // union across mutations (doc doesn't need which mutation caused which rec)
        const includedGroupIds = new Set<string>()

        for (const mu of muts) {
          const manual = manualGroupIdsByMutation.get(mu.id) ?? new Set<string>()
          const muClassIds = classIdsByMutation.get(mu.id) ?? new Set<string>()
          const ov = overrideByMutation.get(mu.id) ?? new Map<string, 'include' | 'exclude'>()

          for (const gr of geneGroups) {
            const o = ov.get(gr.id)
            if (o === 'exclude') continue

            let auto = false
            if (gr.applies_to_all_classes) {
              auto = true
            } else {
              const groupClassIds = classIdsByGroup.get(gr.id) ?? new Set<string>()
              for (const cid of muClassIds) {
                if (groupClassIds.has(cid)) {
                  auto = true
                  break
                }
              }
            }

            const manualOk = manual.has(gr.id)
            const include = o === 'include' ? true : auto || manualOk
            if (include) includedGroupIds.add(gr.id)
          }
        }

        const includedGroups = geneGroups
          .filter((gr) => includedGroupIds.has(gr.id))
          .filter((gr) => sexMatches(gr.sex, sex))

        const doneRecs = includedGroups
          .filter((gr) => gr.age_min == null || gr.age_min <= age)
          .sort((a, b) => (a.age_min ?? -1) - (b.age_min ?? -1))

        const futureRecs = includedGroups
          .filter((gr) => gr.age_min != null && gr.age_min > age)
          .sort((a, b) => (a.age_min ?? 0) - (b.age_min ?? 0))

        // cancer recs (if any) for this gene
        const geneCancer =
            includeCancer && cancerGeneIdSet.has(entry.geneId)
                ? (cancerByGene.get(entry.geneId) ?? []).filter((r) => sexMatches(r.sex, sex))
                : []
        const cancerDoneRecs = geneCancer
          .filter((r) => r.age_min == null || r.age_min <= age)
          .sort((a, b) => (a.age_min ?? -1) - (b.age_min ?? -1))
        const cancerFutureRecs = geneCancer
          .filter((r) => r.age_min != null && r.age_min > age)
          .sort((a, b) => (a.age_min ?? 0) - (b.age_min ?? 0))

        boxes.push({
          gene,
          mutations: muts,
          risks: geneRisks,
          doneRecs,
          futureRecs,
          cancerDoneRecs,
          cancerFutureRecs,
          cancerOnly: false,
        })
      }

      // 2) Cancer-only boxes for cancer-linked genes without mutations entered
      const genesAlreadyInMutationBoxes = new Set<string>(boxes.map((b) => b.gene.id))
      for (const gid of (includeCancer ? cancerGeneIds : [])) {
        if (genesAlreadyInMutationBoxes.has(gid)) continue
        const gene = geneById.get(gid)
        if (!gene) continue

        const geneCancer = (cancerByGene.get(gid) ?? []).filter((r) => sexMatches(r.sex, sex))
        const cancerDoneRecs = geneCancer
          .filter((r) => r.age_min == null || r.age_min <= age)
          .sort((a, b) => (a.age_min ?? -1) - (b.age_min ?? -1))
        const cancerFutureRecs = geneCancer
          .filter((r) => r.age_min != null && r.age_min > age)
          .sort((a, b) => (a.age_min ?? 0) - (b.age_min ?? 0))

        boxes.push({
          gene,
          mutations: [],
          risks: [],
          doneRecs: [],
          futureRecs: [],
          cancerDoneRecs,
          cancerFutureRecs,
          cancerOnly: true,
        })
      }

      // stable sort by gene symbol
      boxes.sort((a, b) => a.gene.symbol.localeCompare(b.gene.symbol))

      setReport(boxes)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate recommendations.')
    } finally {
      setBusyKey('generate', false)
    }
  }

  function reset() {
    setError(null)
    setReport(null)
    setPatientAge('')
    setPatientSex(null)
    setCancerPositive(null)
    setCancerLinkedToGene(null)
    setCancerGeneEntries([{ geneText: '', geneId: null }])
    setEntries([{ geneText: '', geneId: null, mutations: [{ text: '', mutationId: null }] }])
  }

  const showCancerLinkedQuestion = cancerPositive === true
  const showCancerGenes = cancerPositive === true && cancerLinkedToGene === true

  return (
    <main className="p-6 space-y-6 text-white">
      <header className="no-print flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Recommendation generator</h1>
          <p className="mt-2 opacity-80">
            Enter (imaginary) patient data, select gene(s) + mutation(s), optionally cancer-positive status, then generate a printable report.
          </p>
        </div>

        <div className="flex gap-2">
          <button className={btn('rounded-xl border px-4 py-3', busy.generate)} onClick={generate} disabled={!!busy.generate}>
            {busy.generate ? 'Generating…' : 'Generate report'}
          </button>
          <button className={btn('rounded-xl border px-4 py-3', false)} type="button" onClick={reset}>
            Reset
          </button>
          {report && (
            <button className={btn('rounded-xl border px-4 py-3', false)} type="button" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
          )}
        </div>
      </header>

      {error && <div className="no-print rounded-xl border p-3 text-sm">{error}</div>}

      <section className="no-print rounded-2xl border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Patient data</h2>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-sm">Age</label>
            <input
              className="w-full rounded-xl border p-3 bg-black text-white"
              value={patientAge}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Numbers only"
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/[^0-9]/g, '')
                setPatientAge(digitsOnly)
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">Sex</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={btn(`rounded-xl border px-4 py-3 ${patientSex === 'F' ? 'bg-white text-black' : ''}`, false)}
                onClick={() => setPatientSex('F')}
              >
                Female
              </button>
              <button
                type="button"
                className={btn(`rounded-xl border px-4 py-3 ${patientSex === 'M' ? 'bg-white text-black' : ''}`, false)}
                onClick={() => setPatientSex('M')}
              >
                Male
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm">Genes loaded</label>
            <div className="rounded-xl border p-3 text-sm opacity-80">
              {busy.loadGenes ? 'Loading…' : `${genes.length} gene(s) in database`}
            </div>
          </div>
        </div>

        {/* NEW: Cancer positive controls */}
        <div className="rounded-2xl border p-4 space-y-4">
          <div className="text-lg font-semibold">Cancer status</div>

          <div className="space-y-1">
            <label className="text-sm">Is the patient cancer-positive?</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={btn(`rounded-xl border px-4 py-3 ${cancerPositive === true ? 'bg-white text-black' : ''}`, false)}
                onClick={() => {
                  setCancerPositive(true)
                  setCancerLinkedToGene(null)
                  setCancerGeneEntries([{ geneText: '', geneId: null }])
                }}
              >
                Yes
              </button>
              <button
                type="button"
                className={btn(`rounded-xl border px-4 py-3 ${cancerPositive === false ? 'bg-white text-black' : ''}`, false)}
                onClick={() => {
                  setCancerPositive(false)
                  setCancerLinkedToGene(false)
                  setCancerGeneEntries([{ geneText: '', geneId: null }])
                }}
              >
                No
              </button>
            </div>
          </div>

          {showCancerLinkedQuestion && (
            <div className="space-y-1">
              <label className="text-sm">Is the cancer linked to any gene?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btn(`rounded-xl border px-4 py-3 ${cancerLinkedToGene === true ? 'bg-white text-black' : ''}`, false)}
                  onClick={() => {
                    setCancerLinkedToGene(true)
                    setCancerGeneEntries([{ geneText: '', geneId: null }])
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={btn(`rounded-xl border px-4 py-3 ${cancerLinkedToGene === false ? 'bg-white text-black' : ''}`, false)}
                  onClick={() => {
                    setCancerLinkedToGene(false)
                    setCancerGeneEntries([{ geneText: '', geneId: null }])
                  }}
                >
                  No
                </button>
              </div>
            </div>
          )}

          {showCancerGenes && (
            <div className="space-y-3">
              <div className="text-sm opacity-80">Select the gene(s) linked to cancer</div>
              {cancerGeneEntries.map((e, idx) => (
                <div key={idx} className="rounded-2xl border p-4">
                  <Typeahead
                    label={idx === 0 ? 'Cancer-linked gene' : `Cancer-linked gene ${idx + 1} (optional)`}
                    placeholder="start typing"
                    value={e.geneText}
                    error={e.error}
                    options={genes}
                    getOptionLabel={(g: GeneRow) => g.symbol}
                    onChange={(v) => setCancerGeneText(idx, v)}
                    onPick={(g: GeneRow) => pickCancerGene(idx, g)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="no-print rounded-2xl border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Gene(s) + mutation(s)</h2>

        <div className="space-y-6">
          {entries.map((e, geneIdx) => {
            const gene = e.geneId ? genes.find((g) => g.id === e.geneId) ?? null : null
            const mutationOptions = e.geneId ? mutationsByGeneId[e.geneId] ?? [] : []

            return (
              <div key={geneIdx} className="rounded-2xl border p-4 space-y-4">
                <Typeahead
                  label="Gene"
                  placeholder="start typing"
                  value={e.geneText}
                  error={e.error}
                  options={genes}
                  getOptionLabel={(g: GeneRow) => g.symbol}
                  onChange={(v) => setGeneText(geneIdx, v)}
                  onPick={(g: GeneRow) => pickGene(geneIdx, g)}
                />

                <div className="space-y-3">
                  <div className="text-sm opacity-80">
                    Mutations {gene ? <span className="opacity-60">(for {gene.symbol})</span> : null}
                  </div>

                  {e.mutations.map((m, mutIdx) => (
                    <Typeahead
                      key={mutIdx}
                      label={mutIdx === 0 ? 'Mutation' : `Mutation ${mutIdx + 1} (optional)`}
                      placeholder={gene ? 'start typing' : 'pick a gene first'}
                      value={m.text}
                      error={m.error}
                      options={mutationOptions}
                      getOptionLabel={(mu: MutationRow) => mu.mutation}
                      onChange={(v) => setMutationText(geneIdx, mutIdx, v)}
                      onPick={(mu: MutationRow) => pickMutation(geneIdx, mutIdx, mu)}
                      disabled={!e.geneId}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {report && (
        <section className="print-area space-y-4">
          <div className="rounded-2xl border p-4">
            <h2 className="text-xl font-semibold">Report</h2>
            <div className="mt-2 text-sm opacity-80">
              Patient: age {patientAge || '—'} · sex {patientSex || '—'} · cancer-positive{' '}
              {cancerPositive === null ? '—' : cancerPositive ? 'Yes' : 'No'}
              {cancerPositive ? ` · cancer linked to gene ${cancerLinkedToGene ? 'Yes' : 'No'}` : ''}
            </div>
          </div>

          <div className="space-y-4">
            {report.length === 0 ? (
              <div className="rounded-2xl border p-4 opacity-80">No recommendations found for the provided input.</div>
            ) : (
              report.map((box) => (
                <div key={`${box.gene.id}:${box.cancerOnly ? 'cancer' : 'normal'}`} className="rounded-2xl border p-4 space-y-4">
                  <div>
                    <div className="text-2xl font-semibold">
                      {box.gene.symbol} {box.gene.name ? <span className="opacity-70">— {box.gene.name}</span> : null}
                      {box.cancerOnly ? <span className="ml-2 text-sm opacity-70">(cancer-positive recommendations only)</span> : null}
                    </div>
                  </div>

                  {/* Cancer-positive recommendations (top of box if present) */}
                  {(box.cancerDoneRecs.length > 0 || box.cancerFutureRecs.length > 0) && (
                    <div className="rounded-xl border p-3 space-y-4">
                      <div className="text-lg font-semibold">Cancer-positive recommendations</div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border p-3">
                          <div className="font-semibold">Already applicable</div>
                          {box.cancerDoneRecs.length === 0 ? (
                            <div className="mt-2 text-sm opacity-70">—</div>
                          ) : (
                            <ul className="mt-3 space-y-3 text-sm">
                              {box.cancerDoneRecs.map((r) => (
                                <li key={r.id} className="rounded-xl border p-3">
                                  <div className="text-xs opacity-70">Age: {prettyAge(r.age_min, r.age_max)}</div>
                                  <div className="whitespace-pre-line mt-2">{r.recommendations}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="rounded-xl border p-3">
                          <div className="font-semibold">For the future</div>
                          {box.cancerFutureRecs.length === 0 ? (
                            <div className="mt-2 text-sm opacity-70">—</div>
                          ) : (
                            <ul className="mt-3 space-y-3 text-sm">
                              {box.cancerFutureRecs.map((r) => (
                                <li key={r.id} className="rounded-xl border p-3">
                                  <div className="text-xs opacity-70">Start at age: {prettyAge(r.age_min, r.age_max)}</div>
                                  <div className="whitespace-pre-line mt-2">{r.recommendations}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* If cancer-only box, stop here */}
                  {box.cancerOnly ? null : (
                    <>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-xl border p-3">
                          <div className="font-semibold">Mutations</div>
                          <ul className="mt-2 space-y-1 text-sm">
                            {box.mutations.map((m) => (
                              <li key={m.id}>
                                <span className="font-semibold">{m.mutation}</span> · {pathogenicityLabel(m.pathogenicity)}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="rounded-xl border p-3">
                          <div className="font-semibold">Risks</div>
                          {box.risks.length === 0 ? (
                            <div className="mt-2 text-sm opacity-70">—</div>
                          ) : (
                            <ul className="mt-2 space-y-1 text-sm">
                              {box.risks.map((r) => (
                                <li key={r.id}>{r.risk}</li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="rounded-xl border p-3">
                          <div className="font-semibold">Summary</div>
                          <div className="mt-2 text-sm opacity-80">
                            Done: {box.doneRecs.length} · Future: {box.futureRecs.length}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border p-3">
                          <div className="font-semibold">Recommendations already applicable</div>
                          {box.doneRecs.length === 0 ? (
                            <div className="mt-2 text-sm opacity-70">—</div>
                          ) : (
                            <ul className="mt-3 space-y-3 text-sm">
                              {box.doneRecs.map((gr) => (
                                <li key={gr.id} className="rounded-xl border p-3">
                                  <div className="text-xs opacity-70">Age: {prettyAge(gr.age_min, gr.age_max)}</div>
                                  <div className="whitespace-pre-line mt-2">{gr.recommendations}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="rounded-xl border p-3">
                          <div className="font-semibold">Recommendations for the future</div>
                          {box.futureRecs.length === 0 ? (
                            <div className="mt-2 text-sm opacity-70">—</div>
                          ) : (
                            <ul className="mt-3 space-y-3 text-sm">
                              {box.futureRecs.map((gr) => (
                                <li key={gr.id} className="rounded-xl border p-3">
                                  <div className="text-xs opacity-70">Start at age: {prettyAge(gr.age_min, gr.age_max)}</div>
                                  <div className="whitespace-pre-line mt-2">{gr.recommendations}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Print rules: show only report; force black/white high-contrast */}
      <style jsx global>{`
        @media print {
          nav,
          .no-print {
            display: none !important;
          }

          .print-area {
            display: block !important;
          }

          html,
          body,
          .print-area,
          .print-area * {
            color: #000 !important;
            -webkit-text-fill-color: #000 !important;
            opacity: 1 !important;
            text-shadow: none !important;
          }

          .text-muted-foreground,
          .text-gray-500,
          .text-gray-600,
          .text-gray-700,
          .text-slate-500,
          .text-slate-600,
          .text-zinc-500,
          .text-neutral-500 {
            color: #000 !important;
            -webkit-text-fill-color: #000 !important;
          }

          body,
          .print-area,
          .print-area * {
            background: #fff !important;
            box-shadow: none !important;
            filter: none !important;
          }

          .print-area .border,
          .print-area [class*='border'] {
            border-color: #000 !important;
          }

          hr {
            border-color: #000 !important;
          }

          main {
            padding: 0 !important;
          }
        }
      `}</style>
    </main>
  )
}
