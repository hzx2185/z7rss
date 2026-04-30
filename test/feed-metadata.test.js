import test from "node:test";
import assert from "node:assert/strict";

import { inferFeedCategory } from "../src/services/feed-metadata.js";

test("classifies parenting health feeds before generic safety wording", () => {
  const category = inferFeedCategory(
    {
      title: "丁香妈妈",
      url: "https://plink.anyfeeder.com/weixin/DingXiangMaMi",
      description: "丁香妈妈是丁香医生旗下的母婴科普平台。每天分享科学靠谱的育儿知识。"
    },
    [
      { title: "假期不管在家还是出行，这份「宝宝安全防护手册」都请查收" },
      { title: "孩子晚上咳得厉害，是什么原因？" }
    ]
  );

  assert.equal(category, "健康生活");
});

test("keeps cybersecurity feeds in the security category", () => {
  const category = inferFeedCategory({
    title: "CVE vulnerability research",
    description: "Security research, infosec notes, exploit analysis and network security updates."
  });

  assert.equal(category, "安全");
});

test("does not classify daily newsletters as AI because of short substring matches", () => {
  const category = inferFeedCategory({
    title: "Daily Headlines",
    description: "A daily news newsletter with headline reports."
  });

  assert.equal(category, "新闻");
});

test("keeps general news feeds out of health when health is only one covered topic", () => {
  const category = inferFeedCategory({
    title: "U.S. News - News",
    url: "https://www.usnews.com/rss/news.xml",
    description: "Get the latest news about politics, the economy, health care, education, Congress, and government."
  });

  assert.equal(category, "新闻");
});
