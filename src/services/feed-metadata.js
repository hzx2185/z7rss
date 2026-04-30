const categoryRules = [
  {
    name: "AI",
    keywords: ["openai", "anthropic", "deepmind", "huggingface", "llm", "chatgpt", "人工智能", "机器学习", "大模型", "ai"],
    domains: ["openai.com", "anthropic.com", "huggingface.co"]
  },
  {
    name: "技术",
    keywords: [
      "github",
      "gitlab",
      "developer",
      "programming",
      "software",
      "javascript",
      "typescript",
      "python",
      "rust",
      "golang",
      "node",
      "frontend",
      "backend",
      "linux",
      "开源",
      "编程",
      "开发",
      "程序",
      "技术",
      "代码"
    ],
    domains: ["github.com", "gitlab.com", "stackoverflow.com", "lobste.rs", "hnrss.org"]
  },
  {
    name: "运维",
    keywords: ["docker", "kubernetes", "cloud", "aws", "azure", "gcp", "devops", "sre", "infra", "运维", "云原生", "容器"],
    domains: ["aws.amazon.com", "kubernetes.io", "docker.com"]
  },
  {
    name: "安全",
    keywords: ["security", "infosec", "cve", "vulnerability", "zero day", "网络安全", "信息安全", "漏洞", "攻防"],
    domains: ["krebsonsecurity.com", "cisa.gov", "nvd.nist.gov"]
  },
  {
    name: "健康生活",
    keywords: ["parenting", "baby", "kids", "child", "children", "motherhood", "母婴", "育儿", "宝宝", "孩子", "婴儿", "孕期", "宝妈", "儿科", "丁香妈妈", "dingxiangmami"],
    domains: []
  },
  {
    name: "健康生活",
    keywords: ["medical", "medicine", "doctor", "nutrition", "wellness", "健康", "医学", "医生", "疾病", "用药", "疫苗", "营养", "丁香医生"],
    domains: ["dxy.com", "dxy.cn"]
  },
  {
    name: "财经",
    keywords: ["finance", "economy", "stock", "market", "crypto", "bitcoin", "ethereum", "财经", "金融", "股票", "基金", "加密"],
    domains: ["bloomberg.com", "wsj.com", "cointelegraph.com"]
  },
  {
    name: "设计",
    keywords: ["design", "figma", "dribbble", "behance", "ux", "ui", "视觉", "设计", "交互", "排版"],
    domains: ["dribbble.com", "behance.net", "figma.com"]
  },
  {
    name: "商业",
    keywords: ["business", "startup", "saas", "marketing", "founder", "venture", "商业", "创业", "产品", "公司"],
    domains: ["techcrunch.com", "theinformation.com", "producthunt.com"]
  },
  {
    name: "新闻",
    keywords: ["news", "daily", "headline", "newsletter", "报道", "新闻", "资讯", "日报", "周刊"],
    domains: ["nytimes.com", "cnn.com", "reuters.com", "theverge.com"]
  },
  {
    name: "视频",
    keywords: ["youtube", "bilibili", "video", "podcast", "播客", "视频"],
    domains: ["youtube.com", "bilibili.com"]
  },
  {
    name: "生活",
    keywords: ["travel", "food", "culture", "生活", "旅行", "美食", "文化"],
    domains: ["lifehacker.com"]
  }
];

export const broadFeedCategories = [
  "AI",
  "技术",
  "运维",
  "安全",
  "健康生活",
  "财经",
  "设计",
  "商业",
  "新闻",
  "视频",
  "生活",
  "博客",
  "未分类"
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordMatches(haystack, keyword) {
  const normalized = String(keyword || "").toLowerCase().trim();
  if (!normalized) return false;
  if (/^[a-z0-9+#.-]+$/i.test(normalized)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, "i").test(haystack);
  }
  return haystack.includes(normalized);
}

export function cleanCategory(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 40) : null;
}

export function inferFeedCategory(feed = {}, items = []) {
  const fields = [
    { value: feed.title, weight: 4 },
    { value: `${feed.url || ""} ${feed.site_url || ""} ${feed.siteUrl || ""}`, weight: 3 },
    { value: feed.description, weight: 2 },
    ...items.slice(0, 10).map((item) => ({
      value: `${item?.title || ""} ${item?.summary || ""}`,
      weight: 1
    }))
  ].map((field) => ({
    haystack: String(field.value || "").toLowerCase(),
    weight: field.weight
  }));
  const haystack = fields.map((field) => field.haystack).join(" ");

  if (!haystack.trim()) {
    return "博客";
  }

  let bestMatch = { name: "博客", score: 0 };
  for (const rule of categoryRules) {
    let score = 0;
    for (const field of fields) {
      if (!field.haystack) continue;
      for (const keyword of rule.keywords) {
        if (keywordMatches(field.haystack, keyword)) {
          score += (keyword.length >= 6 ? 4 : 2) * field.weight;
        }
      }
      for (const domain of rule.domains) {
        if (field.haystack.includes(String(domain).toLowerCase())) {
          score += 5 * field.weight;
        }
      }
    }
    if (score > bestMatch.score) {
      bestMatch = { name: rule.name, score };
    }
  }

  if (bestMatch.score > 0) {
    return bestMatch.name;
  }

  if (/blog|博客|专栏|log/.test(haystack)) {
    return "博客";
  }
  if (/news|日报|周刊|newsletter|资讯|新闻/.test(haystack)) {
    return "新闻";
  }
  return "未分类";
}

export function getFeedFreshness(lastFetchedAt) {
  if (!lastFetchedAt) {
    return {
      lastFetchedDays: null,
      isStale: false,
      freshnessLabel: "从未更新"
    };
  }

  const parsed = new Date(lastFetchedAt);
  if (Number.isNaN(parsed.getTime())) {
    return {
      lastFetchedDays: null,
      isStale: false,
      freshnessLabel: "更新时间未知"
    };
  }

  const diffMs = Math.max(0, Date.now() - parsed.getTime());
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const isStale = diffMs >= 7 * 24 * 60 * 60 * 1000;

  if (days < 1) {
    return {
      lastFetchedDays: 0,
      isStale,
      freshnessLabel: "今天更新"
    };
  }

  return {
    lastFetchedDays: days,
    isStale,
    freshnessLabel: `${days} 天前更新`
  };
}

export function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}
