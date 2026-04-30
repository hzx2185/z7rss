import assert from "node:assert/strict";
import test from "node:test";
import { buildDigestSource } from "../src/services/digest-service.js";

test("digest source builder limits item count and input characters", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    feed_title: `Feed ${index + 1}`,
    title: `Title ${index + 1}`,
    summary: "x".repeat(120),
    link: `https://example.com/${index + 1}`
  }));

  const result = buildDigestSource(items, {
    maxItems: 3,
    maxCharsPerItem: 30,
    maxTotalChars: 500
  });

  assert.equal(result.items.length, 3);
  assert.ok(result.source.length <= 500);
  assert.ok(!result.source.includes("Title 4"));
  assert.match(result.source, /x{29}…/);
  assert.deepEqual(result.inputLimits, {
    maxItems: 3,
    maxCharsPerItem: 30,
    maxTotalChars: 500,
    inputMode: "title_summary"
  });
});

test("digest source builder can use titles only and avoid body text", () => {
  const result = buildDigestSource(
    [
      {
        feed_title: "Feed",
        title: "Important title",
        summary: "summary should stay out",
        content_text: "body should stay out",
        link: "https://example.com/1"
      }
    ],
    {
      maxItems: 5,
      maxCharsPerItem: 300,
      maxTotalChars: 1000,
      inputMode: "title"
    }
  );

  assert.match(result.source, /Important title/);
  assert.doesNotMatch(result.source, /summary should stay out/);
  assert.doesNotMatch(result.source, /body should stay out/);
});
