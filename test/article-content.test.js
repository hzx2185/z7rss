import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUsableStoredArticleContent,
  hasUsableStoredPageContent,
  isLikelyInvalidArticleContent
} from "../src/services/article-content.js";

test("detects V2EX login shell content as invalid article content", () => {
  const html = `
    <div class="site-nav">
      <a href="https://www.v2ex.com/">首页</a>
      <a href="https://www.v2ex.com/signup">注册</a>
      <a href="https://www.v2ex.com/signin">登录</a>
    </div>
  `;

  assert.equal(
    isLikelyInvalidArticleContent({
      articleUrl: "https://www.v2ex.com/t/1208580",
      text: "首页 注册 登录",
      html
    }),
    true
  );

  assert.equal(
    hasUsableStoredArticleContent({
      link: "https://www.v2ex.com/t/1208580",
      content_text: "首页 注册 登录",
      content_html: html
    }),
    false
  );

  assert.equal(
    hasUsableStoredPageContent({
      link: "https://www.v2ex.com/t/1208580",
      page_text: "首页 注册 登录",
      page_html: html
    }),
    false
  );
});

test("keeps real V2EX topic content as valid article content", () => {
  const html = `
    <div id="Main">
      <div class="box">
        <div class="cell">
          <div class="topic_content">这是 V2EX 主题正文，包含完整段落内容。</div>
        </div>
      </div>
    </div>
  `;

  assert.equal(
    isLikelyInvalidArticleContent({
      articleUrl: "https://www.v2ex.com/t/1208580",
      text: "这是 V2EX 主题正文，包含完整段落内容。",
      html
    }),
    false
  );

  assert.equal(
    hasUsableStoredArticleContent({
      link: "https://www.v2ex.com/t/1208580",
      content_text: "这是 V2EX 主题正文，包含完整段落内容。",
      content_html: html
    }),
    true
  );
});

test("treats SMZDM author-only or boilerplate text as invalid article content", () => {
  assert.equal(
    isLikelyInvalidArticleContent({
      articleUrl: "https://www.smzdm.com/p/172992902/",
      text: "小麦大卖",
      author: "小麦大卖",
      summary: "这是一段正常的优惠摘要，明显比作者名更长。"
    }),
    true
  );

  assert.equal(
    isLikelyInvalidArticleContent({
      articleUrl: "https://www.smzdm.com/p/172992902/",
      text: "本文来自 什么值得买网站（www.smzdm.com） 。",
      author: "小麦大卖",
      summary: "这是一段正常的优惠摘要，明显比站点尾注更长。"
    }),
    true
  );

  assert.equal(
    hasUsableStoredArticleContent({
      link: "https://www.smzdm.com/p/172992902/",
      author: "小麦大卖",
      summary: "这是一段正常的优惠摘要，明显比作者名更长。",
      content_text: "小麦大卖",
      content_html: "<p>小麦大卖</p>"
    }),
    false
  );
});
