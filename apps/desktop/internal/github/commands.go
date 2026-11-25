package github

import (
	"regexp"
	"strings"

	"github.com/dragonflow/desktop/internal/domain"
)

var commandPattern = regexp.MustCompile(`(?i)^/(auto|approve|reject|fix|retry|merge|cancel)(?:\s+(.*))?$`)

func IsMaintainer(author, authorAssociation string, cfg domain.DragonFlowConfig) bool {
	switch strings.ToUpper(strings.TrimSpace(authorAssociation)) {
	case "OWNER", "MEMBER", "COLLABORATOR":
		return true
	}
	norm := strings.ToLower(strings.TrimSpace(author))
	for _, m := range cfg.GitHub.Maintainers {
		if strings.ToLower(strings.TrimSpace(m)) == norm {
			return true
		}
	}
	return false
}

func ParseMaintainerCommand(body, author string, commentID int64) *domain.ParsedCommand {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if !strings.HasPrefix(line, "/") {
			continue
		}
		m := commandPattern.FindStringSubmatch(line)
		if len(m) == 0 {
			continue
		}
		cmd := domain.ParsedCommandType(strings.ToLower(m[1]))
		arg := ""
		if len(m) > 2 {
			arg = strings.TrimSpace(m[2])
		}
		return &domain.ParsedCommand{
			Command:   cmd,
			Arg:       arg,
			Author:    author,
			CommentID: commentID,
		}
	}
	return nil
}
