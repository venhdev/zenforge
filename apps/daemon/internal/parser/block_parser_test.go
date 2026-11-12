package parser

import (
	"strings"
	"testing"
)

func TestParseBlocks_MixedDirectives(t *testing.T) {
	doc := `# Title of Encyclopedia

This is an introductory paragraph explaining the architecture.

` + "```" + `mermaid
graph TD
    Client --> Daemon
    Daemon --> SQLite
` + "```" + `

Here is a command to verify the service:

` + "```" + `bash:run
curl -s http://127.0.0.1:1123/api/v1/health | jq .
` + "```" + `

And the sample payload response:

` + "```" + `json:fixture
{
  "status": "healthy",
  "version": "v0.4.0"
}
` + "```" + `

ASCII UI Blueprint:

` + "```" + `ascii:wireframe
+-----------------------------+
| ZenForge Encyclopedia       |
+-----------------------------+
` + "```" + `

Final closing remarks.
`

	blocks := ParseBlocks(doc)
	if len(blocks) != 9 {
		t.Fatalf("expected 9 blocks, got %d", len(blocks))
	}

	// Block 0: Text header & intro
	if blocks[0].Type != "text" || blocks[0].Format != "markdown" {
		t.Errorf("block 0: expected text/markdown, got %s/%s", blocks[0].Type, blocks[0].Format)
	}
	if !strings.Contains(blocks[0].ContentString(), "Title of Encyclopedia") {
		t.Errorf("block 0 content missing header: %s", blocks[0].ContentString())
	}

	// Block 1: Diagram
	if blocks[1].Type != "diagram" || blocks[1].Format != "mermaid" {
		t.Errorf("block 1: expected diagram/mermaid, got %s/%s", blocks[1].Type, blocks[1].Format)
	}
	if !strings.Contains(blocks[1].ContentString(), "Client --> Daemon") {
		t.Errorf("block 1 content missing diagram text: %s", blocks[1].ContentString())
	}

	// Block 2: Text transition
	if blocks[2].Type != "text" {
		t.Errorf("block 2: expected text, got %s", blocks[2].Type)
	}

	// Block 3: Bash executable
	if blocks[3].Type != "bash" || blocks[3].Format != "bash" {
		t.Errorf("block 3: expected bash/bash, got %s/%s", blocks[3].Type, blocks[3].Format)
	}
	if blocks[3].Metadata["executable"] != true {
		t.Errorf("block 3 expected executable: true, got %v", blocks[3].Metadata)
	}
	if !strings.Contains(blocks[3].ContentString(), "curl -s http://127.0.0.1:1123") {
		t.Errorf("block 3 content missing curl: %s", blocks[3].ContentString())
	}

	// Block 4: Text transition
	if blocks[4].Type != "text" {
		t.Errorf("block 4: expected text, got %s", blocks[4].Type)
	}

	// Block 5: JSON Fixture
	if blocks[5].Type != "fixture" || blocks[5].Format != "json" {
		t.Errorf("block 5: expected fixture/json, got %s/%s", blocks[5].Type, blocks[5].Format)
	}
	if blocks[5].Metadata["structured"] != true {
		t.Errorf("block 5 expected structured: true, got %v", blocks[5].Metadata)
	}
	if !strings.Contains(blocks[5].ContentString(), `"healthy"`) {
		t.Errorf("block 5 content missing json key: %s", blocks[5].ContentString())
	}

	// Block 6: Text transition
	if blocks[6].Type != "text" {
		t.Errorf("block 6: expected text, got %s", blocks[6].Type)
	}

	// Block 7: Wireframe
	if blocks[7].Type != "wireframe" || blocks[7].Format != "ascii" {
		t.Errorf("block 7: expected wireframe/ascii, got %s/%s", blocks[7].Type, blocks[7].Format)
	}
	if !strings.Contains(blocks[7].ContentString(), "ZenForge Encyclopedia") {
		t.Errorf("block 7 content missing ASCII art: %s", blocks[7].ContentString())
	}

	// Block 8: Final text
	if blocks[8].Type != "text" {
		t.Errorf("block 8: expected text, got %s", blocks[8].Type)
	}
}

func TestSerializeBlocks_RoundTrip(t *testing.T) {
	original := `# Knowledge Article

` + "```" + `mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Active
` + "```" + `

` + "```" + `bash:run
go test -v ./...
` + "```" + `

` + "```" + `json:fixture
{
  "key": "value"
}
` + "```"

	blocks := ParseBlocks(original)
	serialized := SerializeBlocks(blocks)
	reparsed := ParseBlocks(serialized)

	if len(reparsed) != len(blocks) {
		t.Fatalf("round-trip block count mismatch: original %d, reparsed %d\nSerialized:\n%s", len(blocks), len(reparsed), serialized)
	}

	for i := range blocks {
		if blocks[i].Type != reparsed[i].Type {
			t.Errorf("block %d type mismatch: %s != %s", i, blocks[i].Type, reparsed[i].Type)
		}
		if blocks[i].Format != reparsed[i].Format {
			t.Errorf("block %d format mismatch: %s != %s", i, blocks[i].Format, reparsed[i].Format)
		}
		if strings.TrimSpace(blocks[i].ContentString()) != strings.TrimSpace(reparsed[i].ContentString()) {
			t.Errorf("block %d content mismatch:\nGot:\n%s\nExpected:\n%s", i, reparsed[i].ContentString(), blocks[i].ContentString())
		}
	}
}

func TestParseBlocks_NestedFence(t *testing.T) {
	doc := "````markdown\n```bash\necho hello\n```\n````"
	blocks := ParseBlocks(doc)
	if len(blocks) != 1 {
		t.Fatalf("expected 1 block, got %d", len(blocks))
	}
	if blocks[0].Type != "code" || blocks[0].Format != "markdown" {
		t.Errorf("expected code/markdown, got %s/%s", blocks[0].Type, blocks[0].Format)
	}
	if !strings.Contains(blocks[0].ContentString(), "echo hello") {
		t.Errorf("nested block content missing: %s", blocks[0].ContentString())
	}
}
