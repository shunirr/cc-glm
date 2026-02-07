/**
 * Unit tests for response transformation
 */

import { describe, it, expect } from "vitest";
import { transformThinkingBlocks, shouldTransformResponse } from "../../src/proxy/transform.js";

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
