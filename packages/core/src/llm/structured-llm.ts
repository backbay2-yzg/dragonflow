import type { DragonFlowConfig } from '@dragonflow/shared';
import type { ZodType, ZodTypeDef } from 'zod';
import type { AgentRegistry } from '../adapters/registry.js';

export interface StructuredCompletionRequest<T> {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  cwd?: string;
  onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
}

export interface StructuredCompletionResponse<T> {
  data: T;
  provider: string;
  model: string;
  tokens: number;
  costUsd: number;
}

export interface LlmClient {
  completeJson<T>(
    req: StructuredCompletionRequest<T>,
  ): Promise<StructuredCompletionResponse<T>>;
}

export function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(slice);
  }

  throw new Error(`Unable to extract valid JSON from LLM response: ${trimmed.slice(0, 200)}`);
}

export class DualChannelStructuredLlmClient implements LlmClient {
  constructor(
    private readonly llmConfig: DragonFlowConfig['llm'],
    private readonly registry?: AgentRegistry,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async completeJson<T>(
    req: StructuredCompletionRequest<T>,
  ): Promise<StructuredCompletionResponse<T>> {
    const apiKey = this.env[this.llmConfig.apiKeyEnv];

    if (this.llmConfig.mode !== 'cli_only' && apiKey) {
      try {
        return await this.callHttpApi(req, apiKey);
      } catch (err) {
        if (this.llmConfig.mode === 'api') {
          throw err;
        }
        req.onLog?.(
          'system',
          `[LLM] HTTP API failed (${err instanceof Error ? err.message : String(err)}), falling back to headless CLI...`,
        );
      }
    }

    if (this.llmConfig.mode === 'api' && !apiKey) {
      throw new Error(
        `LLM mode is "api" but environment variable ${this.llmConfig.apiKeyEnv} is not set`,
      );
    }

    return await this.callCliFallback(req);
  }

  private async callHttpApi<T>(
    req: StructuredCompletionRequest<T>,
    apiKey: string,
  ): Promise<StructuredCompletionResponse<T>> {
    const attemptCompletion = async (repairHint?: string) => {
      const userMessage = repairHint
        ? `${req.userPrompt}\n\nPrevious output failed JSON schema validation: ${repairHint}\nReturn ONLY valid JSON matching the requested schema.`
        : req.userPrompt;

      if (this.llmConfig.provider === 'anthropic') {
        const baseUrl = this.llmConfig.baseUrl.replace(/\/$/, '');
        const url = baseUrl.includes('anthropic') ? `${baseUrl}/v1/messages` : 'https://api.anthropic.com/v1/messages';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.llmConfig.model,
            max_tokens: this.llmConfig.maxTokens,
            temperature: this.llmConfig.temperature,
            system: `${req.systemPrompt}\nRespond ONLY with valid JSON.`,
            messages: [{ role: 'user', content: userMessage }],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
        }
        const json = (await res.json()) as {
          content?: Array<{ text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = json.content?.map((c) => c.text ?? '').join('\n') ?? '';
        const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
        return { text, tokens };
      }

      if (this.llmConfig.provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.llmConfig.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            generationConfig: {
              temperature: this.llmConfig.temperature,
              maxOutputTokens: this.llmConfig.maxTokens,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
        }
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { totalTokenCount?: number };
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const tokens = json.usageMetadata?.totalTokenCount ?? 0;
        return { text, tokens };
      }

      // OpenAI-compatible default
      const baseUrl = this.llmConfig.baseUrl.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.llmConfig.model,
          temperature: this.llmConfig.temperature,
          max_tokens: this.llmConfig.maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${req.systemPrompt}\nReturn ONLY valid JSON.` },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`OpenAI-compatible API error ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? '';
      const tokens = json.usage?.total_tokens ?? 0;
      return { text, tokens };
    };

    const first = await attemptCompletion();
    try {
      const parsed = req.schema.parse(extractJsonFromText(first.text));
      return {
        data: parsed,
        provider: this.llmConfig.provider,
        model: this.llmConfig.model,
        tokens: first.tokens,
        costUsd: Number((first.tokens * 0.000002).toFixed(6)),
      };
    } catch (err) {
      const second = await attemptCompletion(err instanceof Error ? err.message : String(err));
      const parsed = req.schema.parse(extractJsonFromText(second.text));
      const totalTokens = first.tokens + second.tokens;
      return {
        data: parsed,
        provider: this.llmConfig.provider,
        model: this.llmConfig.model,
        tokens: totalTokens,
        costUsd: Number((totalTokens * 0.000002).toFixed(6)),
      };
    }
  }

  private async callCliFallback<T>(
    req: StructuredCompletionRequest<T>,
  ): Promise<StructuredCompletionResponse<T>> {
    if (!this.registry) {
      throw new Error('No AgentRegistry configured for CLI headless LLM fallback');
    }

    const preferredId = this.llmConfig.cliFallbackAgentId;
    const available = this.registry.getAvailableAgents();
    const chosenId =
      (preferredId && this.registry.isAvailable(preferredId) ? preferredId : undefined) ??
      available[0]?.id;

    if (!chosenId) {
      throw new Error(
        `No API key (${this.llmConfig.apiKeyEnv}) and no available Coding Agent CLI for headless fallback`,
      );
    }

    const adapter = this.registry.getAdapter(chosenId)!;
    req.onLog?.('system', `[LLM:CLI-Fallback] Using "${chosenId}" for stage "${req.stage}"`);

    const prompt = `${req.systemPrompt}\n\nIMPORTANT: Respond with ONLY a valid JSON object (no markdown commentary outside the JSON).\n\n${req.userPrompt}`;
    const res = await adapter.execute({
      taskId: 'llm-fallback',
      runId: 'llm-fallback',
      stage: req.stage,
      cwd: req.cwd ?? process.cwd(),
      prompt,
      readOnly: true,
      onLog: req.onLog,
    });

    if (!res.success) {
      throw new Error(`CLI fallback "${chosenId}" failed (${res.errorKind}): ${res.rawStderr}`);
    }

    const parsed = req.schema.parse(extractJsonFromText(res.outputText));
    return {
      data: parsed,
      provider: `cli:${chosenId}`,
      model: adapter.profile.model ?? adapter.profile.type,
      tokens: res.tokensUsed,
      costUsd: res.costUsd,
    };
  }
}

export type MockLlmResponder = (stage: string, userPrompt: string) => unknown;

export class MockStructuredLlmClient implements LlmClient {
  constructor(private readonly responder?: MockLlmResponder) {}

  async completeJson<T>(
    req: StructuredCompletionRequest<T>,
  ): Promise<StructuredCompletionResponse<T>> {
    const raw = this.responder
      ? this.responder(req.stage, req.userPrompt)
      : defaultMockResponse(req.stage, req.userPrompt);
    const data = req.schema.parse(raw);
    return {
      data,
      provider: 'mock',
      model: 'dragonflow-mock-llm',
      tokens: 320,
      costUsd: 0.0005,
    };
  }
}

function defaultMockResponse(stage: string, userPrompt: string): unknown {
  const lower = userPrompt.toLowerCase();

  if (stage === 'triage') {
    const isDocs = lower.includes('doc') || lower.includes('readme') || lower.includes('typo');
    const isFeature =
      lower.includes('feature') ||
      lower.includes('oauth') ||
      lower.includes('architecture') ||
      lower.includes('plugin') ||
      lower.includes('新功能') ||
      lower.includes('支持');
    const needsInfo = lower.includes('unclear') || lower.includes('no repro') || lower.length < 35;

    const complexity = isDocs ? 1 : isFeature ? 4 : 2;
    return {
      category: isDocs ? 'docs' : isFeature ? 'feature' : 'bug',
      isDuplicate: false,
      needsMoreInfo: needsInfo,
      clarifyingQuestions: needsInfo
        ? ['请补充复现步骤或预期行为', '请注明运行环境与版本号']
        : [],
      suggestedLabels: [isDocs ? 'documentation' : isFeature ? 'enhancement' : 'bug'],
      estimatedComplexity: complexity,
      recommendedTier: complexity <= 2 ? 'quick_fix' : 'full_sdlc',
      summary: isFeature
        ? '需要跨模块设计与多文件联动实现的功能需求。'
        : isDocs
          ? '文档或说明性小范围修正。'
          : '定位明确的代码缺陷修复任务。',
      riskFlags: [],
    };
  }

  if (stage === 'routing') {
    const isFeature = lower.includes('"category": "feature"') || lower.includes('complexity": 4');
    return {
      primaryAgent: isFeature ? 'claude' : 'qodercli',
      rationale: isFeature
        ? '复杂架构/多模块新功能，优先调度长程规划与重构能力强的 Agent。'
        : '中低复杂度定位修复，优先调度高性价比快速修复 Agent。',
      recommendedTier: isFeature ? 'full_sdlc' : 'quick_fix',
    };
  }

  if (stage === 'spec') {
    return {
      problemStatement: '根据 Issue 描述明确目标边界，修复缺陷/实现需求并补充自动化测试覆盖。',
      acceptanceCriteria: [
        '满足 Issue 中提出的核心功能与边界条件',
        '所有既有测试与新增单元测试全部通过',
        '不引入破坏性变更或未授权的敏感文件改动',
      ],
      nonGoals: ['不重构无关模块', '不更改公共配置兼容性'],
      affectedAreas: ['src/', 'tests/'],
    };
  }

  if (stage === 'plan') {
    return {
      architectureSummary: '采用模块化增量改造方案：保持现有接口向后兼容，新增核心逻辑并配合完整单测验证。',
      filesToModify: ['src/index.ts', 'tests/feature.test.ts'],
      implementationSteps: [
        '1. 梳理受影响调用链并抽取清晰的接口边界',
        '2. 编写核心业务逻辑与边界错误处理',
        '3. 补充单元测试与回归验证脚本',
      ],
      testPlan: ['运行单元与集成测试套件', '校验构建产物与类型检查零报错'],
      risksAndMitigations: ['注意异常输入与并发边界，已纳入单测覆盖'],
    };
  }

  if (stage === 'cross_review') {
    return {
      approved: true,
      summary: '代码改动聚焦、逻辑清晰、测试充分且无明显安全隐患，同意进入 PR 阶段。',
      findings: [],
      checklist: {
        acceptanceCriteriaMet: true,
        testsAdequate: true,
        noObviousSecurityRisks: true,
        cleanScope: true,
      },
    };
  }

  return {};
}
