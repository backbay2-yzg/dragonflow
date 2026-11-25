package llm

import (
	"context"
	"encoding/json"
	"strings"
)

type MockResponder func(stage, userPrompt string) any

type MockStructuredClient struct {
	responder MockResponder
}

func NewMockStructuredClient(responder MockResponder) *MockStructuredClient {
	return &MockStructuredClient{responder: responder}
}

func (m *MockStructuredClient) CompleteRaw(_ context.Context, req StructuredRequest, validate func([]byte) error) ([]byte, string, string, int, float64, error) {
	var rawObj any
	if m.responder != nil {
		rawObj = m.responder(req.Stage, req.UserPrompt)
	} else {
		rawObj = defaultMockResponse(req.Stage, req.UserPrompt)
	}
	rawBytes, err := json.Marshal(rawObj)
	if err != nil {
		return nil, "", "", 0, 0, err
	}
	if validate != nil {
		if err := validate(rawBytes); err != nil {
			return nil, "", "", 0, 0, err
		}
	}
	return rawBytes, "mock", "dragonflow-mock-llm", 320, 0.0005, nil
}

func defaultMockResponse(stage, userPrompt string) any {
	lower := strings.ToLower(userPrompt)

	switch stage {
	case "triage":
		isDocs := strings.Contains(lower, "doc") || strings.Contains(lower, "readme") || strings.Contains(lower, "typo")
		isFeature := strings.Contains(lower, "feature") ||
			strings.Contains(lower, "oauth") ||
			strings.Contains(lower, "architecture") ||
			strings.Contains(lower, "plugin") ||
			strings.Contains(lower, "新功能") ||
			strings.Contains(lower, "支持")
		needsInfo := strings.Contains(lower, "unclear") || strings.Contains(lower, "no repro") || len(lower) < 35

		complexity := 2
		category := "bug"
		label := "bug"
		summary := "定位明确的代码缺陷修复任务。"
		tier := "quick_fix"
		if isDocs {
			complexity = 1
			category = "docs"
			label = "documentation"
			summary = "文档或说明性小范围修正。"
		} else if isFeature {
			complexity = 4
			category = "feature"
			label = "enhancement"
			summary = "需要跨模块设计与多文件联动实现的功能需求。"
			tier = "full_sdlc"
		}
		questions := []string{}
		if needsInfo {
			questions = []string{"请补充复现步骤或预期行为", "请注明运行环境与版本号"}
		}
		return map[string]any{
			"category":            category,
			"isDuplicate":         false,
			"needsMoreInfo":       needsInfo,
			"clarifyingQuestions": questions,
			"suggestedLabels":     []string{label},
			"estimatedComplexity": complexity,
			"recommendedTier":     tier,
			"summary":             summary,
			"riskFlags":           []string{},
		}

	case "routing":
		isFeature := strings.Contains(lower, `"category": "feature"`) || strings.Contains(lower, `complexity": 4`)
		primary := "qodercli"
		rationale := "中低复杂度定位修复，优先调度高性价比快速修复 Agent。"
		tier := "quick_fix"
		if isFeature {
			primary = "claude"
			rationale = "复杂架构/多模块新功能，优先调度长程规划与重构能力强的 Agent。"
			tier = "full_sdlc"
		}
		return map[string]any{
			"primaryAgent":    primary,
			"rationale":       rationale,
			"recommendedTier": tier,
		}

	case "spec":
		return map[string]any{
			"problemStatement": "根据 Issue 描述明确目标边界，修复缺陷/实现需求并补充自动化测试覆盖。",
			"acceptanceCriteria": []string{
				"满足 Issue 中提出的核心功能与边界条件",
				"所有既有测试与新增单元测试全部通过",
				"不引入破坏性变更或未授权的敏感文件改动",
			},
			"nonGoals":      []string{"不重构无关模块", "不更改公共配置兼容性"},
			"affectedAreas": []string{"src/", "tests/"},
		}

	case "plan":
		return map[string]any{
			"architectureSummary": "采用模块化增量改造方案：保持现有接口向后兼容，新增核心逻辑并配合完整单测验证。",
			"filesToModify":       []string{"src/sum.txt", "tests/"},
			"implementationSteps": []string{
				"1. 梳理受影响调用链并抽取清晰的接口边界",
				"2. 编写核心业务逻辑与边界错误处理",
				"3. 补充单元测试与回归验证脚本",
			},
			"testPlan":            []string{"运行本地构建与校验套件", "校验产物与基础边界条件零报错"},
			"risksAndMitigations": []string{"注意异常输入与并发边界，已纳入单测覆盖"},
		}

	case "cross_review":
		return map[string]any{
			"approved": true,
			"summary":  "代码改动聚焦、逻辑清晰、测试充分且无明显安全隐患，同意进入 PR 阶段。",
			"findings": []any{},
			"checklist": map[string]any{
				"acceptanceCriteriaMet":  true,
				"testsAdequate":          true,
				"noObviousSecurityRisks": true,
				"cleanScope":             true,
			},
		}

	default:
		return map[string]any{}
	}
}
