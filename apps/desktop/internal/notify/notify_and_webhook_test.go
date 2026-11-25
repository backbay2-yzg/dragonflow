package notify

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/github"
)

type mapResolver map[string]string

func (m mapResolver) Get(k string) (string, bool) {
	v, ok := m[k]
	return v, ok && v != ""
}

type fakeOrchTarget struct {
	ingested int
}

func (f *fakeOrchTarget) IngestIssue(_ context.Context, _ string, _ domain.GitHubIssue) (domain.TaskRecord, error) {
	f.ingested++
	return domain.TaskRecord{}, nil
}
func (f *fakeOrchTarget) HandleComment(_ context.Context, _ string, _ int, _ domain.GitHubComment) (*domain.TaskRecord, error) {
	return nil, nil
}
func (f *fakeOrchTarget) PollOpenPrs(_ context.Context, _ string) (int, error) {
	return 0, nil
}

func TestCommandsWebhookAndNotifications(t *testing.T) {
	c1 := github.ParseMaintainerCommand("Looks good!\n/auto qodercli", "alice", 2)
	if c1 == nil || c1.Command != domain.CmdAuto || c1.Arg != "qodercli" {
		t.Fatalf("unexpected parsed command: %+v", c1)
	}
	if github.ParseMaintainerCommand("just a normal comment", "bob", 6) != nil {
		t.Fatal("expected nil for non-command")
	}

	secret := "dragonflow-test-secret"
	rawBody := []byte(`{"action":"opened","repository":{"full_name":"acme/demo"},"issue":{"number":9,"title":"Crash","body":"trace","user":{"login":"alice"},"author_association":"OWNER","labels":[{"name":"auto-dev"}],"state":"open","html_url":"https://github.com/acme/demo/issues/9"}}`)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(rawBody)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !github.VerifyWebhookSignature(rawBody, sig, secret) {
		t.Fatal("expected valid signature")
	}
	if github.VerifyWebhookSignature(rawBody, "sha256=deadbeef", secret) {
		t.Fatal("expected invalid signature rejected")
	}

	target := &fakeOrchTarget{}
	wh := github.NewWebhookHandler(target, secret)
	rej, _ := wh.HandleEvent(context.Background(), "issues", "sha256=0000", rawBody)
	if rej.Accepted || target.ingested != 0 {
		t.Fatalf("expected rejected webhook, got %+v", rej)
	}
	acc, err := wh.HandleEvent(context.Background(), "issues", sig, rawBody)
	if err != nil || !acc.Accepted || target.ingested != 1 {
		t.Fatalf("expected accepted webhook, got %+v err=%v", acc, err)
	}

	var receivedCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	res := mapResolver{
		"FEISHU_URL":  srv.URL + "/feishu",
		"FEISHU_SEC":  "sec1",
		"DING_URL":    srv.URL + "/ding?access_token=abc",
		"DING_SEC":    "SECabc",
		"SLACK_URL":   srv.URL + "/slack",
		"TG_URL":      srv.URL + "/tg",
		"TG_CHAT":     "-10012345",
	}
	msg := NotificationMessage{
		Event:        domain.NotifyReadyToMerge,
		RepoFullName: "acme/demo",
		IssueNumber:  12,
		Title:        "Add OAuth login",
		Summary:      "CI passed",
		AgentID:      "claude",
	}

	feishu, err := FormatChannelPayload(domain.NotificationChannelConfig{ID: "f", Type: "feishu", URLEnv: "FEISHU_URL", SecretEnv: "FEISHU_SEC"}, msg, res)
	if err != nil || feishu.Body["msg_type"] != "text" || feishu.Body["sign"] == "" {
		t.Fatalf("unexpected feishu payload: %+v err=%v", feishu, err)
	}
	ding, err := FormatChannelPayload(domain.NotificationChannelConfig{ID: "d", Type: "dingtalk", URLEnv: "DING_URL", SecretEnv: "DING_SEC"}, msg, res)
	if err != nil || !strings.Contains(ding.URL, "&sign=") {
		t.Fatalf("unexpected ding payload: %+v err=%v", ding, err)
	}
	tg, err := FormatChannelPayload(domain.NotificationChannelConfig{ID: "t", Type: "telegram", URLEnv: "TG_URL", ChatIDEnv: "TG_CHAT"}, msg, res)
	if err != nil || tg.Body["chat_id"] != "-10012345" {
		t.Fatalf("unexpected telegram payload: %+v err=%v", tg, err)
	}

	disp := NewDispatcherWithResolver([]domain.NotificationChannelConfig{
		{ID: "slack", Type: "slack", Enabled: true, URLEnv: "SLACK_URL", Events: []domain.NotificationEventType{domain.NotifyReadyToMerge}},
		{ID: "feishu", Type: "feishu", Enabled: true, URLEnv: "FEISHU_URL", SecretEnv: "FEISHU_SEC", Events: []domain.NotificationEventType{domain.NotifyReleased}},
	}, res, srv.Client(), nil)
	sent, errs := disp.Notify(context.Background(), msg)
	if sent != 1 || len(errs) != 0 || receivedCount != 1 {
		b, _ := json.Marshal(errs)
		t.Fatalf("expected 1 sent notification, got sent=%d errs=%s count=%d", sent, string(b), receivedCount)
	}
}
