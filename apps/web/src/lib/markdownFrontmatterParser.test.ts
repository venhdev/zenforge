import { describe, it, expect } from 'vitest'
import { parseMarkdownContent } from './markdownFrontmatterParser'

describe('parseMarkdownContent', () => {
  it('extracts title, summary, and tags from YAML frontmatter', () => {
    const raw = `---
title: "Architecture Decisions"
description: "Core invariants for system design"
tags: [adr, architecture, core]
---

# Extra H1
Body paragraph text.
`
    const res = parseMarkdownContent(raw, 'docs/adr-01.md')
    expect(res.title).toBe('Architecture Decisions')
    expect(res.summary).toBe('Core invariants for system design')
    expect(res.tags).toEqual(['adr', 'architecture', 'core'])
    expect(res.suggestedKey).toBe('ADR_01')
    expect(res.content).toBe(raw)
  })

  it('falls back to H1 header and first paragraph when frontmatter is missing', () => {
    const raw = `# Construction Rules

Authoritative guidelines for building autonomous agents.

## Section 1
Details here.
`
    const res = parseMarkdownContent(raw, 'ZENFORGE_CONSTRUCTION_RULES.md')
    expect(res.title).toBe('Construction Rules')
    expect(res.summary).toBe('Authoritative guidelines for building autonomous agents.')
    expect(res.tags).toBeUndefined()
    expect(res.suggestedKey).toBe('ZENFORGE_CONSTRUCTION_RULES')
  })

  it('generates normalized uppercase key from various filename styles', () => {
    const res1 = parseMarkdownContent('content', 'path/to/my-custom-doc.markdown')
    expect(res1.suggestedKey).toBe('MY_CUSTOM_DOC')

    const res2 = parseMarkdownContent('content', 'spec.v2.draft.txt')
    expect(res2.suggestedKey).toBe('SPEC_V2_DRAFT')

    const res3 = parseMarkdownContent('content')
    expect(res3.suggestedKey).toBeUndefined()
  })
})
