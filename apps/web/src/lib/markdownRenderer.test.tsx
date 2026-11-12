import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  MarkdownViewer,
  renderInlineMarkdown,
  parseTaskContextBlock,
  isStandaloneXmlTag,
  unwrapDirectiveTags,
} from './markdownRenderer'

describe('markdownRenderer', () => {
  it('renders inline markdown elements correctly', () => {
    const nodes = renderInlineMarkdown('This is **bold**, *italic*, `code`, and [link](https://example.com).')
    const { container } = render(<div>{nodes}</div>)

    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.querySelector('code')?.textContent).toBe('code')
    const anchor = container.querySelector('a')
    expect(anchor?.textContent).toBe('link')
    expect(anchor?.getAttribute('href')).toBe('https://example.com')
  })

  it('renders GFM tables with escaped pipes and br line breaks properly', () => {
    const mdTable = `
| Flag | Format | Description |
| :--- | :---: | ---: |
| \`--output\` | \`text\` \\| \`json\` | Output format<br>• text: plain<br>• json: structured |
| \`--mode\` | auto | Auto execution mode |
`
    const { container } = render(<MarkdownViewer content={mdTable} />)

    const table = container.querySelector('table')
    expect(table).toBeTruthy()

    const headers = container.querySelectorAll('th')
    expect(headers.length).toBe(3)
    expect(headers[0].textContent).toBe('Flag')
    expect(headers[1].textContent).toBe('Format')
    expect(headers[2].textContent).toBe('Description')

    // Alignment classes
    expect(headers[0].className).toContain('text-left')
    expect(headers[1].className).toContain('text-center')
    expect(headers[2].className).toContain('text-right')

    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(2)

    // Cell 2 has escaped pipe rendered as pipe, not splitting into extra columns
    const cells = rows[0].querySelectorAll('td')
    expect(cells.length).toBe(3)
    expect(cells[1].textContent).toContain('text | json')
    expect(cells[2].querySelectorAll('br').length).toBe(2)
  })

  it('renders callout alerts and headings correctly', () => {
    const md = `
# Main Title
## Sub Title

> [!NOTE]
> This is a key technical note.

\`\`\`bash
npm run test
\`\`\`
`
    const { container } = render(<MarkdownViewer content={md} />)

    expect(container.querySelector('h1')?.textContent).toContain('Main Title')
    expect(container.querySelector('h2')?.textContent).toContain('Sub Title')
    expect(screen.getByText('NOTE')).toBeTruthy()
    expect(screen.getByText('This is a key technical note.')).toBeTruthy()
    expect(container.querySelector('pre')?.textContent).toContain('npm run test')
  })

  it('handles empty content gracefully', () => {
    render(<MarkdownViewer content="" />)
    expect(screen.getByText('(empty document)')).toBeTruthy()
  })

  it('parses <task_context> block and renders glassmorphism task specification card', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    })

    const md = `
<task_context>
  <task_id>docking-p05-smart-directive-xml-rendering</task_id>
  <title>Smart Directive XML Rendering in MarkdownViewer</title>
  <project_slug>zenforge</project_slug>
  <plan_slug>cockpit-bottom-drawer-docking</plan_slug>
  <priority>P2</priority>
  <complexity>LOW</complexity>
  <risk_level>LOW</risk_level>
</task_context>
`
    const { container } = render(<MarkdownViewer content={md} />)

    // Header & title
    expect(screen.getByText('TASK SPECIFICATION')).toBeTruthy()
    expect(screen.getByText('Smart Directive XML Rendering in MarkdownViewer')).toBeTruthy()

    // Task ID in mono font
    const taskIdEl = screen.getByText('docking-p05-smart-directive-xml-rendering')
    expect(taskIdEl).toBeTruthy()
    expect(taskIdEl.className).toContain('text-violet-300')

    // Glassmorphism card container styling
    const card = container.querySelector('.bg-violet-950\\/20')
    expect(card).toBeTruthy()
    expect(card?.className).toContain('rounded-xl')
    expect(card?.className).toContain('border-violet-500/30')

    // Priority pill (P2 -> cyan)
    const priorityPill = screen.getByText('P2')
    expect(priorityPill).toBeTruthy()
    expect(priorityPill.className).toContain('border-cyan-500/40')

    // Badges
    expect(screen.getByText('zenforge')).toBeTruthy()
    expect(screen.getByText('cockpit-bottom-drawer-docking')).toBeTruthy()
    expect(screen.getByText('complexity:')).toBeTruthy()
    expect(screen.getByText('risk:')).toBeTruthy()
    expect(screen.getAllByText('LOW').length).toBe(2)

    // Copy Task ID button
    const copyBtn = screen.getByTitle('Copy Task ID')
    expect(copyBtn).toBeTruthy()
    fireEvent.click(copyBtn)

    expect(writeTextSpy).toHaveBeenCalledWith('docking-p05-smart-directive-xml-rendering')
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeTruthy()
    })
  })

  it('renders different priority pills correctly in task specification card', () => {
    const p0Card = render(
      <MarkdownViewer
        content={`
<task_context>
  <task_id>task-p0</task_id>
  <priority>P0</priority>
</task_context>
`}
      />
    )
    expect(p0Card.getByText('P0').className).toContain('border-rose-500/40')

    const p1Card = render(
      <MarkdownViewer
        content={`
<task_context>
  <task_id>task-p1</task_id>
  <priority>P1</priority>
</task_context>
`}
      />
    )
    expect(p1Card.getByText('P1').className).toContain('border-amber-500/40')

    const p3Card = render(
      <MarkdownViewer
        content={`
<task_context>
  <task_id>task-p3</task_id>
  <priority>P3</priority>
</task_context>
`}
      />
    )
    expect(p3Card.getByText('P3').className).toContain('border-zinc-700')
  })

  it('renders <mcp_handshake_protocol> as agent handshake protocol box with highlighted action codes', () => {
    const md = `
<mcp_handshake_protocol>
- **Claim**: Call \`claim_task(task_id="docking-p05")\` before editing files.
- **Checkpoint**: Call \`transition_task(task_ids=["docking-p05"], action="CHECKPOINT")\` upon milestone.
- **Architectural Drift / Blocked**: Call review(action="request", task_id="docking-p05") and exit.
</mcp_handshake_protocol>
`
    const { container } = render(<MarkdownViewer content={md} />)

    // Header
    expect(screen.getByText('AGENT HANDSHAKE PROTOCOL')).toBeTruthy()

    // Box container styling
    const box = container.querySelector('.bg-cyan-950\\/15')
    expect(box).toBeTruthy()
    expect(box?.className).toContain('rounded-xl')
    expect(box?.className).toContain('border-cyan-500/30')

    // Bold labels
    expect(screen.getByText('Claim')).toBeTruthy()
    expect(screen.getByText('Checkpoint')).toBeTruthy()

    // Code highlights for claim_task, transition_task, and review
    const codeElements = container.querySelectorAll('code')
    const codeTexts = Array.from(codeElements).map((el) => el.textContent)
    expect(codeTexts.some((t) => t?.includes('claim_task'))).toBe(true)
    expect(codeTexts.some((t) => t?.includes('transition_task'))).toBe(true)
    expect(codeTexts.some((t) => t?.includes('review'))).toBe(true)

    // Highlighted code elements have cyan style
    const claimCode = Array.from(codeElements).find((el) => el.textContent?.includes('claim_task'))
    expect(claimCode?.className).toContain('border-cyan-500/40')
    expect(claimCode?.className).toContain('text-cyan-200')
  })

  it('unwraps <context> cleanly so raw XML tags do not leak into paragraphs', () => {
    const md = `
## 1. Description & Context
<context>
Enhance MarkdownViewer in markdownRenderer.tsx to parse and render agent directive XML blocks as sleek UI cards instead of raw text.
</context>
`
    const { container } = render(<MarkdownViewer content={md} />)

    // Raw tags should NOT be present in DOM
    const html = container.innerHTML
    expect(html).not.toContain('&lt;context&gt;')
    expect(html).not.toContain('&lt;/context&gt;')
    expect(html).not.toContain('<context>')
    expect(html).not.toContain('</context>')

    // Text content is preserved
    expect(
      screen.getByText(
        'Enhance MarkdownViewer in markdownRenderer.tsx to parse and render agent directive XML blocks as sleek UI cards instead of raw text.'
      )
    ).toBeTruthy()
  })

  it('unwraps single-line and other standalone XML tags cleanly', () => {
    const md = `
<context>Single line wrapped context.</context>

<scope>
  <allowed_files>
  - \`apps/web/src/lib/markdownRenderer.tsx\`
  - \`apps/web/src/lib/markdownRenderer.test.tsx\`
  </allowed_files>
</scope>
`
    const { container } = render(<MarkdownViewer content={md} />)

    expect(screen.getByText('Single line wrapped context.')).toBeTruthy()

    // No leaked XML tags
    const html = container.innerHTML
    expect(html).not.toContain('<scope>')
    expect(html).not.toContain('</scope>')
    expect(html).not.toContain('<allowed_files>')
    expect(html).not.toContain('</allowed_files>')

    // List items are properly rendered
    const listItems = container.querySelectorAll('li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].textContent).toContain('apps/web/src/lib/markdownRenderer.tsx')
    expect(listItems[1].textContent).toContain('apps/web/src/lib/markdownRenderer.test.tsx')
  })

  it('correctly handles helper functions parseTaskContextBlock, isStandaloneXmlTag, unwrapDirectiveTags', () => {
    const xml = `
<task_context>
  <task_id>my-task-123</task_id>
  <title>Sample Title</title>
  <project_slug>p-slug</project_slug>
  <plan_slug>plan-slug</plan_slug>
  <priority>P1</priority>
  <complexity>HIGH</complexity>
  <risk_level>MEDIUM</risk_level>
</task_context>`

    const parsed = parseTaskContextBlock(xml)
    expect(parsed.taskId).toBe('my-task-123')
    expect(parsed.title).toBe('Sample Title')
    expect(parsed.projectSlug).toBe('p-slug')
    expect(parsed.planSlug).toBe('plan-slug')
    expect(parsed.priority).toBe('P1')
    expect(parsed.complexity).toBe('HIGH')
    expect(parsed.riskLevel).toBe('MEDIUM')

    expect(isStandaloneXmlTag('<context>')).toBe(true)
    expect(isStandaloneXmlTag('</context>')).toBe(true)
    expect(isStandaloneXmlTag('  <allowed_files>  ')).toBe(true)
    expect(isStandaloneXmlTag('<br>')).toBe(false)
    expect(isStandaloneXmlTag('<br/>')).toBe(false)
    expect(isStandaloneXmlTag('Normal text')).toBe(false)

    expect(unwrapDirectiveTags('<context>hello</context>')).toBe('hello')
    expect(unwrapDirectiveTags('<scope><allowed_files>hello</allowed_files></scope>')).toBe('hello')
    expect(unwrapDirectiveTags('hello')).toBe('hello')
  })
})
