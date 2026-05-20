import assert from "node:assert/strict";
import test from "node:test";
import { fetchArticleContent } from "../src/services/fetcher.js";

function htmlDataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

test("fetchArticleContent can limit article extraction with HTML start and end markers", async () => {
  const html = `
    <html>
      <body>
        <nav>navigation noise</nav>
        <!-- article-start -->
        <h1>Range title</h1>
        <p>Useful article text with enough punctuation to be treated as content.</p>
        <img src="https://example.com/image.jpg" width="600" height="400" alt="article image">
        <!-- article-end -->
        <footer>footer noise</footer>
      </body>
    </html>
  `;

  const article = await fetchArticleContent(htmlDataUrl(html), {
    htmlStart: "<!-- article-start -->",
    htmlEnd: "<!-- article-end -->",
    requestProfile: "bot"
  });

  assert.match(article.text, /Useful article text/);
  assert.doesNotMatch(article.text, /navigation noise/);
  assert.doesNotMatch(article.text, /footer noise/);
  assert.match(article.html, /image\.jpg/);
});

test("fetchArticleContent reports missing HTML range markers", async () => {
  await assert.rejects(
    () =>
      fetchArticleContent(htmlDataUrl("<article><p>Short body.</p></article>"), {
        htmlStart: "<main>",
        requestProfile: "bot"
      }),
    /HTML 开始标记未找到/
  );
});

test("fetchArticleContent decodes Shift_JIS article pages from meta charset", async () => {
  const encoded = new Uint8Array([
    60, 104, 116, 109, 108, 62, 60, 104, 101, 97, 100, 62, 60, 109, 101, 116, 97, 32, 99, 104, 97, 114, 115, 101, 116, 61, 34, 83, 104, 105, 102, 116, 95, 74, 73, 83, 34, 62, 60, 116, 105, 116, 108, 101, 62, 147, 250, 150, 123, 140, 234, 130, 204, 145, 232, 150, 188, 60, 47, 116, 105, 116, 108, 101, 62, 60, 47, 104, 101, 97, 100, 62, 60, 98, 111, 100, 121, 62, 60, 97, 114, 116, 105, 99, 108, 101, 62, 60, 104, 49, 62, 147, 250, 150, 123, 140, 234, 130, 204, 145, 232, 150, 188, 60, 47, 104, 49, 62, 60, 112, 62, 130, 177, 130, 234, 130, 205, 149, 182, 142, 154, 137, 187, 130, 175, 130, 181, 130, 200, 130, 162, 147, 250, 150, 123, 140, 234, 130, 204, 150, 123, 149, 182, 130, 197, 130, 183, 129, 66, 139, 229, 147, 199, 147, 95, 130, 224, 138, 220, 130, 223, 130, 196, 129, 65, 139, 76, 142, 150, 130, 198, 130, 181, 130, 196, 143, 92, 149, 170, 130, 200, 146, 183, 130, 179, 130, 170, 130, 160, 130, 232, 130, 220, 130, 183, 129, 66, 60, 47, 112, 62, 60, 47, 97, 114, 116, 105, 99, 108, 101, 62, 60, 47, 98, 111, 100, 121, 62, 60, 47, 104, 116, 109, 108, 62
  ]);
  const binary = Array.from(encoded, (byte) => String.fromCharCode(byte)).join("");
  const article = await fetchArticleContent(`data:text/html;base64,${btoa(binary)}`, {
    requestProfile: "bot"
  });

  assert.match(article.text, /日本語の本文/);
  assert.doesNotMatch(article.text, /�/);
});
