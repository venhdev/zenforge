package domain

import (
	"testing"
)

func TestParseResourceURI(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantErr     bool
		wantProject string
		wantType    string
		wantID      string
	}{
		{
			name:        "Canonical resource URI with project",
			input:       "zenf://zenforge/resource/CONSTRUCTION_RULES",
			wantErr:     false,
			wantProject: "zenforge",
			wantType:    "resource",
			wantID:      "CONSTRUCTION_RULES",
		},
		{
			name:        "Canonical task URI with project",
			input:       "zenf://zenforge/task/task-01",
			wantErr:     false,
			wantProject: "zenforge",
			wantType:    "task",
			wantID:      "task-01",
		},
		{
			name:        "Global resource URI",
			input:       "zenf://global/resource/RULES",
			wantErr:     false,
			wantProject: "global",
			wantType:    "resource",
			wantID:      "RULES",
		},
		{
			name:        "Short resource URI with UUID",
			input:       "zenf://resource/res_01a1beff3a95460a283241ac156fcc7d",
			wantErr:     false,
			wantProject: "",
			wantType:    "resource",
			wantID:      "res_01a1beff3a95460a283241ac156fcc7d",
		},
		{
			name:        "Short task URI",
			input:       "zenf://task/task-99",
			wantErr:     false,
			wantProject: "",
			wantType:    "task",
			wantID:      "task-99",
		},
		{
			name:        "Plural type normalization (docs -> resource)",
			input:       "zenf://myproject/docs/API_SPEC",
			wantErr:     false,
			wantProject: "myproject",
			wantType:    "resource",
			wantID:      "API_SPEC",
		},
		{
			name:        "URN format (zenf:resource:CONSTRUCTION_RULES)",
			input:       "zenf:resource:CONSTRUCTION_RULES",
			wantErr:     false,
			wantProject: "",
			wantType:    "resource",
			wantID:      "CONSTRUCTION_RULES",
		},
		{
			name:        "URN format with project (zenf:zenforge:task:task-05)",
			input:       "zenf:zenforge:task:task-05",
			wantErr:     false,
			wantProject: "zenforge",
			wantType:    "task",
			wantID:      "task-05",
		},
		{
			name:        "Raw res_ prefix auto-detection",
			input:       "res_01a1beff3a95460a283241ac",
			wantErr:     false,
			wantProject: "",
			wantType:    "resource",
			wantID:      "res_01a1beff3a95460a283241ac",
		},
		{
			name:        "Raw task- prefix auto-detection",
			input:       "task-deploy-01",
			wantErr:     false,
			wantProject: "",
			wantType:    "task",
			wantID:      "task-deploy-01",
		},
		{
			name:        "Raw art_ prefix auto-detection",
			input:       "art_abcdef123456",
			wantErr:     false,
			wantProject: "",
			wantType:    "artifact",
			wantID:      "art_abcdef123456",
		},
		{
			name:    "Empty URI error",
			input:   "   ",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := ParseResourceURI(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ParseResourceURI(%q) err = %v, wantErr = %v", tt.input, err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if res.ProjectSlug != tt.wantProject {
				t.Errorf("ProjectSlug = %q, want %q", res.ProjectSlug, tt.wantProject)
			}
			if res.EntityType != tt.wantType {
				t.Errorf("EntityType = %q, want %q", res.EntityType, tt.wantType)
			}
			if res.Identifier != tt.wantID {
				t.Errorf("Identifier = %q, want %q", res.Identifier, tt.wantID)
			}
		})
	}
}

func TestResourceURI_String(t *testing.T) {
	uri := ResourceURI{
		Scheme:      "zenf",
		ProjectSlug: "zenforge",
		EntityType:  "resource",
		Identifier:  "CONSTRUCTION_RULES",
	}
	expected := "zenf://zenforge/resource/CONSTRUCTION_RULES"
	if got := uri.String(); got != expected {
		t.Errorf("uri.String() = %q, want %q", got, expected)
	}

	shortUri := ResourceURI{
		Scheme:     "zenf",
		EntityType: "doc",
		Identifier: "doc_123",
	}
	expectedShort := "zenf://doc/doc_123"
	if got := shortUri.String(); got != expectedShort {
		t.Errorf("shortUri.String() = %q, want %q", got, expectedShort)
	}
}
