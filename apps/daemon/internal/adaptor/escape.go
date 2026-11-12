package adaptor

import (
	"strings"
)

// quoteShellArg encloses an argument in single quotes for POSIX shell execution,
// properly escaping any internal single quotes.
func quoteShellArg(arg string) string {
	if arg == "" {
		return "''"
	}
	// POSIX single-quote escaping: replace ' with '\''
	escaped := strings.ReplaceAll(arg, "'", "'\\''")
	return "'" + escaped + "'"
}

// escapeShellArg escapes double quotes and shell control characters for template interpolation.
func escapeShellArg(arg string) string {
	r := strings.ReplaceAll(arg, `\`, `\\`)
	r = strings.ReplaceAll(r, `"`, `\"`)
	r = strings.ReplaceAll(r, `$`, `\$`)
	r = strings.ReplaceAll(r, "`", "\\`")
	return r
}
