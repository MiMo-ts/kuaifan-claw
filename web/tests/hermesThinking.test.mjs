import test from "node:test";
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";

const compiledModule = new URL("../../artifacts/test/web/hermesProtocol.mjs", import.meta.url);
const moduleExists = existsSync(compiledModule);

test("thinking helpers module is available", () => {
  assert.equal(moduleExists, true);
});

if (moduleExists) {
  const {
    cleanThinkingText,
    hasMeaningfulReasoning,
    normalizeReasoningEffort,
  } = await import(compiledModule);

  // Mirrors the native Hermes THINKING_STATUS_PREFIX_RE. The optional
  // word prefix is a single non-space token (Hermes, Nous, etc.); multi-
  // word prefixes like "Hermes is" are intentionally NOT matched to
  // avoid losing sentence boundaries in real reasoning chunks.
  test("strips a single-word verb... status prefix", () => {
    assert.equal(cleanThinkingText("thinking... about the user request"), "about the user request");
    assert.equal(cleanThinkingText("Hermes thinking... the answer is 42"), "the answer is 42");
    assert.equal(cleanThinkingText("processing... the user wants a summary"), "the user wants a summary");
  });

  test("drops placeholder echoes so they never render as content", () => {
    assert.equal(cleanThinkingText("current rewritten thinking blah"), "");
    assert.equal(cleanThinkingText("I don't see any thinking content here"), "");
  });

  test("preserves real reasoning including lowercase leading characters", () => {
    assert.equal(
      cleanThinkingText("the user is asking about chess openings"),
      "the user is asking about chess openings",
    );
    assert.equal(
      cleanThinkingText("Thinking is what humans do"),
      "Thinking is what humans do",
    );
  });

  test("reports reasoning emptiness correctly", () => {
    assert.equal(hasMeaningfulReasoning(""), false);
    assert.equal(hasMeaningfulReasoning(null), false);
    assert.equal(hasMeaningfulReasoning("Thinking..."), false);
    assert.equal(hasMeaningfulReasoning("the user wants X"), true);
  });

  test("normalizes reasoning effort spellings to the canonical set", () => {
    assert.equal(normalizeReasoningEffort(""), "off");
    assert.equal(normalizeReasoningEffort("false"), "off");
    assert.equal(normalizeReasoningEffort("none"), "off");
    assert.equal(normalizeReasoningEffort("low"), "low");
    assert.equal(normalizeReasoningEffort("high"), "high");
    assert.equal(normalizeReasoningEffort("xhigh"), "xhigh");
    assert.equal(normalizeReasoningEffort("banana"), "off");
    assert.equal(normalizeReasoningEffort(null), "off");
  });
}
