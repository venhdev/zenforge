package worker

import (
	"strings"

	"zenf/internal/adaptor"
)

// StreamFormatter transforms raw stdout lines (both multi-tool NDJSON and raw shell output)
// into clean, human-readable colorized terminal output for xterm consumption.
type StreamFormatter struct {
	registry *adaptor.Registry
}

// NewStreamFormatter creates a new StreamFormatter.
func NewStreamFormatter() *StreamFormatter {
	return &StreamFormatter{
		registry: adaptor.DefaultRegistry(),
	}
}

// FormatLine processes a single line from stdout. If it detects an NDJSON event from any
// supported tool (agy, claude, opencode, codex), it formats it into ANSI-colorized text;
// otherwise it returns the raw line with normalized CRLF.
func (f *StreamFormatter) FormatLine(line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return ""
	}

	if f.registry != nil {
		if formatted, handled := f.registry.FormatLine(line); handled {
			return formatted
		}
	}

	// Normal raw terminal line: ensure standard \r\n line ending
	clean := strings.TrimRight(line, "\r\n")
	return clean + "\r\n"
}
