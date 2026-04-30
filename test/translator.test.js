import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "../src/services/translator.js";

test("google translator posts to official translate endpoint with API key and target language mapping", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body ? JSON.parse(String(options.body)) : null
    });
    return new Response(
      JSON.stringify({
        data: {
          translations: [{ translatedText: "你好 &amp; 世界" }]
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const translator = createTranslator({
    ai: {
      async translate() {
        throw new Error("AI translator should not be used in this test");
      }
    }
  });

  const output = await translator.translate(
    {
      provider: "google",
      apiKey: "google-key",
      targetLanguage: "zh-CN"
    },
    "Hello"
  );

  assert.equal(output, "你好 & 世界");
  assert.deepEqual(requests, [
    {
      url: "https://translation.googleapis.com/language/translate/v2?key=google-key",
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: {
        q: ["Hello"],
        target: "zh-CN",
        format: "text"
      }
    }
  ]);
});

test("google translator falls back to public no-key endpoint when API key is empty", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || "GET"
    });
    return new Response(
      JSON.stringify([[["你好，世界", "Hello, world", null, null]]]),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const translator = createTranslator({
    ai: {
      async translate() {
        throw new Error("AI translator should not be used in this test");
      }
    }
  });

  const output = await translator.translate(
    {
      provider: "google",
      apiKey: "",
      targetLanguage: "zh-CN"
    },
    "Hello, world"
  );

  assert.equal(output, "你好，世界");
  assert.deepEqual(requests, [
    {
      url: "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=Hello%2C+world",
      method: "GET"
    }
  ]);
});

test("bing translator posts to official translate endpoint with region header and mapped language code", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body ? JSON.parse(String(options.body)) : null
    });
    return new Response(
      JSON.stringify([
        {
          translations: [{ text: "你好世界" }]
        }
      ]),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const translator = createTranslator({
    ai: {
      async translate() {
        throw new Error("AI translator should not be used in this test");
      }
    }
  });

  const output = await translator.translate(
    {
      provider: "bing",
      apiKey: "bing-key",
      baseUrl: "https://api.cognitive.microsofttranslator.com/",
      region: "eastasia",
      targetLanguage: "zh-CN"
    },
    "Hello"
  );

  assert.equal(output, "你好世界");
  assert.deepEqual(requests, [
    {
      url: "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans&textType=plain",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Ocp-Apim-Subscription-Key": "bing-key",
        "Ocp-Apim-Subscription-Region": "eastasia"
      },
      body: [{ text: "Hello" }]
    }
  ]);
});
