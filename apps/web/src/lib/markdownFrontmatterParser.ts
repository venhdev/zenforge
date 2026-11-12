export interface ParsedMarkdown {
  title?: string
  summary?: string
  content: string
  suggestedKey?: string
  tags?: string[]
}

/**
 * Parses markdown source to extract YAML frontmatter (title, summary, tags),
 * falling back to H1 headers and opening paragraphs when frontmatter is absent.
 */
export const parseMarkdownContent = (
  rawContent: string,
  filename?: string
): ParsedMarkdown => {
  const lines = rawContent.split(/\r?\n/)
  let title: string | undefined
  let summary: string | undefined
  let tags: string[] = []
  let i = 0

  if (lines[0]?.trim() === '---') {
    i = 1
    const fm: string[] = []
    while (i < lines.length && lines[i].trim() !== '---') {
      fm.push(lines[i])
      i++
    }
    if (i < lines.length && lines[i].trim() === '---') {
      i++
    }
    for (const f of fm) {
      const tm = f.match(/^title:\s*["']?(.*?)["']?$/i)
      if (tm && tm[1]) title = tm[1].trim()
      const sm = f.match(/^(?:description|summary):\s*["']?(.*?)["']?$/i)
      if (sm && sm[1]) summary = sm[1].trim()
      const tgm = f.match(/^tags:\s*\[?(.*?)\]?$/i)
      if (tgm && tgm[1]) {
        tags = tgm[1]
          .split(',')
          .map((t) => t.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      }
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    if (!title) {
      const h1Match = line.match(/^#\s+(.+)$/)
      if (h1Match) {
        title = h1Match[1].trim()
        continue
      }
    }
    if (
      title &&
      !summary &&
      line.trim() &&
      !line.startsWith('#') &&
      !line.startsWith('```') &&
      !line.startsWith('---') &&
      !line.startsWith('>')
    ) {
      summary = line.trim()
    }
  }

  let suggestedKey: string | undefined
  if (filename) {
    const base = (filename.split(/[/\\]/).pop() || filename).replace(
      /\.(md|markdown|txt)$/i,
      ''
    )
    suggestedKey = base
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
  }

  return {
    title,
    summary,
    content: rawContent,
    suggestedKey,
    tags: tags.length > 0 ? tags : undefined,
  }
}
