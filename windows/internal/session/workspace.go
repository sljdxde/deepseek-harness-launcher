package session

// workspace.go reads the session → workspace-name index. dsh's session
// events carry no workspace field, but ~/.dsh/storages/workspace.json
// records each workspace's sessionIds (the archive plugin reads the same
// file). When it cannot be read the menu row falls back to the title or
// the short id.

import (
	"encoding/json"
	"os"
	"sort"
)

// WorkspaceIndexFromFile loads the index from a workspace.json path; a
// missing or malformed file yields an empty index.
func WorkspaceIndexFromFile(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var state struct {
		Tables struct {
			Workspaces map[string]struct {
				Title      string `json:"title"`
				SessionIDs []any  `json:"sessionIds"`
			} `json:"workspaces"`
		} `json:"tables"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return nil
	}
	index := map[string]string{}
	// sorted keys keep the result stable when one session appears in
	// several workspaces
	keys := make([]string, 0, len(state.Tables.Workspaces))
	for key := range state.Tables.Workspaces {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		row := state.Tables.Workspaces[key]
		title := trimSpace(row.Title)
		if title == "" {
			continue
		}
		for _, value := range row.SessionIDs {
			if id, ok := value.(string); ok {
				if _, exists := index[id]; !exists {
					index[id] = title
				}
			}
		}
	}
	return index
}

func trimSpace(value string) string {
	start, end := 0, len(value)
	for start < end && (value[start] == ' ' || value[start] == '\t' || value[start] == '\n' || value[start] == '\r') {
		start++
	}
	for end > start && (value[end-1] == ' ' || value[end-1] == '\t' || value[end-1] == '\n' || value[end-1] == '\r') {
		end--
	}
	return value[start:end]
}
