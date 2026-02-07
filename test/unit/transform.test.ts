/**
 * Unit tests for response transformation
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformThinkingBlocks, shouldTransformResponse, sanitizeContentBlocks, shouldTransformRequest, extractAndRecordSignatures, sanitizeContentBlocksWithStore } from "../../src/proxy/transform.js";
import { SignatureStore } from "../../src/proxy/signature-store.js";

describe("transformThinkingBlocks", () => {
  describe("Anthropic-compatible thinking block", () => {
    it("preserves valid thinking blocks with content field", () => {
      const response = JSON.stringify({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", content: "Let me think..." },
          { type: "text", text: "Here is the answer." },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content[0]).toEqual({ type: "thinking", content: "Let me think..." });
    });

    it("transforms thinking block with thinking field to content field", () => {
      const response = JSON.stringify({
        id: "msg_123",
        content: [
          { type: "thinking", thinking: "Original thinking content", signature: "invalid-sig" },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content[0]).toEqual({
        type: "thinking",
        content: "Original thinking content",
      });
      expect(parsed.content[0].signature).toBeUndefined();
    });
  });

  describe("z.ai specific format cleanup", () => {
    it("removes signature from thinking blocks", () => {
      const response = JSON.stringify({
        content: [
          {
            type: "thinking",
            thinking: "思考内容",
            signature: "some-zai-signature",
          },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content[0].type).toBe("thinking");
      expect(parsed.content[0].content).toBe("思考内容");
      expect(parsed.content[0].signature).toBeUndefined();
      expect(parsed.content[0].thinking).toBeUndefined();
    });

    it("handles thinking field as object with text property", () => {
      const response = JSON.stringify({
        content: [
          {
            type: "thinking",
            thinking: {
              text: "思考内容",
              signature: "some-zai-signature",
            },
          },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content[0].type).toBe("thinking");
      expect(parsed.content[0].content).toBe("思考内容");
      expect(parsed.content[0].signature).toBeUndefined();
      expect(parsed.content[0].thinking).toBeUndefined();
    });

    it("handles thinking field as object with content property", () => {
      const response = JSON.stringify({
        content: [
          {
            type: "thinking",
            thinking: {
              content: "ネストされたコンテンツ",
              signature: "some-zai-signature",
            },
          },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content[0].type).toBe("thinking");
      expect(parsed.content[0].content).toBe("ネストされたコンテンツ");
      expect(parsed.content[0].signature).toBeUndefined();
      expect(parsed.content[0].thinking).toBeUndefined();
    });

    it("handles thinking field as object with nested thinking property", () => {
      const response = JSON.stringify({
        content: [
          {
            type: "thinking",
            thinking: {
              thinking: "ネストされたthinking内容",
              signature: "some-zai-signature",
            },
          },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content[0].type).toBe("thinking");
      expect(parsed.content[0].content).toBe("ネストされたthinking内容");
      expect(parsed.content[0].signature).toBeUndefined();
      expect(parsed.content[0].thinking).toBeUndefined();
    });

    it("preserves non-thinking blocks", () => {
      const response = JSON.stringify({
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "tool_1", name: "search" },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content).toHaveLength(2);
      expect(parsed.content[0]).toEqual({ type: "text", text: "Hello" });
      expect(parsed.content[1]).toEqual({ type: "tool_use", id: "tool_1", name: "search" });
    });

    it("handles mixed content with thinking and text", () => {
      const response = JSON.stringify({
        content: [
          { type: "thinking", thinking: "Thinking...", signature: "sig" },
          { type: "text", text: "Answer" },
        ],
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content[0]).toEqual({ type: "thinking", content: "Thinking..." });
      expect(parsed.content[1]).toEqual({ type: "text", text: "Answer" });
    });
  });

  describe("edge cases", () => {
    it("returns original response if not JSON", () => {
      const response = "not a json response";
      const result = transformThinkingBlocks(response);
      expect(result).toBe(response);
    });

    it("returns original response if JSON is invalid", () => {
      const response = "{invalid json}";
      const result = transformThinkingBlocks(response);
      expect(result).toBe(response);
    });

    it("handles response with string content", () => {
      const response = JSON.stringify({
        content: "This is plain text content",
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe("This is plain text content");
    });

    it("handles response with thinking tags in text content", () => {
      const response = JSON.stringify({
        content: "<thinking>Some thought</thinking>\n\nActual answer",
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe("Actual answer");
    });

    it("preserves non-thinking fields", () => {
      const response = JSON.stringify({
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = transformThinkingBlocks(response);
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe("msg_123");
      expect(parsed.type).toBe("message");
      expect(parsed.stop_reason).toBe("end_turn");
      expect(parsed.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    });
  });
});

describe("shouldTransformResponse", () => {
  it("returns true for z.ai with JSON content type", () => {
    expect(shouldTransformResponse("application/json", "zai")).toBe(true);
  });

  it("returns false for anthropic upstream", () => {
    expect(shouldTransformResponse("application/json", "anthropic")).toBe(false);
  });

  it("returns false for undefined content type", () => {
    expect(shouldTransformResponse(undefined, "zai")).toBe(false);
  });

  it("returns false for non-JSON content type", () => {
    expect(shouldTransformResponse("text/plain", "zai")).toBe(false);
  });

  it("returns true for JSON with charset", () => {
    expect(shouldTransformResponse("application/json; charset=utf-8", "zai")).toBe(true);
  });
});

describe("sanitizeContentBlocks", () => {
  describe("thinking block sanitization", () => {
    it("removes signature from thinking blocks", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "user",
            content: "Hello",
          },
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Let me think about this...",
                signature: "invalid-zai-signature",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[1].content[0].type).toBe("thinking");
      expect(parsed.messages[1].content[0].content).toBe("Let me think about this...");
      expect(parsed.messages[1].content[0].signature).toBeUndefined();
      expect(parsed.messages[1].content[0].thinking).toBeUndefined();
    });

    it("converts thinking field to content field when thinking is a string", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Original thinking content",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "Original thinking content",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
    });

    it("extracts text property when thinking field is an object", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: {
                  text: "This is the thinking content",
                  signature: "zai-sig",
                },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "This is the thinking content",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
      expect(parsed.messages[0].content[0].signature).toBeUndefined();
    });

    it("extracts content property when thinking field is an object with content", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: {
                  content: "Content from nested object",
                  signature: "zai-sig",
                },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "Content from nested object",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
      expect(parsed.messages[0].content[0].signature).toBeUndefined();
    });

    it("stringifies thinking field when object has no text or content property", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: {
                  data: "some data",
                  value: 42,
                },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0].type).toBe("thinking");
      expect(parsed.messages[0].content[0].content).toBe('{"data":"some data","value":42}');
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
    });

    it("preserves existing content field when thinking field is also present", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "Existing content",
                thinking: "Ignored thinking",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      // New behavior: thinking field content always takes precedence over existing content
      // This ensures we always use the latest thinking content, not cached old content
      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "Ignored thinking",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
    });

    it("removes thinking property when both content and thinking are present (extended thinking block format)", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "some content",
                thinking: { thinking: "...", signature: "..." },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      // thinking プロパティが確実に削除されていることを確認
      // New behavior: thinking field content always takes precedence
      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "...",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
      expect(parsed.messages[0].content[0].signature).toBeUndefined();
    });

    it("removes extended thinking block format with thinking.thinking and signature", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: { thinking: "extended thinking content", signature: "valid-signature" },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      // thinking.thinking が content に変換され、signature と thinking プロパティが削除される
      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "extended thinking content",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
      expect(parsed.messages[0].content[0].signature).toBeUndefined();
    });

    it("extracts nested thinking.thinking property", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: {
                  thinking: "Nested thinking content",
                  signature: "some-zai-signature",
                },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "Nested thinking content",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
      expect(parsed.messages[0].content[0].signature).toBeUndefined();
    });

    it("preserves thinking blocks that already have content field", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "Already valid content",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "Already valid content",
      });
    });

    it("ensures thinking property is removed even when content exists (extended format)", () => {
      // This is the critical case: cached conversation with extended thinking block format
      // Client has cached: { type: "thinking", content: "...", thinking: { thinking: "...", signature: "..." } }
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "cached content",
                thinking: {
                  thinking: "extended thinking content",
                  signature: "cached-signature",
                },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      // New behavior: thinking field content always takes precedence over cached content
      // This ensures we always use the latest thinking content, not cached old content
      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "extended thinking content",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
      expect(parsed.messages[0].content[0].signature).toBeUndefined();
    });

    it("handles extended thinking block format without content field", () => {
      // Extended format: { type: "thinking", thinking: { thinking: "...", signature: "..." } }
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: {
                  thinking: "deep thinking content",
                  signature: "valid-signature-123",
                },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      // Should extract thinking.thinking to content field
      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        content: "deep thinking content",
      });
      expect(parsed.messages[0].content[0].thinking).toBeUndefined();
      expect(parsed.messages[0].content[0].signature).toBeUndefined();
    });
  });

  describe("non-thinking blocks", () => {
    it("preserves text blocks", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "Hello" },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0]).toEqual({ type: "text", text: "Hello" });
    });

    it("preserves tool_use blocks", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "tool_1", name: "search", input: { query: "test" } },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0]).toEqual({
        type: "tool_use",
        id: "tool_1",
        name: "search",
        input: { query: "test" },
      });
    });

    it("preserves string content", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "user",
            content: "Simple text message",
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content).toBe("Simple text message");
    });
  });

  describe("nested content in tool_result", () => {
    it("sanitizes thinking blocks within tool_result", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool_1",
                content: [
                  {
                    type: "thinking",
                    thinking: "Nested thinking",
                    signature: "nested-sig",
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      const toolResult = parsed.messages[0].content[0];
      expect(toolResult.type).toBe("tool_result");
      expect(toolResult.content[0]).toEqual({
        type: "thinking",
        content: "Nested thinking",
      });
      expect(toolResult.content[0].signature).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("returns original value if not JSON", () => {
      const requestBody = "not a json request";
      const result = sanitizeContentBlocks(requestBody);
      expect(result).toBe(requestBody);
    });

    it("returns original value if JSON is invalid", () => {
      const requestBody = "{invalid json}";
      const result = sanitizeContentBlocks(requestBody);
      expect(result).toBe(requestBody);
    });

    it("returns original value if messages array is missing", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
      });

      const result = sanitizeContentBlocks(requestBody);
      expect(result).toBe(requestBody);
    });

    it("returns original value if messages is not an array", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: "not an array",
      });

      const result = sanitizeContentBlocks(requestBody);
      expect(result).toBe(requestBody);
    });

    it("preserves other request body fields", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        temperature: 0.7,
        system: "You are a helpful assistant",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Thinking content",
                signature: "sig",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.model).toBe("claude-sonnet-4-5-20250929");
      expect(parsed.max_tokens).toBe(4096);
      expect(parsed.temperature).toBe(0.7);
      expect(parsed.system).toBe("You are a helpful assistant");
    });
  });

  describe("mixed content scenarios", () => {
    it("handles message with both thinking and text blocks", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Step 1", signature: "sig1" },
              { type: "text", text: "Response" },
              { type: "thinking", thinking: "Step 2", signature: "sig2" },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content).toHaveLength(3);
      expect(parsed.messages[0].content[0]).toEqual({ type: "thinking", content: "Step 1" });
      expect(parsed.messages[0].content[1]).toEqual({ type: "text", text: "Response" });
      expect(parsed.messages[0].content[2]).toEqual({ type: "thinking", content: "Step 2" });
    });

    it("handles multiple messages with different content types", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          { role: "user", content: "Question" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Thinking", signature: "sig" },
              { type: "text", text: "Answer" },
            ],
          },
          { role: "user", content: "Follow up" },
        ],
      });

      const result = sanitizeContentBlocks(requestBody);
      const parsed = JSON.parse(result);

      expect(parsed.messages).toHaveLength(3);
      expect(parsed.messages[0].content).toBe("Question");
      expect(parsed.messages[1].content[0]).toEqual({ type: "thinking", content: "Thinking" });
      expect(parsed.messages[1].content[1]).toEqual({ type: "text", text: "Answer" });
      expect(parsed.messages[2].content).toBe("Follow up");
    });
  });
});

describe("shouldTransformRequest", () => {
  it("returns true for Anthropic with JSON content type", () => {
    expect(shouldTransformRequest("application/json", "anthropic")).toBe(true);
  });

  it("returns false for zai upstream", () => {
    expect(shouldTransformRequest("application/json", "zai")).toBe(false);
  });

  it("returns false for undefined content type", () => {
    expect(shouldTransformRequest(undefined, "anthropic")).toBe(false);
  });

  it("returns false for non-JSON content type", () => {
    expect(shouldTransformRequest("text/plain", "anthropic")).toBe(false);
  });

  it("returns true for JSON with charset", () => {
    expect(shouldTransformRequest("application/json; charset=utf-8", "anthropic")).toBe(true);
  });
});

describe("extractAndRecordSignatures", () => {
  let store: SignatureStore;

  beforeEach(() => {
    store = new SignatureStore(100);
  });

  describe("signature extraction", () => {
    it("extracts and records signatures from thinking blocks", () => {
      const response = JSON.stringify({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", content: "Let me think...", signature: "anthropic-sig-123" },
          { type: "text", text: "Here is the answer." },
        ],
      });

      const result = extractAndRecordSignatures(response, store);

      // Response should be unchanged
      expect(result).toBe(response);

      // Signature should be recorded
      expect(store.has("anthropic-sig-123")).toBe(true);
    });

    it("extracts multiple signatures from multiple thinking blocks", () => {
      const response = JSON.stringify({
        content: [
          { type: "thinking", content: "Thinking 1", signature: "sig-1" },
          { type: "text", text: "Text" },
          { type: "thinking", content: "Thinking 2", signature: "sig-2" },
        ],
      });

      extractAndRecordSignatures(response, store);

      expect(store.has("sig-1")).toBe(true);
      expect(store.has("sig-2")).toBe(true);
    });

    it("does not record signatures from thinking blocks without signature", () => {
      const response = JSON.stringify({
        content: [
          { type: "thinking", content: "No signature" },
        ],
      });

      extractAndRecordSignatures(response, store);

      expect(store.size).toBe(0);
    });

    it("handles responses with string content", () => {
      const response = JSON.stringify({
        content: "Plain text response",
      });

      const result = extractAndRecordSignatures(response, store);

      expect(result).toBe(response);
      expect(store.size).toBe(0);
    });

    it("handles non-JSON responses", () => {
      const response = "not a json response";

      const result = extractAndRecordSignatures(response, store);

      expect(result).toBe(response);
      expect(store.size).toBe(0);
    });

    it("handles invalid JSON", () => {
      const response = "{invalid json}";

      const result = extractAndRecordSignatures(response, store);

      expect(result).toBe(response);
      expect(store.size).toBe(0);
    });
  });
});

describe("sanitizeContentBlocksWithStore", () => {
  let store: SignatureStore;

  beforeEach(() => {
    store = new SignatureStore(100);
  });

  describe("z.ai-origin thinking blocks (unrecorded signatures)", () => {
    it("converts thinking blocks with unrecorded signatures to text blocks", () => {
      // Add an Anthropic signature to the store
      store.add("anthropic-sig-123");

      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "Thinking from z.ai",
                signature: "zai-sig-456", // Not in store
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      // Should be converted to text block
      expect(parsed.messages[0].content[0].type).toBe("text");
      expect(parsed.messages[0].content[0].text).toContain("<previous-glm-reasoning>");
      expect(parsed.messages[0].content[0].text).toContain("Thinking from z.ai");
    });

    it("converts thinking blocks without signature to text blocks", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Thinking without signature",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0].type).toBe("text");
      expect(parsed.messages[0].content[0].text).toContain("<previous-glm-reasoning>");
      expect(parsed.messages[0].content[0].text).toContain("Thinking without signature");
    });

    it("extracts thinking content from nested object", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: {
                  thinking: "Nested thinking content",
                  signature: "zai-sig",
                },
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content[0].type).toBe("text");
      expect(parsed.messages[0].content[0].text).toContain("Nested thinking content");
    });
  });

  describe("Anthropic-origin thinking blocks (recorded signatures)", () => {
    it("preserves thinking blocks with recorded signatures unchanged", () => {
      // Record the signature as Anthropic-origin
      store.add("anthropic-sig-123");

      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "Anthropic thinking",
                signature: "anthropic-sig-123",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      // Should remain as thinking block, completely unchanged
      expect(parsed.messages[0].content[0].type).toBe("thinking");
      expect(parsed.messages[0].content[0].content).toBe("Anthropic thinking");
      // Signature MUST be preserved for Anthropic to verify
      expect(parsed.messages[0].content[0].signature).toBe("anthropic-sig-123");
    });

    it("preserves thinking blocks with thinking field and recorded signature", () => {
      store.add("anthropic-sig");

      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "thinking content",
                signature: "anthropic-sig",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      // Should be completely unchanged (Anthropic needs to verify signature)
      expect(parsed.messages[0].content[0]).toEqual({
        type: "thinking",
        thinking: "thinking content",
        signature: "anthropic-sig",
      });
    });
  });

  describe("mixed content scenarios", () => {
    it("handles mix of Anthropic and z.ai thinking blocks", () => {
      // Record only the Anthropic signature
      store.add("anthropic-sig-1");

      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "Anthropic thinking",
                signature: "anthropic-sig-1",
              },
              {
                type: "thinking",
                content: "z.ai thinking",
                signature: "zai-sig-2",
              },
              { type: "text", text: "Answer" },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      // First block should remain thinking (Anthropic) with signature
      expect(parsed.messages[0].content[0].type).toBe("thinking");
      expect(parsed.messages[0].content[0].signature).toBe("anthropic-sig-1");
      // Second block should be converted to text (z.ai)
      expect(parsed.messages[0].content[1].type).toBe("text");
      expect(parsed.messages[0].content[1].text).toContain("<previous-glm-reasoning>");
      // Third block should remain text
      expect(parsed.messages[0].content[2].type).toBe("text");
      expect(parsed.messages[0].content[2].text).toBe("Answer");
    });

    it("handles multiple messages with different origins", () => {
      store.add("anthropic-sig-1");

      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "Anthropic thinking",
                signature: "anthropic-sig-1",
              },
            ],
          },
          {
            role: "user",
            content: "Question",
          },
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "z.ai thinking",
                signature: "zai-sig-2",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      // First message: Anthropic thinking should be preserved with signature
      expect(parsed.messages[0].content[0].type).toBe("thinking");
      expect(parsed.messages[0].content[0].signature).toBe("anthropic-sig-1");
      // Third message: z.ai thinking should be converted to text
      expect(parsed.messages[2].content[0].type).toBe("text");
      expect(parsed.messages[2].content[0].text).toContain("<previous-glm-reasoning>");
    });
  });

  describe("nested content in tool_result", () => {
    it("handles thinking blocks within tool_result", () => {
      store.add("anthropic-sig");

      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool_1",
                content: [
                  {
                    type: "thinking",
                    content: "Nested Anthropic thinking",
                    signature: "anthropic-sig",
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      const toolResult = parsed.messages[0].content[0];
      expect(toolResult.type).toBe("tool_result");
      // Anthropic thinking should be preserved with signature
      expect(toolResult.content[0].type).toBe("thinking");
      expect(toolResult.content[0].signature).toBe("anthropic-sig");
    });

    it("converts z.ai thinking blocks within tool_result to text", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool_1",
                content: [
                  {
                    type: "thinking",
                    content: "Nested z.ai thinking",
                    signature: "zai-sig",
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      const toolResult = parsed.messages[0].content[0];
      expect(toolResult.type).toBe("tool_result");
      // z.ai thinking should be converted to text
      expect(toolResult.content[0].type).toBe("text");
      expect(toolResult.content[0].text).toContain("<previous-glm-reasoning>");
    });
  });

  describe("edge cases", () => {
    it("returns original value if not JSON", () => {
      const requestBody = "not a json request";
      const result = sanitizeContentBlocksWithStore(requestBody, store);
      expect(result).toBe(requestBody);
    });

    it("returns original value if JSON is invalid", () => {
      const requestBody = "{invalid json}";
      const result = sanitizeContentBlocksWithStore(requestBody, store);
      expect(result).toBe(requestBody);
    });

    it("returns original value if messages array is missing", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      expect(result).toBe(requestBody);
    });

    it("handles empty store", () => {
      const requestBody = JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                content: "Some thinking",
                signature: "any-sig",
              },
            ],
          },
        ],
      });

      const result = sanitizeContentBlocksWithStore(requestBody, store);
      const parsed = JSON.parse(result);

      // All signatures should be treated as z.ai-origin
      expect(parsed.messages[0].content[0].type).toBe("text");
    });
  });
});
