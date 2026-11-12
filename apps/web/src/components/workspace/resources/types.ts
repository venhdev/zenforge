import type {
  Resource,
  ResourceKind,
  ResourceScope,
  ResourceStatus,
  ResourceType,
} from '../../../types/contracts'

export interface ResourceForm {
  project_slug: string
  key: string
  slug: string
  kind: ResourceKind
  type: ResourceType
  types: string[]
  format: string
  scope: ResourceScope
  scope_ref: string
  title: string
  path: string
  isNative: boolean
  summary: string
  tags: string
  content: string
  status: ResourceStatus
}

export const emptyForm = (projectSlug: string): ResourceForm => ({
  project_slug: projectSlug,
  key: '',
  slug: '',
  kind: 'spec',
  type: 'SPEC',
  types: ['design'],
  format: 'markdown',
  scope: projectSlug ? 'PROJECT' : 'GLOBAL',
  scope_ref: '',
  title: '',
  path: '',
  isNative: true,
  summary: '',
  tags: '',
  content: '',
  status: 'ACTIVE',
})

export const RESOURCE_KINDS: ResourceKind[] = ['spec', 'soul', 'harness', 'artifact']

export const SEMANTIC_TYPES = [
  'rules',
  'research',
  'design',
  'fixture',
  'adr',
  'registry',
  'wireframe',
  'scout',
  'adaptor',
  'spec',
]

export const SCOPES: ResourceScope[] = ['GLOBAL', 'PROJECT', 'PLAN', 'TASK']

export const TYPE_COLORS: Record<string, string> = {
  rules: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  rule: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  research: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  scout: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  design: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  architecture: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  adr: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  spec: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  fixture: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  wireframe: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  registry: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  adaptor: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  guide: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  reference: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  memory: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
}

export const KIND_COLORS: Record<ResourceKind, string> = {
  spec: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  soul: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  harness: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  artifact: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
}

export const parseTags = (raw: string): string[] =>
  raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

export interface TagCount {
  tag: string
  count: number
}

const FALLBACK_PALETTES = [
  'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  'border-sky-500/30 bg-sky-500/10 text-sky-300',
  'border-violet-500/30 bg-violet-500/10 text-violet-300',
  'border-amber-500/30 bg-amber-500/10 text-amber-300',
  'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  'border-teal-500/30 bg-teal-500/10 text-teal-300',
  'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
  'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  'border-orange-500/30 bg-orange-500/10 text-orange-300',
]

/**
 * Deterministic color picker for any tag string, falling back to a curated pastel/neon palette.
 */
export const getTagColor = (tag: string): string => {
  const normalized = tag.toLowerCase().trim().replace(/^#/, '')
  if (TYPE_COLORS[normalized]) {
    return TYPE_COLORS[normalized]
  }
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i)
  }
  const idx = Math.abs(hash) % FALLBACK_PALETTES.length
  return FALLBACK_PALETTES[idx]
}

/**
 * Aggregates all tags/types across loaded resources and counts frequency.
 */
export const extractResourceTags = (resources: Resource[]): TagCount[] => {
  const counts = new Map<string, number>()
  for (const res of resources) {
    const resTags = new Set<string>()
    if (res.type) {
      resTags.add(res.type.toLowerCase().trim())
    }
    if (Array.isArray(res.types)) {
      for (const t of res.types) {
        if (t && t.trim()) {
          resTags.add(t.toLowerCase().trim().replace(/^#/, ''))
        }
      }
    }
    for (const tag of resTags) {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }

  const result: TagCount[] = []
  for (const [tag, count] of counts.entries()) {
    result.push({ tag, count })
  }
  // Sort by count descending, then alphabetically
  return result.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.tag.localeCompare(b.tag)
  })
}
