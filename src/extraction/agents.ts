import Anthropic from '@anthropic-ai/sdk';
import type { Trigger, LinkType } from '../types.js';

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export interface ExtractedDocument {
  action: 'create' | 'update';
  slug: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  links?: {
    targetSlug: string;
    linkType: LinkType;
    context?: string;
  }[];
}

export interface ExtractionResult {
  documents: ExtractedDocument[];
  reasoning: string;
}

export interface ExtractionInput {
  trigger: Trigger;
  content: string;
  metadata?: Record<string, unknown>;
  relevantDocuments?: {
    slug: string;
    title: string;
    content: string;
  }[];
}

const DEFAULT_SYSTEM_PROMPT = `You are a knowledge extraction agent for AI Wiki. Your task is to analyze incoming content and extract insights worth preserving in a knowledge base.

## Guidelines

1. **Be selective** - Not everything needs to be captured. Focus on:
   - Key insights, learnings, or decisions
   - Patterns, best practices, or anti-patterns
   - Important facts, definitions, or relationships
   - Actionable information that would be useful to retrieve later

2. **Structure appropriately** - Use clear titles and organize content logically

3. **Link wisely** - Connect to existing documents when relationships are meaningful

4. **Use appropriate slugs** - Lowercase, hyphenated, descriptive (e.g., "async-error-handling-patterns")

## Output Format

You must respond with valid JSON in this exact format:
{
  "documents": [
    {
      "action": "create" | "update",
      "slug": "document-slug",
      "title": "Document Title",
      "content": "Markdown content...",
      "metadata": {},
      "links": [
        {"targetSlug": "existing-doc", "linkType": "extends", "context": "why linked"}
      ]
    }
  ],
  "reasoning": "Brief explanation of extraction decisions"
}

Link types: reference, extends, contradicts, supersedes, related`;

const DEFAULT_EXTRACTION_TEMPLATE = `## Context
Source type: {{source_type}}

## Existing Related Documents
{{relevant_documents}}

## Input Content
{{content}}

## Your Task
Analyze the input and extract knowledge worth preserving. Think through:
1. What insights are valuable enough to save?
2. Should this create new documents or update existing ones?
3. What relationships exist with existing documents?

Respond with JSON only.`;

export async function runExtractionAgent(input: ExtractionInput): Promise<ExtractionResult> {
  const { trigger, content, metadata, relevantDocuments } = input;

  const anthropic = getAnthropic();

  // Build system prompt
  const systemPrompt = trigger.agentSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Build extraction template
  let template = trigger.agentExtractionTemplate || DEFAULT_EXTRACTION_TEMPLATE;

  // Replace template variables
  template = template
    .replace('{{source_type}}', trigger.triggerType)
    .replace('{{content}}', content)
    .replace(
      '{{relevant_documents}}',
      relevantDocuments && relevantDocuments.length > 0
        ? relevantDocuments
            .map((d) => `- **${d.title}** (${d.slug}): ${d.content}`)
            .join('\n')
        : 'No related documents found.'
    );

  if (metadata) {
    template = template.replace('{{metadata}}', JSON.stringify(metadata, null, 2));
  }

  // Call Claude with extended thinking for better reasoning
  const response = await anthropic.messages.create({
    model: trigger.agentModel || 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    thinking: {
      type: 'enabled',
      budget_tokens: 10000,
    },
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: template,
      },
    ],
  });

  // Extract the text response
  let textContent = '';
  let thinkingContent = '';

  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'thinking') {
      thinkingContent += block.thinking;
    }
  }

  // Parse JSON response
  try {
    // Try to extract JSON from the response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      documents?: ExtractedDocument[];
      reasoning?: string;
    };

    return {
      documents: parsed.documents || [],
      reasoning: parsed.reasoning || thinkingContent || 'No reasoning provided',
    };
  } catch (parseError) {
    // If parsing fails, return empty result with error reasoning
    return {
      documents: [],
      reasoning: `Failed to parse extraction result: ${parseError instanceof Error ? parseError.message : String(parseError)}. Raw response: ${textContent.substring(0, 500)}`,
    };
  }
}

// Simpler extraction for when extended thinking isn't needed
export async function runSimpleExtraction(
  content: string,
  prompt: string
): Promise<string> {
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\nContent:\n${content}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}
