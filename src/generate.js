import { PROVIDERS, outputTokenCap } from "./logic.js";

export async function generateCopy({ provider, apiKey, model, prompt, images, slotCount = 8 }) {
  const selected = PROVIDERS[provider] ? provider : "gemini";
  const usedModel = model?.trim() || PROVIDERS[selected].defaultModel;
  if (!apiKey?.trim()) {
    throw new Error("API 키를 먼저 저장해 주세요.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    if (selected === "openai") {
      return await generateOpenAI({ apiKey: apiKey.trim(), model: usedModel, prompt, images, slotCount, signal: controller.signal });
    }
    return await generateGemini({ apiKey: apiKey.trim(), model: usedModel, prompt, images, slotCount, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("응답이 120초 안에 오지 않았습니다. 다시 시도해 주세요.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generateGemini({ apiKey, model, prompt, images, slotCount, signal }) {
  const parts = [{ text: "참고 페이지 캡처다. 이미지는 페이지 위쪽부터 순서대로다." }];
  for (const image of images) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
  }
  parts.push({ text: prompt });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: geminiConfig(model, slotCount),
      }),
    },
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(apiMessage(response.status, data));
  const partsOut = data.candidates?.[0]?.content?.parts || [];
  const visible = partsOut.filter((part) => part.text && !part.thought).map((part) => part.text).join("");
  const text = visible || partsOut.filter((part) => part.text).map((part) => part.text).join("");
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    if (reason === "MAX_TOKENS") throw new Error("문구가 길어서 응답이 잘렸습니다. 다시 시도해 주세요.");
    if (reason === "SAFETY" || data.promptFeedback?.blockReason) {
      throw new Error("요청이 안전 정책에 걸려 문구를 만들지 못했습니다.");
    }
    throw new Error("모델이 문구를 반환하지 않았습니다. API 키와 모델 이름을 확인해 주세요.");
  }
  return text;
}

function geminiConfig(model, slotCount) {
  const config = {
    maxOutputTokens: outputTokenCap(slotCount),
    responseMimeType: "application/json",
  };
  if (/^gemini-3/i.test(model || "")) {
    config.thinkingConfig = { thinkingLevel: "LOW" };
  } else {
    config.temperature = 0.7;
  }
  return config;
}

async function generateOpenAI({ apiKey, model, prompt, images, slotCount, signal }) {
  const content = [{ type: "text", text: prompt }];
  for (const image of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${image}` },
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_completion_tokens: outputTokenCap(slotCount),
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    }),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(apiMessage(response.status, data));
  const message = data.choices?.[0]?.message?.content;
  const text = Array.isArray(message) ? message.map((part) => part.text || "").join("") : message || "";
  if (!text) throw new Error("모델이 문구를 반환하지 않았습니다.");
  return text;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 300) } };
  }
}

function apiMessage(status, data) {
  const detail = data?.error?.message || data?.message || "";
  if (status === 400) return `요청을 처리하지 못했습니다. 모델 이름을 확인해 주세요. ${detail}`.trim();
  if (status === 401 || status === 403) return "API 키가 거절되었습니다. 키와 제공자를 다시 확인해 주세요.";
  if (status === 404) return `모델을 찾지 못했습니다. 설정에 있는 모델 이름을 바꿔 주세요. ${detail}`.trim();
  if (status === 429) return "요청 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.";
  return `문구 생성에 실패했습니다. (${status}) ${detail}`.trim();
}
