/**
 * Response transformation utilities
 * Handles conversion between different API response formats
 */

import type { ContentBlock, MessageRequestBody, Message } from "./types.js";
import type { SignatureStore } from "./signature-store.js";

/**
 * Fields to remove from thinking blocks when sending to Anthropic
 */
const ZAI_THINKING_FIELDS = new Set(["signature"]);

/**
 * Sanitize request body content blocks for Anthropic API
 * Removes z.ai specific fields from thinking blocks in message history
 */
export function sanitizeContentBlocks(requestBody: string): string {
  try {
    const parsed = JSON.parse(requestBody) as MessageRequestBody;

    // Check if we have messages array to process
    if (!parsed.messages || !Array.isArray(parsed.messages)) {
      return requestBody;
    }

    let sanitized = false;

    // Process each message
    const newMessages = parsed.messages.map((msg) => {
      const result = sanitizeMessage(msg);
      if (result !== msg) {
        sanitized = true;
      }
      return result;
    });

    if (sanitized) {
      parsed.messages = newMessages;
      return JSON.stringify(parsed);
    }

    return requestBody;
  } catch {
    // Not JSON or parse error, return as-is
    return requestBody;
  }
}

/**
 * Sanitize a single message by processing its content blocks
 */
function sanitizeMessage(message: Message): Message {
  // If content is a string, no processing needed
  if (typeof message.content === "string") {
    return message;
  }

  // If content is not an array, return as-is
  if (!Array.isArray(message.content)) {
    return message;
  }

  // Create a shallow copy to detect changes
  let wasModified = false;
  const newContent: ContentBlock[] = [];

  for (const block of message.content) {
    const sanitized = sanitizeContentBlock(block);
    if (sanitized !== block) {
      wasModified = true;
    }
    newContent.push(sanitized);
  }

  if (wasModified) {
    return { ...message, content: newContent };
  }

  return message;
}

/**
 * Sanitize a single content block
 */
function sanitizeContentBlock(block: ContentBlock): ContentBlock {
  // Handle thinking blocks - remove z.ai specific fields
  if (block.type === "thinking") {
    return sanitizeThinkingBlock(block);
  }

  // Handle tool_result blocks which may contain nested content
  if (block.type === "tool_result") {
    const content = block.content;
    if (Array.isArray(content)) {
      let wasModified = false;
      const newContent: ContentBlock[] = [];

      for (const nestedBlock of content) {
        const sanitized = sanitizeContentBlock(nestedBlock);
        if (sanitized !== nestedBlock) {
          wasModified = true;
        }
        newContent.push(sanitized);
      }

      if (wasModified) {
        return { ...block, content: newContent };
      }
    }
  }

  return block;
}

/**
 * Sanitize a thinking block by removing z.ai specific fields
 * Handles thinking field as string or object, converting to content field
 * Anthropic API expects: { type: "thinking", content: "..." }
 *
 * Handles nested structures like:
 * - { type: "thinking", thinking: "..." }
 * - { type: "thinking", thinking: { text: "...", signature: "..." } }
 * - { type: "thinking", thinking: { thinking: "...", signature: "..." } }
 * - { type: "thinking", content: "...", thinking: { thinking: "...", signature: "..." } }
 */
function sanitizeThinkingBlock(block: ContentBlock): ContentBlock {
  const newBlock: ContentBlock = { type: "thinking" };

  // Step 1: Extract content from thinking field first (before copying other fields)
  let contentFromThinking: string | null = null;

  if (typeof block.thinking === "string") {
    contentFromThinking = block.thinking;
  } else if (typeof block.thinking === "object" && block.thinking !== null) {
    const thinkingObj = block.thinking as Record<string, unknown>;
    // Try multiple possible properties in order of preference
    if (typeof thinkingObj.content === "string") {
      contentFromThinking = thinkingObj.content;
    } else if (typeof thinkingObj.thinking === "string") {
      contentFromThinking = thinkingObj.thinking;
    } else if (typeof thinkingObj.text === "string") {
      contentFromThinking = thinkingObj.text;
    } else {
      contentFromThinking = JSON.stringify(thinkingObj);
    }
  }

  // Step 2: Copy only safe fields (whitelist approach)
  // Only copy fields that are safe for Anthropic API
  const SAFE_THINKING_FIELDS = ["content", "cache_control"];
  for (const [key, value] of Object.entries(block)) {
    if (SAFE_THINKING_FIELDS.includes(key)) {
      newBlock[key] = value;
    }
  }

  // Step 3: Always use content from thinking field if available (overwrites existing content)
  // This ensures we always use the latest thinking content, not cached old content
  if (contentFromThinking !== null) {
    newBlock.content = contentFromThinking;
  }

  // Step 4: Ensure content field exists (required by Anthropic API)
  if (!newBlock.content) {
    newBlock.content = "";
  }

  // Step 5: Remove invalid fields (ensure thinking and signature are always removed)
  delete newBlock.signature;
  delete newBlock.thinking;

  return newBlock;
}

/**
 * Check if a request should be transformed
 * Only transform requests to Anthropic upstream
 */
export function shouldTransformRequest(
  contentType: string | undefined,
  upstream: string
): boolean {
  if (upstream !== "anthropic") return false;
  if (!contentType) return false;
  return contentType.includes("application/json");
}

/**
 * Extract and record signatures from Anthropic response
 * Processes thinking blocks in the response and stores their signatures
 * for later identification of Anthropic-generated content
 *
 * @param responseBody - The response body string from Anthropic
 * @param store - The SignatureStore to record signatures in
 * @returns The original response body (unchanged)
 */
export function extractAndRecordSignatures(
  responseBody: string,
  store: SignatureStore
): string {
  try {
    const parsed = JSON.parse(responseBody) as AnthropicMessageResponse;

    // Handle responses with content array
    if (Array.isArray(parsed.content)) {
      for (const block of parsed.content) {
        if (block.type === "thinking" && block.signature) {
          // Record the signature from Anthropic's thinking block
          store.add(block.signature);
        }
      }
    }

    return responseBody;
  } catch {
    // Not JSON or parse error, return as-is
    return responseBody;
  }
}

/**
 * Sanitize request body content blocks for Anthropic API with signature checking
 * Converts thinking blocks with unrecorded signatures (z.ai origin) to text blocks
 * Preserves thinking blocks with recorded signatures (Anthropic origin)
 *
 * @param requestBody - The request body string
 * @param store - The SignatureStore to check signatures against
 * @returns The sanitized request body string
 */
export function sanitizeContentBlocksWithStore(
  requestBody: string,
  store: SignatureStore
): string {
  try {
    const parsed = JSON.parse(requestBody) as MessageRequestBody;

    // Check if we have messages array to process
    if (!parsed.messages || !Array.isArray(parsed.messages)) {
      return requestBody;
    }

    let sanitized = false;

    // Process each message
    const newMessages = parsed.messages.map((msg) => {
      const result = sanitizeMessageWithStore(msg, store);
      if (result !== msg) {
        sanitized = true;
      }
      return result;
    });

    if (sanitized) {
      parsed.messages = newMessages;
      return JSON.stringify(parsed);
    }

    return requestBody;
  } catch {
    // Not JSON or parse error, return as-is
    return requestBody;
  }
}

/**
 * Sanitize a single message with signature checking
 * Converts unrecorded thinking blocks to text blocks
 */
function sanitizeMessageWithStore(message: Message, store: SignatureStore): Message {
  // If content is a string, no processing needed
  if (typeof message.content === "string") {
    return message;
  }

  // If content is not an array, return as-is
  if (!Array.isArray(message.content)) {
    return message;
  }

  // Create a shallow copy to detect changes
  let wasModified = false;
  const newContent: ContentBlock[] = [];

  for (const block of message.content) {
    const sanitized = sanitizeContentBlockWithStore(block, store);
    if (sanitized !== block) {
      wasModified = true;
    }
    newContent.push(sanitized);
  }

  if (wasModified) {
    return { ...message, content: newContent };
  }

  return message;
}

/**
 * Sanitize a single content block with signature checking
 * Converts thinking blocks with unrecorded signatures to text blocks
 */
function sanitizeContentBlockWithStore(
  block: ContentBlock,
  store: SignatureStore
): ContentBlock {
  // Handle thinking blocks - check signature
  if (block.type === "thinking") {
    const signature = block.signature;

    // Check if signature is recorded (Anthropic origin)
    if (signature && store.has(signature)) {
      // This is an Anthropic-generated thinking block, return as-is
      // Don't modify anything - Anthropic needs to verify the signature
      return block;
    } else {
      // This is a z.ai-origin thinking block, convert to text
      return convertThinkingToText(block);
    }
  }

  // Handle tool_result blocks which may contain nested content
  if (block.type === "tool_result") {
    const content = block.content;
    if (Array.isArray(content)) {
      let wasModified = false;
      const newContent: ContentBlock[] = [];

      for (const nestedBlock of content) {
        const sanitized = sanitizeContentBlockWithStore(nestedBlock, store);
        if (sanitized !== nestedBlock) {
          wasModified = true;
        }
        newContent.push(sanitized);
      }

      if (wasModified) {
        return { ...block, content: newContent };
      }
    }
  }

  return block;
}

/**
 * Convert a thinking block to a text block
 * Extracts the thinking content and wraps it in a text block with a prefix
 */
function convertThinkingToText(block: ContentBlock): ContentBlock {
  // Extract thinking content
  let thinkingText = "";

  if (typeof block.thinking === "string") {
    thinkingText = block.thinking;
  } else if (typeof block.content === "string") {
    thinkingText = block.content;
  } else if (typeof block.thinking === "object" && block.thinking !== null) {
    const thinkingObj = block.thinking as Record<string, unknown>;
    if (typeof thinkingObj.content === "string") {
      thinkingText = thinkingObj.content;
    } else if (typeof thinkingObj.thinking === "string") {
      thinkingText = thinkingObj.thinking;
    } else if (typeof thinkingObj.text === "string") {
      thinkingText = thinkingObj.text;
    } else {
      thinkingText = JSON.stringify(thinkingObj);
    }
  } else if (typeof block.content === "object" && block.content !== null) {
    const contentObj = block.content as Record<string, unknown>;
    if (typeof contentObj.text === "string") {
      thinkingText = contentObj.text;
    } else {
      thinkingText = JSON.stringify(contentObj);
    }
  }

  // Create text block with XML tag wrapper
  return {
    type: "text",
    text: `<previous-glm-reasoning>\n${thinkingText}\n</previous-glm-reasoning>`,
  };
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
 *
 * Handles various z.ai thinking block formats:
 * - { type: "thinking", thinking: "..." }
 * - { type: "thinking", thinking: { text: "...", signature: "..." } }
 * - { type: "thinking", thinking: { thinking: "...", signature: "..." } }
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

          // Copy safe fields - prioritize existing content field
          if (typeof block.content === "string") {
            newBlock.content = block.content;
          } else if (typeof block.thinking === "string") {
            newBlock.content = block.thinking;
          } else if (typeof block.thinking === "object" && block.thinking !== null) {
            // thinking is an object - extract from nested properties
            const thinkingObj = block.thinking as Record<string, unknown>;
            // Try multiple possible properties in order of preference
            if (typeof thinkingObj.content === "string") {
              newBlock.content = thinkingObj.content;
            } else if (typeof thinkingObj.thinking === "string") {
              // Handle nested thinking.thinking structure
              newBlock.content = thinkingObj.thinking;
            } else if (typeof thinkingObj.text === "string") {
              newBlock.content = thinkingObj.text;
            } else {
              // Stringify the object as fallback
              newBlock.content = JSON.stringify(thinkingObj);
            }
          } else {
            // No content found, use empty string
            newBlock.content = "";
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
