/**
 * Response transformation utilities
 * Handles conversion between different API response formats
 */

/**
 * Anthropic API response content block types
 */
interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicMessageResponse {
  id?: string;
  type?: string;
  role?: string;
  content: ContentBlock[] | string;
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  [key: string]: unknown;
}

/**
 * Transform z.ai thinking blocks to Anthropic-compatible format
 * Handles invalid signature fields and format differences
 */
export function transformThinkingBlocks(response: string): string {
  try {
    const parsed = JSON.parse(response) as AnthropicMessageResponse;

    // Handle responses with content array
    if (Array.isArray(parsed.content)) {
      let transformed = false;
      const newContent: ContentBlock[] = [];

      for (const block of parsed.content) {
        if (block.type === "thinking") {
          // Transform thinking block to Anthropic-compatible format
          const newBlock: ContentBlock = { type: "thinking" };

          // Copy safe fields
          if (typeof block.thinking === "string") {
            newBlock.content = block.thinking;
          } else if (typeof block.content === "string") {
            newBlock.content = block.content;
          }

          // Only include valid Anthropic fields
          // Anthropic expects: { type: "thinking", content: "..." }
          // Remove z.ai specific fields like invalid signature
          newContent.push(newBlock);
          transformed = true;
        } else {
          // Keep non-thinking blocks as-is
          newContent.push(block);
        }
      }

      if (transformed) {
        parsed.content = newContent;
        return JSON.stringify(parsed);
      }
    }

    // Handle responses with content as text (unlikely for messages API)
    if (typeof parsed.content === "string") {
      // Remove thinking tags if present in text content
      let content = parsed.content;
      // Remove <thinking>...</thinking> tags with any attributes and surrounding whitespace
      content = content.replace(/\s*<thinking[^>]*>[\s\S]*?<\/thinking>\s*/gi, "");
      content = content.replace(/\s*<thinking[^>]*>[\s\S]*?$/gi, ""); // unclosed tag
      // Trim leading/trailing whitespace after removal
      content = content.trim();
      if (content !== parsed.content) {
        parsed.content = content;
        return JSON.stringify(parsed);
      }
    }

    return response;
  } catch {
    // Not JSON or parse error, return as-is
    return response;
  }
}

/**
 * Check if a response should be transformed
 * Only transform responses from z.ai upstream
 */
export function shouldTransformResponse(
  contentType: string | undefined,
  upstream: string
): boolean {
  if (upstream !== "zai") return false;
  if (!contentType) return false;
  return contentType.includes("application/json");
}
