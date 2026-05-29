import assert from "node:assert/strict";
import test from "node:test";
import { discoverJsonFeedMappingFromHtml, fetchFeed } from "../src/services/fetcher.js";

const html = `<!doctype html>
<html><head><title>Demo</title></head><body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "articles": [
        {
          "headline": "第一篇文章",
          "url": "/posts/one",
          "excerpt": "第一篇摘要内容，足够长一点。",
          "publishedAt": "2026-05-01T00:00:00.000Z"
        },
        {
          "headline": "第二篇文章",
          "url": "https://example.com/posts/two",
          "excerpt": "第二篇摘要内容，足够长一点。",
          "publishedAt": "2026-05-02T00:00:00.000Z"
        }
      ]
    }
  }
}
</script>
</body></html>`;

test("discoverJsonFeedMappingFromHtml infers JSON paths from embedded page data", () => {
  const result = discoverJsonFeedMappingFromHtml(html, "https://example.com/news");

  assert.equal(result.mapping.jsonItemsPath, "props.pageProps.articles");
  assert.equal(result.mapping.jsonTitlePath, "headline");
  assert.equal(result.mapping.jsonLinkPath, "url");
  assert.equal(result.mapping.jsonSummaryPath, "excerpt");
  assert.equal(result.mapping.jsonDatePath, "publishedAt");
  assert.equal(result.items[0].link, "https://example.com/posts/one");
});

test("fetchFeed parses HTML embedded JSON when JSON paths are configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });

  try {
    const result = await fetchFeed("https://example.com/news", {
      feedFormat: "json",
      jsonItemsPath: "props.pageProps.articles",
      jsonTitlePath: "headline",
      jsonLinkPath: "url",
      jsonSummaryPath: "excerpt",
      jsonDatePath: "publishedAt",
      timeoutMs: 1000
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].title, "第一篇文章");
    assert.equal(result.items[0].link, "https://example.com/posts/one");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFeed maps HTML list selectors into feed items", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<!doctype html>
    <html><body>
      <div class="HotItem">
        <div class="HotItem-index">1</div>
        <a class="HotItem-img" href="/question/42"></a>
        <h2 class="HotItem-title">如何评价 HTML 抓取模板？</h2>
        <span class="RichText ztext CopyrightRichText-richText css-4ti5lv" itemProp="text">正文内容</span>
      </div>
    </body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });

  try {
    const result = await fetchFeed("https://www.zhihu.com/hot", {
      feedFormat: "html",
      htmlItemsSelector: ".HotItem",
      htmlTitleSelector: ".HotItem-title",
      htmlLinkSelector: "a.HotItem-img",
      htmlContentSelector: ".RichText.ztext.CopyrightRichText-richText",
      timeoutMs: 1000
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "如何评价 HTML 抓取模板？");
    assert.equal(result.items[0].link, "https://www.zhihu.com/question/42");
    assert.equal(result.items[0].contentText, "正文内容");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFeed maps Hani China list pages into feed items", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<!doctype html>
    <html><head><title>首页 : 韩民族日报</title></head><body>
      <div class="comm-fixed fixed-left">
        <ul>
          <li>
            <a href="/arti/culture/16942.html">
              <span class="lst-txt-wrap">
                <span class="article-tit ellipsis2">【书评】美国的自负与缺乏共情，加剧了朝核危机</span>
                <span class="article-txt ellipsis2">2019年6月30日，美国总统唐纳德·特朗普与朝鲜国务委员会委员长金正恩在板门店共同警备区军事分界线两侧亲切握手。</span>
                <span class="article-time">2026-05-29 17:20</span>
              </span>
            </a>
          </li>
        </ul>
      </div>
    </body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });

  try {
    const result = await fetchFeed("https://china.hani.co.kr/arti/RSS", {
      feedFormat: "html",
      htmlItemsSelector: ".comm-fixed.fixed-left > ul > li",
      htmlTitleSelector: ".article-tit",
      htmlLinkSelector: "a[href]",
      htmlDateSelector: ".article-time",
      htmlSummarySelector: ".article-txt",
      htmlContentSelector: ".article-txt",
      timeoutMs: 1000
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "【书评】美国的自负与缺乏共情，加剧了朝核危机");
    assert.equal(result.items[0].link, "https://china.hani.co.kr/arti/culture/16942.html");
    assert.match(result.items[0].contentText, /板门店/);
    assert.equal(result.items[0].publishedAt, new Date("2026-05-29 17:20").toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFeed maps Juejin content ids into article links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    err_no: 0,
    data: [
      {
        content: {
          content_id: "7644206599271858226",
          title: "掘金文章标题",
          brief: "掘金摘要"
        }
      }
    ]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  try {
    const result = await fetchFeed("https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot", {
      feedFormat: "json",
      jsonItemsPath: "data",
      jsonTitlePath: "content.title",
      jsonLinkPath: "content.content_id",
      jsonSummaryPath: "content.brief",
      jsonContentPath: "content.brief"
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "掘金文章标题");
    assert.equal(result.items[0].link, "https://juejin.cn/post/7644206599271858226");
    assert.equal(result.items[0].summary, "掘金摘要");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFeed can POST JSON and map Juejin recommended items", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {
      id_type: 2,
      client_type: 2608,
      sort_type: 7,
      cursor: "0",
      limit: 20
    });
    assert.equal(options.headers["content-type"], "application/json");
    return new Response(JSON.stringify({
      err_no: 0,
      data: [
        {
          item_info: {
            article_info: {
              article_id: "7644206599271858226",
              title: "掘金推荐文章",
              brief_content: "推荐摘要内容",
              rtime: "1772323200"
            }
          }
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await fetchFeed("https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed", {
      feedFormat: "json",
      requestMethod: "POST",
      requestBody: JSON.stringify({
        id_type: 2,
        client_type: 2608,
        sort_type: 7,
        cursor: "0",
        limit: 20
      }),
      jsonItemsPath: "data",
      jsonTitlePath: "item_info.article_info.title",
      jsonLinkPath: "item_info.article_info.article_id",
      jsonDatePath: "item_info.article_info.rtime",
      jsonSummaryPath: "item_info.article_info.brief_content",
      jsonContentPath: "item_info.article_info.brief_content"
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "掘金推荐文章");
    assert.equal(result.items[0].link, "https://juejin.cn/post/7644206599271858226");
    assert.equal(result.items[0].summary, "推荐摘要内容");
    assert.equal(result.items[0].publishedAt, "2026-03-01T00:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
