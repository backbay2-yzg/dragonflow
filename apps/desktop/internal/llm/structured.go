package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/dragonflow/desktop/internal/adapters"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/secrets"
)

type StructuredRequest struct {
	Stage        string
	SystemPrompt string
	UserPrompt   string
	Cwd          string
	OnLog        func(stream, message string)
}

type StructuredResponse[T any] struct {
	Data     T
	Provider string
	Model    string
	Tokens   int
	CostUsd  float64
}

type Client interface {
	CompleteRaw(ctx context.Context, req StructuredRequest, validate func(raw []byte) error) (raw []byte, provider, model string, tokens int, costUsd float64, err error)
}

func CompleteJSON[T any](ctx context.Context, client Client, req StructuredRequest, validate func(*T) error) (StructuredResponse[T], error) {
	var parsed T
	raw, provider, model, tokens, costUsd, err := client.CompleteRaw(ctx, req, func(rawBytes []byte) error {
		var tmp T
		if err := json.Unmarshal(rawBytes, &tmp); err != nil {
			return err
		}
		if validate != nil {
			if err := validate(&tmp); err != nil {
				return err
			}
		}
		parsed = tmp
		return nil
	})
	if err != nil {
		return StructuredResponse[T]{}, err
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return StructuredResponse[T]{}, err
	}
	if validate != nil {
		if err := validate(&parsed); err != nil {
			return StructuredResponse[T]{}, err
		}
	}
	return StructuredResponse[T]{
		Data:     parsed,
		Provider: provider,
		Model:    model,
		Tokens:   tokens,
		CostUsd:  costUsd,
	}, nil
}

var jsonFenceRegex = regexp.MustCompile("(?is)```(?:json)?\\s*([\\s\\S]*?)```")

func ExtractJSONFromText(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(raw)
	if json.Valid([]byte(trimmed)) {
		return []byte(trimmed), nil
	}
	if m := jsonFenceRegex.FindStringSubmatch(trimmed); len(m) > 1 {
		inner := strings.TrimSpace(m[1])
		if json.Valid([]byte(inner)) {
			return []byte(inner), nil
		}
	}
	first := strings.IndexByte(trimmed, '{')
	last := strings.LastIndexByte(trimmed, '}')
	if first != -1 && last > first {
		slice := trimmed[first : last+1]
		if json.Valid([]byte(slice)) {
			return []byte(slice), nil
		}
	}
	snippet := trimmed
	if len(snippet) > 200 {
		snippet = snippet[:200]
	}
	return nil, fmt.Errorf("Unable to extract valid JSON from LLM response: %s", snippet)
}

type DualChannelClient struct {
	cfg        domain.LlmConfig
	registry   *adapters.Registry
	vault      *secrets.SecretVault
	httpClient *http.Client
}

func NewDualChannelClient(cfg domain.LlmConfig, registry *adapters.Registry, vault *secrets.SecretVault) *DualChannelClient {
	return &DualChannelClient{
		cfg:      cfg,
		registry: registry,
		vault:    vault,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (c *DualChannelClient) resolveAPIKey() string {
	if c.vault != nil {
		if val, ok := c.vault.Get(c.cfg.ApiKeyEnv); ok {
			return val
		}
	}
	return os.Getenv(c.cfg.ApiKeyEnv)
}

func (c *DualChannelClient) CompleteRaw(ctx context.Context, req StructuredRequest, validate func([]byte) error) ([]byte, string, string, int, float64, error) {
	apiKey := c.resolveAPIKey()

	if c.cfg.Mode != "cli_only" && apiKey != "" {
		raw, tokens, cost, err := c.callHTTPAPI(ctx, req, apiKey, validate)
		if err == nil {
			return raw, c.cfg.Provider, c.cfg.Model, tokens, cost, nil
		}
		if c.cfg.Mode == "api" {
			return nil, "", "", 0, 0, err
		}
		if req.OnLog != nil {
			req.OnLog("system", fmt.Sprintf("[LLM] HTTP API failed (%s), falling back to headless CLI...", err.Error()))
		}
	}

	if c.cfg.Mode == "api" && apiKey == "" {
		return nil, "", "", 0, 0, fmt.Errorf("LLM mode is \"api\" but %s is not configured", c.cfg.ApiKeyEnv)
	}

	return c.callCLIFallback(ctx, req, validate)
}

func (c *DualChannelClient) singleHTTPAttempt(ctx context.Context, req StructuredRequest, apiKey, repairHint string) (string, int, error) {
	userMessage := req.UserPrompt
	if repairHint != "" {
		userMessage = fmt.Sprintf("%s\n\nPrevious output failed JSON schema validation: %s\nReturn ONLY valid JSON matching the requested schema.", req.UserPrompt, repairHint)
	}

	switch c.cfg.Provider {
	case "anthropic":
		baseURL := strings.TrimRight(c.cfg.BaseURL, "/")
		endpoint := "https://api.anthropic.com/v1/messages"
		if strings.Contains(strings.ToLower(baseURL), "anthropic") {
			endpoint = baseURL + "/v1/messages"
		}
		payload := map[string]any{
			"model":       c.cfg.Model,
			"max_tokens":  c.cfg.MaxTokens,
			"temperature": c.cfg.Temperature,
			"system":      req.SystemPrompt + "\nRespond ONLY with valid JSON.",
			"messages":    []map[string]string{{"role": "user", "content": userMessage}},
		}
		bodyBytes, _ := json.Marshal(payload)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if err != nil {
			return "", 0, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("x-api-key", apiKey)
		httpReq.Header.Set("anthropic-version", "2023-06-01")

		resp, err := c.httpClient.Do(httpReq)
		if err != nil {
			return "", 0, err
		}
		defer resp.Body.Close()
		rawResp, _ := io.ReadAll(resp.Body)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return "", 0, fmt.Errorf("Anthropic API error %d: %s", resp.StatusCode, string(rawResp))
		}
		var out struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
			Usage struct {
				InputTokens  int `json:"input_tokens"`
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(rawResp, &out); err != nil {
			return "", 0, err
		}
		var parts []string
		for _, block := range out.Content {
			parts = append(parts, block.Text)
		}
		return strings.Join(parts, "\n"), out.Usage.InputTokens + out.Usage.OutputTokens, nil

	case "gemini":
		endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", url.PathEscape(c.cfg.Model), url.QueryEscape(apiKey))
		payload := map[string]any{
			"systemInstruction": map[string]any{"parts": []map[string]string{{"text": req.SystemPrompt}}},
			"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": userMessage}}}},
			"generationConfig": map[string]any{
				"temperature":      c.cfg.Temperature,
				"maxOutputTokens":  c.cfg.MaxTokens,
				"responseMimeType": "application/json",
			},
		}
		bodyBytes, _ := json.Marshal(payload)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if err != nil {
			return "", 0, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		resp, err := c.httpClient.Do(httpReq)
		if err != nil {
			return "", 0, err
		}
		defer resp.Body.Close()
		rawResp, _ := io.ReadAll(resp.Body)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return "", 0, fmt.Errorf("Gemini API error %d: %s", resp.StatusCode, string(rawResp))
		}
		var out struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
			UsageMetadata struct {
				TotalTokenCount int `json:"totalTokenCount"`
			} `json:"usageMetadata"`
		}
		if err := json.Unmarshal(rawResp, &out); err != nil {
			return "", 0, err
		}
		text := ""
		if len(out.Candidates) > 0 && len(out.Candidates[0].Content.Parts) > 0 {
			text = out.Candidates[0].Content.Parts[0].Text
		}
		return text, out.UsageMetadata.TotalTokenCount, nil

	default:
		baseURL := strings.TrimRight(c.cfg.BaseURL, "/")
		endpoint := baseURL + "/chat/completions"
		payload := map[string]any{
			"model":           c.cfg.Model,
			"temperature":     c.cfg.Temperature,
			"max_tokens":      c.cfg.MaxTokens,
			"response_format": map[string]string{"type": "json_object"},
			"messages": []map[string]string{
				{"role": "system", "content": req.SystemPrompt + "\nReturn ONLY valid JSON."},
				{"role": "user", "content": userMessage},
			},
		}
		bodyBytes, _ := json.Marshal(payload)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if err != nil {
			return "", 0, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := c.httpClient.Do(httpReq)
		if err != nil {
			return "", 0, err
		}
		defer resp.Body.Close()
		rawResp, _ := io.ReadAll(resp.Body)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return "", 0, fmt.Errorf("OpenAI-compatible API error %d: %s", resp.StatusCode, string(rawResp))
		}
		var out struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
			Usage struct {
				TotalTokens int `json:"total_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(rawResp, &out); err != nil {
			return "", 0, err
		}
		text := ""
		if len(out.Choices) > 0 {
			text = out.Choices[0].Message.Content
		}
		return text, out.Usage.TotalTokens, nil
	}
}

func (c *DualChannelClient) callHTTPAPI(ctx context.Context, req StructuredRequest, apiKey string, validate func([]byte) error) ([]byte, int, float64, error) {
	text1, tok1, err := c.singleHTTPAttempt(ctx, req, apiKey, "")
	if err != nil {
		return nil, 0, 0, err
	}
	json1, err1 := ExtractJSONFromText(text1)
	if err1 == nil && validate != nil {
		err1 = validate(json1)
	}
	if err1 == nil {
		cost := math.Round(float64(tok1)*0.000002*1e6) / 1e6
		return json1, tok1, cost, nil
	}

	text2, tok2, err := c.singleHTTPAttempt(ctx, req, apiKey, err1.Error())
	if err != nil {
		return nil, 0, 0, err
	}
	json2, err2 := ExtractJSONFromText(text2)
	if err2 != nil {
		return nil, 0, 0, err2
	}
	if validate != nil {
		if verr := validate(json2); verr != nil {
			return nil, 0, 0, verr
		}
	}
	totalTok := tok1 + tok2
	cost := math.Round(float64(totalTok)*0.000002*1e6) / 1e6
	return json2, totalTok, cost, nil
}

func (c *DualChannelClient) callCLIFallback(ctx context.Context, req StructuredRequest, validate func([]byte) error) ([]byte, string, string, int, float64, error) {
	if c.registry == nil {
		return nil, "", "", 0, 0, errors.New("No AgentRegistry configured for CLI headless LLM fallback")
	}

	preferred := c.cfg.CliFallbackAgentID
	available := c.registry.GetAvailableAgents()
	chosenID := ""
	if preferred != "" && c.registry.IsAvailable(preferred) {
		chosenID = preferred
	} else if len(available) > 0 {
		chosenID = available[0].ID
	}
	if chosenID == "" {
		return nil, "", "", 0, 0, fmt.Errorf("No API key (%s) and no available Coding Agent CLI for headless fallback", c.cfg.ApiKeyEnv)
	}

	adapter := c.registry.GetAdapter(chosenID)
	if adapter == nil {
		return nil, "", "", 0, 0, fmt.Errorf("Adapter %q not found", chosenID)
	}
	if req.OnLog != nil {
		req.OnLog("system", fmt.Sprintf("[LLM:CLI-Fallback] Using %q for stage %q", chosenID, req.Stage))
	}

	cwd := req.Cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	prompt := fmt.Sprintf("%s\n\nIMPORTANT: Respond with ONLY a valid JSON object (no markdown commentary outside the JSON).\n\n%s", req.SystemPrompt, req.UserPrompt)
	res := adapter.Execute(ctx, adapters.AgentExecContext{
		TaskID:   "llm-fallback",
		RunID:    "llm-fallback",
		Stage:    req.Stage,
		Cwd:      cwd,
		Prompt:   prompt,
		ReadOnly: true,
		OnLog:    req.OnLog,
	})
	if !res.Success {
		return nil, "", "", 0, 0, fmt.Errorf("CLI fallback %q failed (%s): %s", chosenID, res.ErrorKind, res.RawStderr)
	}

	extracted, err := ExtractJSONFromText(res.OutputText)
	if err != nil {
		return nil, "", "", 0, 0, err
	}
	if validate != nil {
		if err := validate(extracted); err != nil {
			return nil, "", "", 0, 0, err
		}
	}
	model := adapter.Profile().Model
	if model == "" {
		model = string(adapter.Profile().Type)
	}
	return extracted, "cli:" + chosenID, model, res.TokensUsed, res.CostUsd, nil
}
