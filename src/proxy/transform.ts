/**
 * Response transformation utilities
 * Handles conversion between different API response formats
 */

import type { ContentBlock, MessageRequestBody, Message } from "./types.js";
import type { SignatureStore } from "./signature-store.js";

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
        if (block.type === "thinking" && typeof block.signature === "string" && block.signature) {
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

    let messages = sanitized ? newMessages : parsed.messages;

    // Structural validation (order matters):
    // 1. sanitizeMessageStructure: remove leading non-user, merge consecutive same-role, remove empty
    // 2. removeOrphanedToolResults: convert orphaned tool_results to text
    // sanitizeMessageStructure runs first because removing leading assistant messages
    // can create new orphaned tool_results in the following user messages.
    const structureSanitized = sanitizeMessageStructure(messages);
    if (structureSanitized !== messages) {
      messages = structureSanitized;
    }

    const validatedMessages = removeOrphanedToolResults(messages);
    if (validatedMessages !== messages) {
      messages = validatedMessages;
    }

    if (messages !== parsed.messages) {
      parsed.messages = messages;
      return JSON.stringify(parsed);
    }

    if (sanitized) {
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
 *
 * Detection logic (order matters):
 * 1. Signature in store → keep as-is (confirmed Anthropic origin)
 * 2. Has "thinking" sub-field → convert to text (z.ai specific structure)
 * 3. Has non-empty signature string → keep as-is (likely Anthropic; fallback after proxy restart)
 * 4. Otherwise → convert to text (z.ai origin, signature stripped by transformThinkingBlocks)
 */
function sanitizeContentBlockWithStore(
  block: ContentBlock,
  store: SignatureStore
): ContentBlock {
  // Handle thinking blocks - check signature
  if (block.type === "thinking") {
    const signature = block.signature;

    // 1. Signature recorded in store → confirmed Anthropic origin
    if (typeof signature === "string" && signature && store.has(signature)) {
      return block;
    }

    // 2. Has "thinking" sub-field → z.ai specific structure
    if (block.thinking !== undefined) {
      return convertThinkingToText(block);
    }

    // 3. Has non-empty signature string → likely Anthropic origin
    //    After proxy restart, store is empty but Anthropic blocks retain signatures.
    //    z.ai blocks have signatures stripped by transformThinkingBlocks, so presence
    //    of a signature field indicates Anthropic origin.
    if (typeof signature === "string" && signature) {
      return block;
    }

    // 4. No signature, no thinking sub-field → z.ai origin
    return convertThinkingToText(block);
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
 * Sanitize message structure to ensure valid Anthropic API format.
 * Handles issues that arise from context compression:
 * - Leading non-user messages (must start with user)
 * - Consecutive same-role messages (must alternate user/assistant)
 * - Empty content messages (must have non-empty content)
 *
 * Runs in a loop until stable since each step can introduce new issues.
 */
export function sanitizeMessageStructure(messages: Message[]): Message[] {
  let current = messages;
  let changed = false;

  // Loop until no more changes (each step can create new issues)
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    let stepChanged = false;

    // Step 1: Remove leading non-user messages
    let startIdx = 0;
    while (startIdx < current.length && current[startIdx].role !== "user") {
      startIdx++;
    }
    if (startIdx > 0) {
      current = current.slice(startIdx);
      stepChanged = true;
      changed = true;
    }

    // Step 2: Merge consecutive same-role messages
    const merged: Message[] = [];
    for (let i = 0; i < current.length; i++) {
      if (merged.length > 0 && merged[merged.length - 1].role === current[i].role) {
        // Merge into the last message
        const prev = merged[merged.length - 1];
        merged[merged.length - 1] = mergeMessages(prev, current[i]);
        stepChanged = true;
        changed = true;
      } else {
        merged.push(current[i]);
      }
    }
    current = merged;

    // Step 3: Remove empty content messages
    const nonEmpty = current.filter((msg) => {
      if (typeof msg.content === "string") {
        return msg.content.length > 0;
      }
      if (Array.isArray(msg.content)) {
        return msg.content.length > 0;
      }
      return true;
    });
    if (nonEmpty.length !== current.length) {
      current = nonEmpty;
      stepChanged = true;
      changed = true;
    }

    // If no changes in this iteration, structure is stable
    if (!stepChanged) {
      break;
    }
  }

  return changed ? current : messages;
}

/**
 * Merge two messages with the same role into one.
 * - Both string content: join with \n\n
 * - Both array content: concat
 * - Mixed: convert string to text block and concat
 */
function mergeMessages(a: Message, b: Message): Message {
  const contentA = a.content;
  const contentB = b.content;

  if (typeof contentA === "string" && typeof contentB === "string") {
    return { ...a, content: contentA + "\n\n" + contentB };
  }

  const blocksA = toContentBlocks(contentA);
  const blocksB = toContentBlocks(contentB);

  return { ...a, content: [...blocksA, ...blocksB] };
}

/**
 * Convert content to ContentBlock array.
 * Strings become a single text block.
 */
function toContentBlocks(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

/**
 * Remove orphaned tool_result blocks from messages.
 * An orphaned tool_result is one whose tool_use_id does not have a corresponding
 * tool_use block in the immediately preceding assistant message.
 * This can happen when context compression removes assistant messages containing
 * tool_use blocks while leaving the user messages with tool_result blocks intact.
 *
 * Orphaned tool_result blocks are converted to text blocks to preserve context
 * while avoiding Anthropic API validation errors.
 */
export function removeOrphanedToolResults(messages: Message[]): Message[] {
  let wasModified = false;
  const newMessages = messages.map((msg, i) => {
    if (msg.role !== "user") return msg;
    if (!Array.isArray(msg.content)) return msg;

    // Check if any content block is a tool_result
    const hasToolResult = msg.content.some((block) => block.type === "tool_result");
    if (!hasToolResult) return msg;

    // Collect tool_use IDs from the previous message
    const prev = i > 0 ? messages[i - 1] : null;
    const prevToolUseIds = new Set<string>();
    if (prev && prev.role === "assistant" && Array.isArray(prev.content)) {
      for (const block of prev.content) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          prevToolUseIds.add(block.id);
        }
      }
    }

    let messageModified = false;
    const newContent = msg.content.map((block) => {
      if (block.type !== "tool_result") return block;

      const toolUseId = block.tool_use_id as string | undefined;

      // Check if previous message is an assistant with matching tool_use
      const isOrphaned =
        !prev ||
        prev.role !== "assistant" ||
        !toolUseId ||
        !prevToolUseIds.has(toolUseId);

      if (isOrphaned) {
        messageModified = true;
        return convertToolResultToText(block);
      }

      return block;
    });

    if (messageModified) {
      wasModified = true;
      return { ...msg, content: newContent };
    }

    return msg;
  });

  return wasModified ? newMessages : messages;
}

/**
 * Convert a tool_result block to a text block
 */
function convertToolResultToText(block: ContentBlock): ContentBlock {
  let text = "[previous tool result]";

  // Extract content from tool_result if available
  const content = block.content;
  if (typeof content === "string" && content) {
    text += "\n" + content;
  } else if (Array.isArray(content)) {
    // Extract text from nested content blocks
    const parts: string[] = [];
    for (const nested of content) {
      if (nested.type === "text" && typeof nested.text === "string") {
        parts.push(nested.text);
      }
    }
    if (parts.length > 0) {
      text += "\n" + parts.join("\n");
    }
  }

  return { type: "text", text };
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
