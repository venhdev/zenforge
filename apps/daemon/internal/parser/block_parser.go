package parser

import (
	"encoding/json"
	"fmt"
	"strings"

	"zenf/internal/domain"
)

// ParseBlocks parses markdown text into a slice of structured domain.ResourceBlock.
// It detects directive code fences (mermaid, bash:run, json:fixture, ascii:wireframe)
// and preserves non-fenced markdown text as rich text blocks.
func ParseBlocks(markdown string) []domain.ResourceBlock {
	clean := strings.ReplaceAll(markdown, "\r\n", "\n")
	lines := strings.Split(clean, "\n")

	var blocks []domain.ResourceBlock
	var textBuffer []string

	flushText := func() {
		if len(textBuffer) == 0 {
			return
		}
		raw := strings.Join(textBuffer, "\n")
		textBuffer = nil
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return
		}
		dataBytes, _ := json.Marshal(trimmed)
		blocks = append(blocks, domain.ResourceBlock{
			ID:     fmt.Sprintf("blk-%d", len(blocks)+1),
			Type:   "text",
			Format: "markdown",
			Data:   json.RawMessage(dataBytes),
		})
	}

	inFence := false
	var fenceChar rune
	fenceLen := 0
	fenceInfo := ""
	var fenceLines []string

	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)

		if !inFence {
			// Check if line starts with at least 3 backticks or tildes
			if (strings.HasPrefix(trimmedLine, "```") || strings.HasPrefix(trimmedLine, "~~~")) {
				char := rune(trimmedLine[0])
				count := 0
				for _, r := range trimmedLine {
					if r == char {
						count++
					} else {
						break
					}
				}
				if count >= 3 {
					flushText()
					inFence = true
					fenceChar = char
					fenceLen = count
					fenceInfo = strings.TrimSpace(trimmedLine[count:])
					fenceLines = nil
					continue
				}
			}
			textBuffer = append(textBuffer, line)
		} else {
			// Inside fence: check for matching closing fence
			isClosing := false
			if strings.HasPrefix(trimmedLine, strings.Repeat(string(fenceChar), fenceLen)) {
				// Must consist only of the fence characters and trailing spaces
				rest := strings.TrimLeft(trimmedLine, string(fenceChar))
				if strings.TrimSpace(rest) == "" {
					isClosing = true
				}
			}

			if isClosing {
				body := strings.Join(fenceLines, "\n")
				block := buildFencedBlock(len(blocks)+1, fenceInfo, body)
				blocks = append(blocks, block)
				inFence = false
				fenceLines = nil
			} else {
				fenceLines = append(fenceLines, line)
			}
		}
	}

	// Flush remaining
	if inFence && len(fenceLines) > 0 {
		body := strings.Join(fenceLines, "\n")
		block := buildFencedBlock(len(blocks)+1, fenceInfo, body)
		blocks = append(blocks, block)
	} else {
		flushText()
	}

	if blocks == nil {
		blocks = []domain.ResourceBlock{}
	}
	return blocks
}

func buildFencedBlock(index int, info string, body string) domain.ResourceBlock {
	parts := strings.Fields(info)
	specifier := ""
	if len(parts) > 0 {
		specifier = parts[0]
	}
	lowered := strings.ToLower(specifier)

	bType := "code"
	format := specifier
	if format == "" {
		format = "text"
	}
	metadata := make(map[string]any)

	switch {
	case lowered == "mermaid":
		bType = "diagram"
		format = "mermaid"
	case lowered == "bash:run" || lowered == "sh:run" || lowered == "shell:run" || lowered == "bash:executable" || lowered == "sh:executable":
		bType = "bash"
		format = "bash"
		metadata["executable"] = true
	case lowered == "bash" || lowered == "sh" || lowered == "shell" || lowered == "zsh":
		bType = "bash"
		format = lowered
	case strings.HasPrefix(lowered, "json:fixture") || strings.HasPrefix(lowered, "fixture:json"):
		bType = "fixture"
		format = "json"
	case strings.HasPrefix(lowered, "yaml:fixture") || strings.HasPrefix(lowered, "fixture:yaml"):
		bType = "fixture"
		format = "yaml"
	case strings.HasPrefix(lowered, "ascii:wireframe") || strings.HasPrefix(lowered, "wireframe:ascii") || lowered == "wireframe":
		bType = "wireframe"
		format = "ascii"
	case lowered == "ascii" || lowered == "ascii:art":
		bType = "wireframe"
		format = "ascii"
	}

	var rawData json.RawMessage
	trimmedBody := strings.TrimSpace(body)

	// If fixture with valid structured JSON, store JSON directly
	if bType == "fixture" && format == "json" && json.Valid([]byte(trimmedBody)) &&
		(strings.HasPrefix(trimmedBody, "{") || strings.HasPrefix(trimmedBody, "[")) {
		rawData = json.RawMessage(trimmedBody)
		metadata["structured"] = true
	} else {
		dataBytes, _ := json.Marshal(body)
		rawData = json.RawMessage(dataBytes)
	}

	var metaMap map[string]any
	if len(metadata) > 0 {
		metaMap = metadata
	}

	return domain.ResourceBlock{
		ID:       fmt.Sprintf("blk-%d", index),
		Type:     bType,
		Format:   format,
		Data:     rawData,
		Metadata: metaMap,
	}
}

// SerializeBlocks serializes a slice of ResourceBlocks into canonical GFM Markdown.
func SerializeBlocks(blocks []domain.ResourceBlock) string {
	return domain.SerializeBlocks(blocks)
}
