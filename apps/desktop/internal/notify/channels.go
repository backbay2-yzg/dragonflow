package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/secrets"
)

type NotificationMessage struct {
	TaskID       string
	Event        domain.NotificationEventType
	RepoFullName string
	IssueNumber  int
	Title        string
	Summary      string
	AgentID      string
	PrURL        string
	ReleaseURL   string
	IssueURL     string
}

type ChannelPayload struct {
	URL  string
	Body map[string]any
}

type SecretResolver interface {
	Get(key string) (string, bool)
}

type envSecretResolver struct{}

func (envSecretResolver) Get(key string) (string, bool) {
	v, ok := os.LookupEnv(key)
	return v, ok && v != ""
}

func FormatChannelPayload(ch domain.NotificationChannelConfig, msg NotificationMessage, resolver SecretResolver) (ChannelPayload, error) {
	if resolver == nil {
		resolver = envSecretResolver{}
	}
	baseURL, ok := resolver.Get(ch.URLEnv)
	if !ok || baseURL == "" {
		return ChannelPayload{}, fmt.Errorf("Missing webhook URL secret %q for channel %s", ch.URLEnv, ch.ID)
	}

	lines := []string{
		fmt.Sprintf("[DragonFlow] %s — %s#%d", strings.ToUpper(string(msg.Event)), msg.RepoFullName, msg.IssueNumber),
		"标题: " + msg.Title,
		"说明: " + msg.Summary,
	}
	if msg.AgentID != "" {
		lines = append(lines, "Agent: "+msg.AgentID)
	}
	if msg.PrURL != "" {
		lines = append(lines, "PR: "+msg.PrURL)
	}
	if msg.ReleaseURL != "" {
		lines = append(lines, "Release: "+msg.ReleaseURL)
	}
	if msg.IssueURL != "" {
		lines = append(lines, "Issue: "+msg.IssueURL)
	}
	text := strings.Join(lines, "\n")

	switch ch.Type {
	case "feishu":
		body := map[string]any{
			"msg_type": "text",
			"content":  map[string]string{"text": text},
		}
		if ch.SecretEnv != "" {
			if sec, ok := resolver.Get(ch.SecretEnv); ok && sec != "" {
				ts := strconv.FormatInt(time.Now().Unix(), 10)
				stringToSign := ts + "\n" + sec
				mac := hmac.New(sha256.New, []byte(stringToSign))
				sign := base64.StdEncoding.EncodeToString(mac.Sum(nil))
				body["timestamp"] = ts
				body["sign"] = sign
			}
		}
		return ChannelPayload{URL: baseURL, Body: body}, nil

	case "dingtalk":
		targetURL := baseURL
		if ch.SecretEnv != "" {
			if sec, ok := resolver.Get(ch.SecretEnv); ok && sec != "" {
				ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
				stringToSign := ts + "\n" + sec
				mac := hmac.New(sha256.New, []byte(sec))
				_, _ = mac.Write([]byte(stringToSign))
				sign := url.QueryEscape(base64.StdEncoding.EncodeToString(mac.Sum(nil)))
				sep := "?"
				if strings.Contains(targetURL, "?") {
					sep = "&"
				}
				targetURL = fmt.Sprintf("%s%stimestamp=%s&sign=%s", targetURL, sep, ts, sign)
			}
		}
		mdLines := make([]string, 0, len(lines))
		for _, l := range lines {
			mdLines = append(mdLines, "- "+l)
		}
		return ChannelPayload{
			URL: targetURL,
			Body: map[string]any{
				"msgtype": "markdown",
				"markdown": map[string]string{
					"title": fmt.Sprintf("DragonFlow #%d", msg.IssueNumber),
					"text":  strings.Join(mdLines, "\n"),
				},
			},
		}, nil

	case "wecom":
		return ChannelPayload{
			URL: baseURL,
			Body: map[string]any{
				"msgtype":  "markdown",
				"markdown": map[string]string{"content": text},
			},
		}, nil

	case "slack":
		return ChannelPayload{
			URL:  baseURL,
			Body: map[string]any{"text": text},
		}, nil

	case "discord":
		return ChannelPayload{
			URL:  baseURL,
			Body: map[string]any{"content": text},
		}, nil

	case "telegram":
		chatID := ""
		if ch.ChatIDEnv != "" {
			chatID, _ = resolver.Get(ch.ChatIDEnv)
		}
		return ChannelPayload{
			URL: baseURL,
			Body: map[string]any{
				"chat_id": chatID,
				"text":    text,
			},
		}, nil

	default:
		return ChannelPayload{
			URL: baseURL,
			Body: map[string]any{
				"event":        msg.Event,
				"repoFullName": msg.RepoFullName,
				"issueNumber":  msg.IssueNumber,
				"title":        msg.Title,
				"summary":      msg.Summary,
				"agentId":      msg.AgentID,
				"prUrl":        msg.PrURL,
				"releaseUrl":   msg.ReleaseURL,
				"issueUrl":     msg.IssueURL,
				"text":         text,
			},
		}, nil
	}
}

type DesktopNotifier interface {
	NotifyDesktop(msg NotificationMessage)
}

type Dispatcher struct {
	channels   []domain.NotificationChannelConfig
	resolver   SecretResolver
	httpClient *http.Client
	desktop    DesktopNotifier
}

func NewDispatcher(channels []domain.NotificationChannelConfig, vault *secrets.SecretVault, desktop DesktopNotifier) *Dispatcher {
	var res SecretResolver = envSecretResolver{}
	if vault != nil {
		res = vault
	}
	return &Dispatcher{
		channels: channels,
		resolver: res,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		desktop: desktop,
	}
}

func NewDispatcherWithResolver(channels []domain.NotificationChannelConfig, resolver SecretResolver, httpClient *http.Client, desktop DesktopNotifier) *Dispatcher {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Dispatcher{
		channels:   channels,
		resolver:   resolver,
		httpClient: httpClient,
		desktop:    desktop,
	}
}

func containsNotifyEvent(list []domain.NotificationEventType, target domain.NotificationEventType) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

func (d *Dispatcher) Notify(ctx context.Context, msg NotificationMessage) (int, []string) {
	if d.desktop != nil {
		d.desktop.NotifyDesktop(msg)
	}

	var active []domain.NotificationChannelConfig
	for _, ch := range d.channels {
		if !ch.Enabled || !containsNotifyEvent(ch.Events, msg.Event) {
			continue
		}
		if v, ok := d.resolver.Get(ch.URLEnv); ok && v != "" {
			active = append(active, ch)
		}
	}
	if len(active) == 0 {
		return 0, nil
	}

	var (
		mu     sync.Mutex
		wg     sync.WaitGroup
		sent   int
		errors []string
	)
	for _, ch := range active {
		wg.Add(1)
		go func(channel domain.NotificationChannelConfig) {
			defer wg.Done()
			payload, err := FormatChannelPayload(channel, msg, d.resolver)
			if err != nil {
				mu.Lock()
				errors = append(errors, fmt.Sprintf("%s: %s", channel.ID, err.Error()))
				mu.Unlock()
				return
			}
			bodyBytes, _ := json.Marshal(payload.Body)
			reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, payload.URL, bytes.NewReader(bodyBytes))
			if err != nil {
				mu.Lock()
				errors = append(errors, fmt.Sprintf("%s: %s", channel.ID, err.Error()))
				mu.Unlock()
				return
			}
			req.Header.Set("Content-Type", "application/json")
			resp, err := d.httpClient.Do(req)
			if err != nil {
				mu.Lock()
				errors = append(errors, fmt.Sprintf("%s: %s", channel.ID, err.Error()))
				mu.Unlock()
				return
			}
			_ = resp.Body.Close()
			mu.Lock()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				errors = append(errors, fmt.Sprintf("%s: HTTP %d", channel.ID, resp.StatusCode))
			} else {
				sent++
			}
			mu.Unlock()
		}(ch)
	}
	wg.Wait()
	return sent, errors
}
