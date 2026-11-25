package github

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
)

func VerifyWebhookSignature(rawBody []byte, signatureHeader, secret string) bool {
	if secret == "" || !strings.HasPrefix(signatureHeader, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(rawBody)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if len(signatureHeader) != len(expected) {
		return false
	}
	return hmac.Equal([]byte(signatureHeader), []byte(expected))
}

type WebhookHandleResult struct {
	Accepted bool   `json:"accepted"`
	Action   string `json:"action,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

type WebhookHandler struct {
	orch   PollerOrchestratorTarget
	secret string
}

func NewWebhookHandler(orch PollerOrchestratorTarget, secret string) *WebhookHandler {
	return &WebhookHandler{
		orch:   orch,
		secret: secret,
	}
}

func (h *WebhookHandler) HandleEvent(ctx context.Context, eventName, signatureHeader string, rawBody []byte) (WebhookHandleResult, error) {
	if h.secret != "" {
		if !VerifyWebhookSignature(rawBody, signatureHeader, h.secret) {
			return WebhookHandleResult{Accepted: false, Reason: "Invalid webhook signature"}, nil
		}
	}

	var payload map[string]any
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		return WebhookHandleResult{Accepted: false, Reason: "Invalid JSON payload"}, err
	}

	repoObj, _ := payload["repository"].(map[string]any)
	repoFullName, _ := repoObj["full_name"].(string)
	if repoFullName == "" {
		return WebhookHandleResult{Accepted: false, Reason: "Missing repository.full_name in payload"}, nil
	}

	switch eventName {
	case "issues":
		action, _ := payload["action"].(string)
		switch action {
		case "opened", "edited", "labeled", "reopened":
			rawIssue, _ := payload["issue"].(map[string]any)
			numF, _ := rawIssue["number"].(float64)
			title, _ := rawIssue["title"].(string)
			body, _ := rawIssue["body"].(string)
			userObj, _ := rawIssue["user"].(map[string]any)
			author, _ := userObj["login"].(string)
			if author == "" {
				author = "unknown"
			}
			assoc, _ := rawIssue["author_association"].(string)
			if assoc == "" {
				assoc = "NONE"
			}
			rawLabels, _ := rawIssue["labels"].([]any)
			stateStr, _ := rawIssue["state"].(string)
			state := "open"
			if stateStr == "closed" {
				state = "closed"
			}
			htmlURL, _ := rawIssue["html_url"].(string)
			createdAt, _ := rawIssue["created_at"].(string)
			if createdAt == "" {
				createdAt = time.Now().UTC().Format(time.RFC3339)
			}
			updatedAt, _ := rawIssue["updated_at"].(string)
			if updatedAt == "" {
				updatedAt = time.Now().UTC().Format(time.RFC3339)
			}
			_, err := h.orch.IngestIssue(ctx, repoFullName, domain.GitHubIssue{
				Number:            int(numF),
				Title:             title,
				Body:              body,
				Author:            author,
				AuthorAssociation: assoc,
				Labels:            extractLabels(rawLabels),
				State:             state,
				URL:               htmlURL,
				CreatedAt:         createdAt,
				UpdatedAt:         updatedAt,
			})
			if err != nil {
				return WebhookHandleResult{Accepted: false, Reason: err.Error()}, err
			}
			return WebhookHandleResult{Accepted: true, Action: "issues:" + action}, nil
		}

	case "issue_comment":
		action, _ := payload["action"].(string)
		if action == "created" {
			rawIssue, _ := payload["issue"].(map[string]any)
			rawComment, _ := payload["comment"].(map[string]any)
			numF, _ := rawIssue["number"].(float64)
			cidF, _ := rawComment["id"].(float64)
			body, _ := rawComment["body"].(string)
			userObj, _ := rawComment["user"].(map[string]any)
			author, _ := userObj["login"].(string)
			if author == "" {
				author = "unknown"
			}
			assoc, _ := rawComment["author_association"].(string)
			if assoc == "" {
				assoc = "NONE"
			}
			createdAt, _ := rawComment["created_at"].(string)
			updatedAt, _ := rawComment["updated_at"].(string)
			htmlURL, _ := rawComment["html_url"].(string)

			_, err := h.orch.HandleComment(ctx, repoFullName, int(numF), domain.GitHubComment{
				ID:                int64(cidF),
				Body:              body,
				Author:            author,
				AuthorAssociation: assoc,
				CreatedAt:         createdAt,
				UpdatedAt:         updatedAt,
				URL:               htmlURL,
			})
			if err != nil {
				return WebhookHandleResult{Accepted: false, Reason: err.Error()}, err
			}
			return WebhookHandleResult{Accepted: true, Action: "issue_comment:created"}, nil
		}

	case "pull_request", "pull_request_review", "check_suite", "check_run", "release":
		_, _ = h.orch.PollOpenPrs(ctx, repoFullName)
		return WebhookHandleResult{Accepted: true, Action: eventName}, nil
	}

	return WebhookHandleResult{Accepted: true, Action: "ignored:" + eventName}, nil
}

// WebhookServer listens on HTTP only when explicitly enabled in desktop settings.
type WebhookServer struct {
	mu      sync.Mutex
	server  *http.Server
	address string
}

func NewWebhookServer() *WebhookServer {
	return &WebhookServer{}
}

func (w *WebhookServer) Start(host string, port int, handler *WebhookHandler) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.server != nil {
		return nil
	}
	if host == "" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		port = 4390
	}
	addr := fmt.Sprintf("%s:%d", host, port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		_, _ = rw.Write([]byte(`{"ok":true,"desktop":true}`))
	})
	mux.HandleFunc("/webhooks/github", func(rw http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(rw, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		if err != nil {
			http.Error(rw, "Failed to read body", http.StatusBadRequest)
			return
		}
		res, err := handler.HandleEvent(r.Context(), r.Header.Get("X-GitHub-Event"), r.Header.Get("X-Hub-Signature-256"), raw)
		rw.Header().Set("Content-Type", "application/json")
		if err != nil {
			rw.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(rw).Encode(map[string]any{"error": err.Error()})
			return
		}
		if !res.Accepted {
			rw.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(rw).Encode(map[string]any{"error": res.Reason})
			return
		}
		rw.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(rw).Encode(map[string]any{"ok": true, "action": res.Action})
	})

	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	w.server = srv
	w.address = ln.Addr().String()

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			// silently ignored on stop
		}
	}()
	return nil
}

func (w *WebhookServer) Stop() {
	w.mu.Lock()
	srv := w.server
	w.server = nil
	w.address = ""
	w.mu.Unlock()

	if srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}
}

func (w *WebhookServer) Status() (bool, string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.server != nil, w.address
}
