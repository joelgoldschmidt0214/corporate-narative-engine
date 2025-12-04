import { GoogleGenAI, Type } from "@google/genai";
import type {
  CompanyInput,
  YearlyData,
  DocumentType as _DocumentType,
  GeneratedDocument,
  DetailedFinancials,
  FinancialSection,
} from "../types";
import { logger } from "./logger.ts";
import activityLogger from "./activityLogger.ts";

// Provide a runtime-safe DocumentType mapping to avoid importing the project's
// TypeScript `enum` at runtime (which breaks `ts-node` strip-only mode).
export const DocumentType = {
  BS: "BS",
  PL: "PL",
  CF: "CF",
  JE: "JE",
  NEWSLETTER: "NEWSLETTER",
} as const;
import * as fs from "fs";
import * as path from "path";

// ========== Gemini Structured Output Schemas (native format) ==========
// JE (Journal Entry) bulk schema - using Gemini's native Type system
const JE_BULK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    years: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.NUMBER },
          months: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING },
                      account: { type: Type.STRING },
                      debit: { type: Type.NUMBER },
                      credit: { type: Type.NUMBER },
                      label: { type: Type.STRING },
                    },
                    required: ["date", "account"],
                  },
                },
              },
              required: ["title", "items"],
            },
          },
        },
        required: ["year", "months"],
      },
    },
  },
  required: ["years"],
};

// Newsletter bulk schema
const NEWSLETTER_BULK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    newsletters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.NUMBER },
          content: { type: Type.STRING },
        },
        required: ["year", "content"],
      },
    },
  },
  required: ["newsletters"],
};

// High-resolution timer helper that works in both browser and Node
const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
const getClient = () => {
  // Support multiple env var names depending on how the project is run.
  // Prefer GEMINI_API_KEY, then API_KEY, then VITE-prefixed variants via import.meta
  let apiKey: string | undefined = undefined;

  if (typeof process !== "undefined" && process.env) {
    apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || undefined;
  }

  // Check Vite-style env if available (only in bundler/browser build)
  if (!apiKey && typeof import.meta !== "undefined") {
    apiKey =
      (import.meta as any).env?.GEMINI_API_KEY ||
      (import.meta as any).env?.VITE_GEMINI_API_KEY ||
      (import.meta as any).env?.VITE_API_KEY ||
      undefined;
  }

  if (!apiKey) {
    throw new Error(
      "API Key is missing. Please set GEMINI_API_KEY or API_KEY in your environment."
    );
  }

  return new GoogleGenAI({ apiKey });
};

// Helper for delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Utility: chunk an array into n-sized groups
const chunkArray = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Robust JSON parsing helper: try direct parse, then try extracting first/last brace, then try linewise parsing.
const safeParseJson = (text: string): any => {
  if (!text) return null;
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    // Try to extract JSON object/array substring
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const sub = text.slice(first, last + 1);
      try {
        return JSON.parse(sub);
      } catch (e2) {
        // continue
      }
    }
    // Try to find a JSON array
    const arrFirst = text.indexOf("[");
    const arrLast = text.lastIndexOf("]");
    if (arrFirst !== -1 && arrLast !== -1 && arrLast > arrFirst) {
      const sub = text.slice(arrFirst, arrLast + 1);
      try {
        return JSON.parse(sub);
      } catch (e3) {
        // continue
      }
    }
    // As last resort, try parsing line by line to build an array/object
    const lines = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    // If each line looks like JSON, try parsing them
    const parsedLines = [] as any[];
    for (const l of lines) {
      try {
        parsedLines.push(JSON.parse(l));
      } catch (_) {
        // try plain string
        parsedLines.push(l);
      }
    }
    if (parsedLines.length > 0) return parsedLines;
    return null;
  }
};

// Normalization helpers for common malformed shapes returned by the model
const normalizeNewsletters = (
  parsed: any,
  rawText: string,
  inputYears: number[]
): any => {
  if (!parsed) return ensureYearMonths(parsed);
  // If no newsletters key, nothing to do here
  if (!parsed.newsletters) return parsed;

  const items = parsed.newsletters;
  if (!Array.isArray(items)) return parsed;

  // Handle common pattern: alternating [year, content, year, content, ...]
  const isAlternatingYearContent =
    Array.isArray(items) &&
    items.length >= 2 &&
    items.every((el: any, idx: number) =>
      idx % 2 === 0
        ? typeof el === "number" ||
          (typeof el === "string" && /^\d{4}$/.test(el))
        : typeof el === "string"
    );
  if (isAlternatingYearContent) {
    const out: any[] = [];
    for (let i = 0; i < items.length; i += 2) {
      const rawYear = items[i];
      const year =
        typeof rawYear === "number" ? rawYear : Number(String(rawYear).trim());
      const content = String(items[i + 1] || "").trim();
      out.push({ year: Number(year), content });
    }
    parsed.newsletters = out;
    return parsed;
  }

  // If the array contains an embedded JSON string (e.g. many nulls and one
  // long JSON string), parse and prefer that payload which often contains
  // the correct `newsletters` array.
  for (const el of items) {
    if (typeof el === "string") {
      const trimmed = el.trim();
      if (
        trimmed.startsWith("{") ||
        trimmed.includes('"newsletters"') ||
        trimmed.includes('"year"')
      ) {
        try {
          const candidate = safeParseJson(trimmed);
          if (
            candidate &&
            candidate.newsletters &&
            Array.isArray(candidate.newsletters)
          ) {
            parsed.newsletters = candidate.newsletters;
            return parsed;
          }
        } catch (_e) {
          // ignore and continue
        }
      }
    }
  }

  const isPrimitiveArray = items.every(
    (it: any) => typeof it !== "object" || it === null
  );
  if (isPrimitiveArray) {
    // Try extracting by searching for year markers inside the raw response
    const joined = items.join(" ");
    const out: any[] = [];
    for (let i = 0; i < inputYears.length; i++) {
      const year = inputYears[i];
      const yearStr = String(year);
      let content = "";
      const pos = joined.indexOf(yearStr);
      if (pos !== -1) {
        // Try to find the 'content' token after the year
        const contentToken = joined.indexOf("content", pos);
        if (contentToken !== -1) {
          const after = joined.slice(contentToken);
          const colon = after.indexOf(":");
          const snippet = colon !== -1 ? after.slice(colon + 1) : after;
          // determine next year position inside snippet
          let nextPos = -1;
          for (const y2 of inputYears) {
            const p = snippet.indexOf(String(y2));
            if (p !== -1 && (nextPos === -1 || p < nextPos)) nextPos = p;
          }
          const rawContent =
            nextPos !== -1 ? snippet.slice(0, nextPos) : snippet;
          content = rawContent
            .replace(/[\"{}\[\]]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        } else {
          // Fallback: take fixed-length snippet after the year
          const after = joined.slice(
            pos + yearStr.length,
            pos + yearStr.length + 400
          );
          content = after.replace(/[\"{}\[\]]/g, "").trim();
        }
      } else {
        // If year not found in joined text, fall back to the primitive at same index
        const el = items[i];
        content = typeof el === "string" ? el : String(el || "");
      }
      out.push({ year: Number(year), content: content });
    }
    parsed.newsletters = out;
    return parsed;
  }

  // If array contains only numbers (garbage numeric tokens), try extracting
  // year-marked blocks from raw text as a last resort.
  const allNumbers = items.every((it: any) => typeof it === "number");
  if (allNumbers) {
    const out2: any[] = [];
    const text = String(rawText || "");
    for (const y of inputYears) {
      const marker1 = `Year:${y}`;
      const marker2 = `${y}`;
      const pos = text.indexOf(marker1);
      const pos2 = pos === -1 ? text.indexOf(marker2) : pos;
      if (pos2 !== -1) {
        // take up to next Year: or 400 chars
        const next = text.indexOf("Year:", pos2 + 1);
        const slice =
          next !== -1 ? text.slice(pos2, next) : text.slice(pos2, pos2 + 400);
        const cleaned = slice
          .replace(/^[^\n]*\n?/, "")
          .replace(/["{}\[\]]/g, "")
          .trim();
        out2.push({ year: Number(y), content: cleaned });
      } else {
        out2.push({ year: Number(y), content: "" });
      }
    }
    if (out2.length > 0) {
      parsed.newsletters = out2;
      return parsed;
    }
  }

  // If some items are objects but missing years, fill by inputYears by order
  const mapped = items.map((it: any, idx: number) => {
    if (it && typeof it === "object") {
      if (it.year == null) it.year = inputYears[idx] || null;
      if (it.content == null) it.content = String(it || "");
      return it;
    }
    return { year: inputYears[idx] || null, content: String(it || "") };
  });

  // If many entries are missing year, attempt to extract Year:YYYY blocks from rawText
  const nullCount = mapped.filter((m: any) => m.year == null).length;
  if (nullCount > 0) {
    try {
      const blocks: any[] = [];
      const regex = /Year[:\s]*([0-9]{4})/g;
      const matches = [...String(rawText || "").matchAll(regex)];
      if (matches.length > 0) {
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const year = Number(m[1]);
          const start = m.index || 0;
          const end = matches[i + 1]
            ? matches[i + 1].index
            : String(rawText || "").length;
          const slice = String(rawText || "").slice(start, end);
          const content = slice
            .replace(regex, "")
            .replace(/["{}\[\]]/g, "")
            .replace(/\s+/g, " ")
            .trim();
          blocks.push({ year: Number(year), content });
        }
      }
      if (blocks.length > 0) {
        parsed.newsletters = blocks;
        return parsed;
      }
    } catch (_e) {
      // ignore and continue to other fallbacks
    }

    // Fallback: collect string entries and map them to inputYears by order
    const stringContents = items
      .filter((it: any) => typeof it === "string")
      .map((s: any) => String(s).trim());
    if (stringContents.length >= inputYears.length) {
      parsed.newsletters = inputYears.map((y: number, idx: number) => ({
        year: Number(y),
        content: stringContents[idx] || "",
      }));
      return parsed;
    }
  }

  parsed.newsletters = mapped;
  return parsed;
};

const normalizeJE = (
  parsed: any,
  rawText: string,
  inputYears: number[]
): any => {
  if (!parsed) return parsed;
  // If top-level contains entries_by_year or all_years_data (common fallback), synthesize parsed.years
  if (!Array.isArray(parsed.years)) {
    if (
      Array.isArray(parsed.entries_by_year) &&
      parsed.entries_by_year.length > 0
    ) {
      parsed.years = parsed.entries_by_year.map((s: any) => {
        if (typeof s === "string") {
          const m = s.match(/Year:\s*(\d{4})/);
          const year = m ? Number(m[1]) : null;
          return { year, months: [] };
        }
        return { year: Number(s) || null, months: [] };
      });
    } else if (
      Array.isArray(parsed.all_years_data) &&
      parsed.all_years_data.length > 0
    ) {
      parsed.years = parsed.all_years_data.map((s: any) => {
        if (typeof s === "string") {
          const m = s.match(/Year:\s*(\d{4})/);
          const year = m ? Number(m[1]) : null;
          return { year, months: [] };
        }
        return { year: Number(s) || null, months: [] };
      });
    } else {
      return ensureYearMonths(parsed);
    }
  }

  const items = parsed.years;
  const first = items[0];
  if (first && typeof first === "object") return ensureYearMonths(parsed); // already objects

  // If items are primitives, try to find explicit year markers in the raw text
  const joined = Array.isArray(items) ? items.join(" ") : String(items || "");
  const out: any[] = [];
  // Prefer inputYears as canonical years; if raw contains those markers, use them
  for (const y of inputYears) {
    const ys = String(y);
    if (joined.indexOf(ys) !== -1 || String(items).indexOf(ys) !== -1) {
      out.push({ year: Number(y), months: [] });
    }
  }

  // If we didn't detect any year markers, fall back to mapping numeric primitives that look like years
  if (out.length === 0) {
    for (const it of items) {
      if (typeof it === "number" && it > 1900 && it < 2100) {
        out.push({ year: Number(it), months: [] });
      } else if (typeof it === "string" && /^\d{4}$/.test(it.trim())) {
        out.push({ year: Number(it.trim()), months: [] });
      }
    }
  }

  // As a last resort, ensure we produce at least one object per input year (empty months)
  if (out.length === 0) {
    for (const y of inputYears) out.push({ year: Number(y), months: [] });
  }

  parsed.years = out;
  return ensureYearMonths(parsed);
};

// Ensure each year object has a months array with expected shape (title + items)
// This helps downstream zod validation when the model returns years without
// populated months (common when it returns summaries instead of full journals).
const ensureYearMonths = (parsed: any) => {
  if (!parsed || !Array.isArray(parsed.years)) return parsed;
  const monthTitles: string[] = Array.isArray(parsed.months)
    ? parsed.months.map((m: any) => String(m))
    : [
        "4月",
        "5月",
        "6月",
        "7月",
        "8月",
        "9月",
        "10月",
        "11月",
        "12月",
        "1月",
        "2月",
        "3月",
      ];

  parsed.years = parsed.years.map((y: any) => {
    if (!y || typeof y !== "object") return y;
    if (!Array.isArray(y.months) || y.months.length === 0) {
      y.months = monthTitles.map((t) => ({ title: t, items: [] }));
    } else {
      // Normalize existing months to have title + items
      y.months = y.months.map((m: any) => {
        if (!m || typeof m !== "object")
          return { title: String(m || ""), items: [] };
        if (!Array.isArray(m.items)) m.items = [];
        if (!m.title) m.title = String(m.title || "");
        return m;
      });
    }
    return y;
  });
  return parsed;
};

const saveDebugResponse = (prefix: string, text: string) => {
  try {
    // Only attempt to write files when running under Node with a valid CWD.
    if (
      typeof process === "undefined" ||
      typeof process.cwd !== "function" ||
      !fs ||
      !path
    ) {
      logger.warn(
        "saveDebugResponse: not running in Node environment, skipping file save"
      );
      // For browser, fallback to console.debug so developer can copy-paste
      try {
        console.debug(
          "RAW_AI_RESPONSE",
          prefix,
          text.slice ? text.slice(0, 10000) : text
        );
      } catch (_e) {
        /* ignore */
      }
      return null;
    }

    // Persist raw response unconditionally when called (developer invoked on parse failure)
    const dir = path.join(process.cwd(), "debug", "failed_responses");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${prefix.replace(
      /[^a-z0-9_-]/gi,
      "_"
    )}-${Date.now()}.txt`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, text, { encoding: "utf-8" });
    logger.info("Saved raw AI response for debugging", filePath);
    return filePath;
  } catch (e) {
    logger.error("Failed to save debug response", e);
    return null;
  }
};

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  [DocumentType.BS]: "貸借対照表",
  [DocumentType.PL]: "損益計算書",
  [DocumentType.CF]: "キャッシュ・フロー計算書",
  [DocumentType.JE]: "仕訳帳",
  [DocumentType.NEWSLETTER]: "社内報",
};

// --- Autocomplete Service ---
export const autocompleteCompanyInfo = async (
  currentInput: Partial<CompanyInput>
): Promise<Partial<CompanyInput>> => {
  const ai = getClient();
  activityLogger.logEvent("function_call", {
    function: "autocompleteCompanyInfo",
    companyName: currentInput.name || null,
    note: "user-triggered autocomplete",
  });
  const tPromptStart = nowMs();
  const prompt = `
    以下の企業情報の空欄部分を、整合性が取れるようにリアルに埋めてください。
    これは中小企業シミュレーション用です。
    **重要**: 甘い想定は捨ててください。日本の中小企業は常に苦境（人手不足、後継者難、価格競争）にあります。

    現在の入力:
    会社名: ${currentInput.name}
    業界: ${currentInput.industry}
    設立年: ${currentInput.foundedYear}
    初期社員数: ${currentInput.initialEmployees}
    社長ペルソナ: ${currentInput.persona}
    重要イベント: ${currentInput.keyEvents}

    出力は以下のJSON形式のみ:
    {
      "name": "string",
      "industry": "string",
      "foundedYear": number,
      "initialEmployees": number,
      "currentEmployees": number,
      "persona": "string (3行程度の詳細な性格・経営スタイル)",
      "keyEvents": "string (創業から現在までの苦難の歴史。社長交代があればその年も明記)",
      "ceoHistory": [
        { "name": "初代社長名", "resignationYear": 2010 },
        { "name": "二代目社長名", "resignationYear": "" }
      ]
    }
    ※ceoHistory: 設立が古い場合は必ず世代交代させてください。resignationYearが空文字なら現職。
  `;
  const tPromptDone = nowMs();

  try {
    const promptBuildMs = Math.round(tPromptDone - tPromptStart);
    activityLogger.logEvent("api_request_sent", {
      caller: "autocompleteCompanyInfo",
      model: "gemini-2.5-flash",
      promptPreview: (currentInput.name || "").slice(0, 200),
      promptBuildMs,
      ts: new Date().toISOString(),
    });

    const apiRequestT0 = nowMs();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const apiResponseTime = Math.round(nowMs() - apiRequestT0);
    activityLogger.logEvent("api_response_received", {
      caller: "autocompleteCompanyInfo",
      model: "gemini-2.5-flash",
      promptBuildMs,
      requestRoundtripMs: apiResponseTime,
      durationMs: apiResponseTime,
      respLength: response?.text?.length || 0,
      tokens: (response as any)?.usage?.totalTokens || null,
    });

    let filled: any = null;
    try {
      filled = JSON.parse(response.text.trim());
    } catch (e) {
      logger.warn(
        "autocompleteCompanyInfo: JSON.parse failed, attempting safeParseJson",
        e
      );
      if (typeof response.text === "string") {
        filled = safeParseJson(response.text);
      } else {
        filled = response.text;
      }
      if (!filled) {
        const saved = saveDebugResponse(
          "autocompleteCompanyInfo",
          response.text || ""
        );
        activityLogger.logEvent("parse_error", {
          function: "autocompleteCompanyInfo",
          savedResponsePath: saved,
        });
        throw new Error(
          `Failed to parse autocomplete response as JSON. Raw response saved: ${
            saved || "(not saved)"
          }`
        );
      }
    }
    return {
      name: currentInput.name || filled.name,
      industry: currentInput.industry || filled.industry,
      foundedYear: currentInput.foundedYear || filled.foundedYear,
      initialEmployees:
        currentInput.initialEmployees || filled.initialEmployees,
      currentEmployees:
        currentInput.currentEmployees || filled.currentEmployees,
      persona: currentInput.persona || filled.persona,
      keyEvents: currentInput.keyEvents || filled.keyEvents,
      ceoHistory:
        currentInput.ceoHistory &&
        currentInput.ceoHistory.length > 1 &&
        currentInput.ceoHistory[0].name
          ? currentInput.ceoHistory
          : filled.ceoHistory,
    };
  } catch (e) {
    logger.error("Autocomplete failed", e);
    activityLogger.logEvent("function_error", {
      function: "autocompleteCompanyInfo",
      error: String(e),
    });
    return currentInput;
  }
};

// --- History Generation ---
export const generateCompanyHistory = async (
  input: CompanyInput
): Promise<YearlyData[]> => {
  const ai = getClient();
  logger.info(
    "Starting generateCompanyHistory",
    input.name,
    input.foundedYear,
    input.currentYear
  );
  activityLogger.logEvent("function_call", {
    function: "generateCompanyHistory",
    companyName: input.name,
    range: `${input.foundedYear}-${input.currentYear}`,
  });
  const endYear = Number(input.currentYear) || new Date().getFullYear();
  const startYear = Number(input.foundedYear);

  const tPromptStart = nowMs();
  const prompt = `
    あなたは日本のSME（中小企業）に精通した経営コンサルタントです。
    以下の企業の、**非常にシビアでリアルな**財務・経営の歴史を作成してください。

    対象企業: ${input.name} (${startYear}年設立, ${input.industry})
    ペルソナ: ${input.persona}
    特記事項: ${input.keyEvents}

    【絶対的な制約】
    1. **デフォルトは「苦境」**: 何も指示がなければ、売上は横ばいか微減、利益率は1-2%のカツカツの状態にしてください。順調に右肩上がりの成長をする中小企業など稀です。
    2. **危機を必ず反映**:
       - 2008 リーマン: 売上20%減、赤字転落。
       - 2011 震災: サプライチェーン混乱。
       - 2020 コロナ: 業種によるが基本は大打撃。
       - 2022-24 インフレ・円安: 売上は価格転嫁で増えても、粗利・営業利益は激減させてください。
    3. **数字の整合性**:
       - PL: 売上 - 原価 = 粗利。粗利 - 販管費 = 営業利益。
       - BS: 資産 = 負債 + 純資産。必ず一致させること。
       - CF: 営業利益と営業CFのズレ（減価償却、運転資金増減）を考慮。

    出力: ${startYear}年から${endYear}年までのJSON配列。
    単位は全て「百万円」。

    Schema:
    [
      {
        "year": number,
        "revenue": number,
        "operatingProfit": number,
        "cashFlow": number,
        "employees": number,
        "marketContext": "string",
        "companyEvent": "string",
        "financials": {
          "sales": number, "cogs": number, "grossProfit": number, "sga": number, "operatingProfit": number,
          "nonOperatingIncome": number, "nonOperatingExpenses": number, "ordinaryProfit": number,
          "extraordinaryIncome": number, "extraordinaryLoss": number, "preTaxProfit": number, "tax": number, "netProfit": number,
          "currentAssets": { "cash": number, "notesReceivable": number, "accountsReceivable": number, "inventory": number, "other": number },
          "fixedAssets": { "tangible": number, "intangible": number, "investments": number },
          "totalAssets": number,
          "currentLiabilities": { "notesPayable": number, "accountsPayable": number, "shortTermDebt": number, "other": number },
          "fixedLiabilities": { "longTermDebt": number, "other": number },
          "totalLiabilities": number,
          "netAssets": { "capitalStock": number, "retainedEarnings": number, "other": number },
          "totalNetAssets": number,
          "operatingCF": number, "investingCF": number, "financingCF": number, "cashAtBeginning": number, "cashAtEnd": number
        }
      }
    ]
  `;

  const tPromptDone = nowMs();

  try {
    const promptBuildMs = Math.round(tPromptDone - tPromptStart);
    activityLogger.logEvent("api_request_sent", {
      caller: "generateCompanyHistory",
      model: "gemini-2.5-flash",
      years: `${input.foundedYear}-${input.currentYear}`,
      promptBuildMs,
    });
    const apiRequestT0 = nowMs();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    const apiResponseTime = Math.round(nowMs() - apiRequestT0);
    activityLogger.logEvent("api_response_received", {
      caller: "generateCompanyHistory",
      model: "gemini-2.5-flash",
      promptBuildMs,
      requestRoundtripMs: apiResponseTime,
      durationMs: apiResponseTime,
      respLength: response?.text?.length || 0,
      tokens: (response as any)?.usage?.totalTokens || null,
    });

    let parsed: any = null;
    try {
      parsed = JSON.parse(response.text.trim());
    } catch (e) {
      logger.warn(
        "generateCompanyHistory: JSON.parse failed, attempting safeParseJson",
        e
      );
      if (typeof response.text === "string") {
        parsed = safeParseJson(response.text);
      } else {
        parsed = response.text;
      }
      if (!parsed) {
        const saved = saveDebugResponse(
          "generateCompanyHistory",
          response.text || ""
        );
        logger.error(
          "generateCompanyHistory: failed to parse AI response as JSON",
          { saved }
        );
        activityLogger.logEvent("parse_error", {
          function: "generateCompanyHistory",
          savedResponsePath: saved,
        });
        throw new Error(
          `Failed to parse generateCompanyHistory response as JSON. Raw response saved: ${
            saved || "(not saved)"
          }`
        );
      }
    }

    // Validate & normalize each year's detailed financials so downstream
    // local generation (BS/PL/CF) can rely on consistent numbers.
    const normalizeYear = (y: YearlyData): YearlyData => {
      if (!y.financials) return y;
      const f = y.financials;

      // Recalculate PL derived fields if possible
      try {
        f.grossProfit = Number(f.sales - f.cogs || f.grossProfit || 0);
      } catch (e) {
        f.grossProfit = f.grossProfit || 0;
      }

      try {
        f.operatingProfit = Number(
          f.grossProfit - f.sga || f.operatingProfit || 0
        );
      } catch (e) {
        f.operatingProfit = f.operatingProfit || 0;
      }

      try {
        f.ordinaryProfit = Number(
          f.operatingProfit +
            (f.nonOperatingIncome || 0) -
            (f.nonOperatingExpenses || 0) ||
            f.ordinaryProfit ||
            0
        );
      } catch (e) {
        f.ordinaryProfit = f.ordinaryProfit || 0;
      }

      try {
        f.preTaxProfit = Number(
          f.ordinaryProfit +
            (f.extraordinaryIncome || 0) -
            (f.extraordinaryLoss || 0) ||
            f.preTaxProfit ||
            0
        );
      } catch (e) {
        f.preTaxProfit = f.preTaxProfit || 0;
      }

      // If tax not provided, estimate conservatively (30% on positive pre-tax)
      if (typeof f.tax !== "number" || isNaN(f.tax)) {
        f.tax =
          f.preTaxProfit > 0 ? Math.round(f.preTaxProfit * 0.3 * 100) / 100 : 0;
      }

      try {
        f.netProfit = Number(f.preTaxProfit - f.tax || f.netProfit || 0);
      } catch (e) {
        f.netProfit = f.netProfit || 0;
      }

      // Recalculate asset/liability subtotals
      const currentAssetsSum = Object.values(f.currentAssets || {}).reduce(
        (a: number, b: any) => a + Number(b || 0),
        0
      );
      const fixedAssetsSum = Object.values(f.fixedAssets || {}).reduce(
        (a: number, b: any) => a + Number(b || 0),
        0
      );
      f.totalAssets = Number(currentAssetsSum + fixedAssetsSum);

      const currentLiabSum = Object.values(f.currentLiabilities || {}).reduce(
        (a: number, b: any) => a + Number(b || 0),
        0
      );
      const fixedLiabSum = Object.values(f.fixedLiabilities || {}).reduce(
        (a: number, b: any) => a + Number(b || 0),
        0
      );
      f.totalLiabilities = Number(currentLiabSum + fixedLiabSum);

      const netAssetsSum = Object.values(f.netAssets || {}).reduce(
        (a: number, b: any) => a + Number(b || 0),
        0
      );
      // Ensure totalNetAssets consistent with asset/liability balance. If mismatch, adjust retainedEarnings.
      const targetNetAssets = Number(f.totalAssets - f.totalLiabilities);
      f.totalNetAssets = targetNetAssets;

      // Preserve capitalStock and other if present, and set retainedEarnings to reconcile
      const capital = Number(f.netAssets?.capitalStock || 0);
      const otherNet = Number(f.netAssets?.other || 0);
      f.netAssets.retainedEarnings = Number(
        targetNetAssets - capital - otherNet
      );

      // Recalculate cashAtEnd from CF if available
      if (
        typeof f.cashAtBeginning === "number" &&
        typeof f.operatingCF === "number" &&
        typeof f.investingCF === "number" &&
        typeof f.financingCF === "number"
      ) {
        f.cashAtEnd = Number(
          f.cashAtBeginning + f.operatingCF + f.investingCF + f.financingCF
        );
      }

      // Final defensive conversion to numbers for all numeric fields used downstream
      const toNum = (v: any) =>
        Number(typeof v === "string" && v.trim() === "" ? 0 : v || 0);
      f.sales = toNum(f.sales);
      f.cogs = toNum(f.cogs);
      f.sga = toNum(f.sga);
      f.nonOperatingIncome = toNum(f.nonOperatingIncome);
      f.nonOperatingExpenses = toNum(f.nonOperatingExpenses);
      f.extraordinaryIncome = toNum(f.extraordinaryIncome);
      f.extraordinaryLoss = toNum(f.extraordinaryLoss);
      f.operatingCF = toNum(f.operatingCF);
      f.investingCF = toNum(f.investingCF);
      f.financingCF = toNum(f.financingCF);

      logger.debug("Normalized year financials", y.year, f);
      return { ...y, financials: f };
    };

    logger.info(
      "Generated company history",
      input.name,
      parsed.length,
      "years"
    );
    return parsed.map(normalizeYear);
  } catch (error) {
    logger.error("Error generating history:", error);
    throw error;
  }
};

// --- Local Financials Generation (Instant) ---
export const generateLocalFinancialDocuments = (
  yearData: YearlyData,
  type: DocumentType
): GeneratedDocument => {
  const f = yearData.financials;
  if (!f) throw new Error("Detailed financials missing");

  let sections: FinancialSection[] = [];

  if (type === DocumentType.BS) {
    sections = [
      {
        title: "資産の部",
        items: [
          { label: "流動資産", value: "", isTotal: true },
          { label: "現金及び預金", value: f.currentAssets.cash, indent: 1 },
          {
            label: "受取手形",
            value: f.currentAssets.notesReceivable,
            indent: 1,
          },
          {
            label: "売掛金",
            value: f.currentAssets.accountsReceivable,
            indent: 1,
          },
          { label: "棚卸資産", value: f.currentAssets.inventory, indent: 1 },
          { label: "その他", value: f.currentAssets.other, indent: 1 },
          {
            label: "流動資産合計",
            value: Object.values(f.currentAssets).reduce((a, b) => a + b, 0),
            isTotal: true,
            indent: 1,
          },
          { label: "固定資産", value: "", isTotal: true },
          { label: "有形固定資産", value: f.fixedAssets.tangible, indent: 1 },
          { label: "無形固定資産", value: f.fixedAssets.intangible, indent: 1 },
          {
            label: "投資その他の資産",
            value: f.fixedAssets.investments,
            indent: 1,
          },
          {
            label: "固定資産合計",
            value: Object.values(f.fixedAssets).reduce((a, b) => a + b, 0),
            isTotal: true,
            indent: 1,
          },
          { label: "資産合計", value: f.totalAssets, isTotal: true },
        ],
      },
      {
        title: "負債の部",
        items: [
          { label: "流動負債", value: "", isTotal: true },
          {
            label: "支払手形",
            value: f.currentLiabilities.notesPayable,
            indent: 1,
          },
          {
            label: "買掛金",
            value: f.currentLiabilities.accountsPayable,
            indent: 1,
          },
          {
            label: "短期借入金",
            value: f.currentLiabilities.shortTermDebt,
            indent: 1,
          },
          { label: "その他", value: f.currentLiabilities.other, indent: 1 },
          {
            label: "流動負債合計",
            value:
              f.totalLiabilities -
              Object.values(f.fixedLiabilities).reduce((a, b) => a + b, 0),
            isTotal: true,
            indent: 1,
          },
          { label: "固定負債", value: "", isTotal: true },
          {
            label: "長期借入金",
            value: f.fixedLiabilities.longTermDebt,
            indent: 1,
          },
          { label: "その他", value: f.fixedLiabilities.other, indent: 1 },
          {
            label: "固定負債合計",
            value: Object.values(f.fixedLiabilities).reduce((a, b) => a + b, 0),
            isTotal: true,
            indent: 1,
          },
          { label: "負債合計", value: f.totalLiabilities, isTotal: true },
        ],
      },
      {
        title: "純資産の部",
        items: [
          { label: "株主資本", value: "", isTotal: true },
          { label: "資本金", value: f.netAssets.capitalStock, indent: 1 },
          {
            label: "利益剰余金",
            value: f.netAssets.retainedEarnings,
            indent: 1,
          },
          { label: "純資産合計", value: f.totalNetAssets, isTotal: true },
          {
            label: "負債純資産合計",
            value: f.totalLiabilities + f.totalNetAssets,
            isTotal: true,
          },
        ],
      },
    ];
  } else if (type === DocumentType.PL) {
    sections = [
      {
        title: "損益計算書",
        items: [
          { label: "売上高", value: f.sales },
          { label: "売上原価", value: f.cogs },
          { label: "売上総利益", value: f.grossProfit, isTotal: true },
          { label: "販売費及び一般管理費", value: f.sga },
          { label: "営業利益", value: f.operatingProfit, isTotal: true },
          { label: "営業外収益", value: f.nonOperatingIncome },
          { label: "営業外費用", value: f.nonOperatingExpenses },
          { label: "経常利益", value: f.ordinaryProfit, isTotal: true },
          { label: "特別利益", value: f.extraordinaryIncome },
          { label: "特別損失", value: f.extraordinaryLoss },
          { label: "税引前当期純利益", value: f.preTaxProfit, isTotal: true },
          { label: "法人税、住民税及び事業税", value: f.tax },
          { label: "当期純利益", value: f.netProfit, isTotal: true },
        ],
      },
    ];
  } else if (type === DocumentType.CF) {
    sections = [
      {
        title: "キャッシュ・フロー計算書",
        items: [
          {
            label: "営業活動によるキャッシュ・フロー",
            value: f.operatingCF,
            isTotal: true,
          },
          {
            label: "投資活動によるキャッシュ・フロー",
            value: f.investingCF,
            isTotal: true,
          },
          {
            label: "財務活動によるキャッシュ・フロー",
            value: f.financingCF,
            isTotal: true,
          },
          {
            label: "現金及び現金同等物の増減額",
            value: f.operatingCF + f.investingCF + f.financingCF,
            isTotal: true,
          },
          { label: "現金及び現金同等物の期首残高", value: f.cashAtBeginning },
          {
            label: "現金及び現金同等物の期末残高",
            value: f.cashAtEnd,
            isTotal: true,
          },
        ],
      },
    ];
  }

  return {
    id: `${yearData.year}-${type}`,
    type,
    year: yearData.year,
    title: `${DOC_TYPE_LABELS[type]}`,
    content: { sections },
  };
};

// --- Bulk Generation (chunked, using Gemini native structured output) ---
export const generateBulkDocuments = async (
  company: CompanyInput,
  history: YearlyData[],
  type: DocumentType,
  preferredModel?: string
): Promise<GeneratedDocument[]> => {
  const ai = getClient();
  const results: GeneratedDocument[] = [];

  // Chunk history into groups to avoid token limits; configurable via VITE_CHUNK_YEARS
  const _envChunk =
    typeof process !== "undefined" && process.env?.VITE_CHUNK_YEARS
      ? process.env.VITE_CHUNK_YEARS
      : typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_CHUNK_YEARS
      : undefined;
  const CHUNK_YEARS = Number(_envChunk ?? 10) || 10;
  const chunks = chunkArray(history, CHUNK_YEARS);

  logger.info("generateBulkDocuments started", {
    type,
    totalYears: history.length,
    chunkSize: CHUNK_YEARS,
    numChunks: chunks.length,
  });

  if (type === DocumentType.JE) {
    for (const chunk of chunks) {
      const yearsContext = chunk
        .map(
          (y) =>
            `Year:${y.year} Rev:${y.revenue}M Profit:${y.operatingProfit}M Event:${y.companyEvent}`
        )
        .join("\n");

      const prompt = `あなたは日本の中小企業の経理担当です。
会社名: ${company.name}

以下の年度について、月次合計仕訳を生成してください。各年度は4月〜3月の12ヶ月分です。

【対象年度データ】
${yearsContext}

【出力形式】
- 各年度ごとに12ヶ月分の仕訳を含める
- 各月に5件程度の代表的な仕訳を記載
- 金額は円単位（百万円ではない）
- 売上・仕入・給与・家賃・減価償却などの典型的な仕訳を含める`;

      const modelToUse = preferredModel || "gemini-2.5-flash";
      const requestId = `JE-${chunk
        .map((c) => c.year)
        .join("-")}-${Date.now()}`;

      logger.info(`[${requestId}] Bulk JE request start`, {
        model: modelToUse,
        years: chunk.map((c) => c.year),
      });

      activityLogger.logEvent("api_request_sent", {
        caller: "generateBulkDocuments:JE",
        requestId,
        model: modelToUse,
        years: chunk.map((c) => c.year),
        prompt: prompt.slice(0, 500),
      });

      try {
        const apiRequestT0 = nowMs();
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: JE_BULK_SCHEMA,
          },
        });
        const duration = Math.round(nowMs() - apiRequestT0);

        logger.info(`[${requestId}] Bulk JE response received`, {
          durationMs: duration,
          respLength: response.text?.length || 0,
        });

        activityLogger.logEvent("api_response_received", {
          caller: "generateBulkDocuments:JE",
          requestId,
          durationMs: duration,
          respLength: response.text?.length || 0,
        });

        // Parse response
        let parsed: any = null;
        try {
          parsed = JSON.parse(response.text?.trim() || "{}");
        } catch (e) {
          logger.warn(
            `[${requestId}] JSON.parse failed, trying safeParseJson`,
            e
          );
          parsed = safeParseJson(response.text || "");
        }

        // Validate and transform
        if (parsed?.years && Array.isArray(parsed.years)) {
          for (const y of parsed.years) {
            if (!y.year || !Array.isArray(y.months)) continue;

            const sections = y.months.map((m: any) => ({
              title: m.title || "",
              breakPage: false,
              headers: ["日付", "借方", "金額", "貸方", "金額", "摘要"],
              items: (m.items || []).map((it: any) => ({
                date: it.date || "",
                account: it.account || "",
                debit: Number(it.debit) || 0,
                credit: Number(it.credit) || 0,
                label: it.label || "",
              })),
            }));

            results.push({
              id: `${DocumentType.JE}-${y.year}`,
              type: DocumentType.JE,
              year: y.year,
              title: `仕訳帳 ${y.year}年3月期`,
              content: { sections },
            });
            logger.debug(`[${requestId}] Added JE document for year ${y.year}`);
          }
        } else {
          throw new Error("Invalid response structure: missing years array");
        }
      } catch (err) {
        logger.error(`[${requestId}] Bulk JE generation failed`, err);
        const saved = saveDebugResponse(requestId, String(err));
        activityLogger.logEvent("parse_error", {
          function: "generateBulkDocuments:JE",
          requestId,
          error: String(err),
          savedResponsePath: saved,
        });

        // Fallback: generate placeholder docs for this chunk
        for (const y of chunk) {
          results.push({
            id: `${DocumentType.JE}-${y.year}`,
            type: DocumentType.JE,
            year: y.year,
            title: `仕訳帳 ${y.year}年3月期 (生成失敗)`,
            content: { sections: generateFallbackJESections(y) },
          });
        }
      }

      // Rate limit delay between chunks
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await delay(1500);
      }
    }
  } else if (type === DocumentType.NEWSLETTER) {
    for (const chunk of chunks) {
      const yearsContext = chunk
        .map(
          (y) =>
            `${y.year}年: 売上${y.revenue}百万円, 営業利益${y.operatingProfit}百万円, 出来事「${y.companyEvent}」`
        )
        .join("\n");

      const prompt = `あなたは日本の中小企業の社長です。
会社名: ${company.name}
業種: ${company.industry}

以下の各年度について、社内報に掲載する社長メッセージを作成してください。

【対象年度】
${yearsContext}

【執筆ガイドライン】
- 赤字の年は厳しい現実を認めつつ再建への決意を示す
- 黒字の年は慎重な楽観と感謝を表現
- 200〜400文字程度の日本語テキスト
- 形式的すぎない、人間味のある文章

【重要：出力フォーマット】
contentフィールドには、純粋な日本語テキストのみを返してください。
- Markdownの見出し（# ## ###）や箇条書き（- *）は使用しないでください
- 段落の区切りは改行2つで表現してください
- 特殊文字やエンコードされた文字は使用しないでください
- UTF-8の日本語テキストのみを返してください`;

      const modelToUse = preferredModel || "gemini-2.5-flash";
      const requestId = `NEWS-${chunk
        .map((c) => c.year)
        .join("-")}-${Date.now()}`;

      logger.info(`[${requestId}] Bulk NEWSLETTER request start`, {
        model: modelToUse,
        years: chunk.map((c) => c.year),
      });

      activityLogger.logEvent("api_request_sent", {
        caller: "generateBulkDocuments:NEWSLETTER",
        requestId,
        model: modelToUse,
        years: chunk.map((c) => c.year),
        prompt: prompt.slice(0, 500),
      });

      try {
        const apiRequestT0 = nowMs();
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: NEWSLETTER_BULK_SCHEMA,
          },
        });
        const duration = Math.round(nowMs() - apiRequestT0);

        logger.info(`[${requestId}] Bulk NEWSLETTER response received`, {
          durationMs: duration,
          respLength: response.text?.length || 0,
        });

        activityLogger.logEvent("api_response_received", {
          caller: "generateBulkDocuments:NEWSLETTER",
          requestId,
          durationMs: duration,
          respLength: response.text?.length || 0,
        });

        // Parse response
        let parsed: any = null;
        try {
          parsed = JSON.parse(response.text?.trim() || "{}");
        } catch (e) {
          logger.warn(
            `[${requestId}] JSON.parse failed, trying safeParseJson`,
            e
          );
          parsed = safeParseJson(response.text || "");
        }

        // Validate and transform
        if (parsed?.newsletters && Array.isArray(parsed.newsletters)) {
          for (const n of parsed.newsletters) {
            if (!n.year || !n.content) continue;

            results.push({
              id: `${DocumentType.NEWSLETTER}-${n.year}`,
              type: DocumentType.NEWSLETTER,
              year: n.year,
              title: `社内報 ${n.year}年`,
              content: n.content,
            });
            logger.debug(`[${requestId}] Added NEWSLETTER for year ${n.year}`);
          }
        } else {
          throw new Error(
            "Invalid response structure: missing newsletters array"
          );
        }
      } catch (err) {
        logger.error(`[${requestId}] Bulk NEWSLETTER generation failed`, err);
        const saved = saveDebugResponse(requestId, String(err));
        activityLogger.logEvent("parse_error", {
          function: "generateBulkDocuments:NEWSLETTER",
          requestId,
          error: String(err),
          savedResponsePath: saved,
        });

        // Fallback: generate placeholder docs for this chunk
        for (const y of chunk) {
          results.push({
            id: `${DocumentType.NEWSLETTER}-${y.year}`,
            type: DocumentType.NEWSLETTER,
            year: y.year,
            title: `社内報 ${y.year}年 (生成失敗)`,
            content: `${y.year}年の社内報は生成に失敗しました。`,
          });
        }
      }

      // Rate limit delay between chunks
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await delay(1500);
      }
    }
  } else {
    // For other types, fallback to per-year generation
    for (const y of history) {
      try {
        const doc = await generateSingleDocument(company, y, type);
        results.push(doc);
      } catch (e) {
        logger.error("Per-year generation failed for type", type, e);
      }
    }
  }

  logger.info("generateBulkDocuments completed", {
    type,
    totalGenerated: results.length,
  });

  return results;
};

// Helper: Generate fallback JE sections when API fails
const generateFallbackJESections = (yearData: YearlyData) => {
  const monthNames = [
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
    "1月",
    "2月",
    "3月",
  ];
  const monthlyRevenue = Math.round(
    ((yearData.revenue || 100) * 1_000_000) / 12
  );

  return monthNames.map((title) => ({
    title,
    breakPage: false,
    headers: ["日付", "借方", "金額", "貸方", "金額", "摘要"],
    items: [
      {
        date: "月末",
        account: "売掛金",
        debit: monthlyRevenue,
        credit: 0,
        label: "月次売上",
      },
      {
        date: "月末",
        account: "売上",
        debit: 0,
        credit: monthlyRevenue,
        label: "月次売上計上",
      },
    ],
  }));
};

// --- Single Document Generation (Heavy docs: JE, Newsletter) ---
const generateSingleDocument = async (
  company: CompanyInput,
  yearData: YearlyData,
  type: DocumentType
): Promise<GeneratedDocument> => {
  const ai = getClient();

  // Find CEO
  const activeCeo =
    company.ceoHistory.find((c) => {
      if (c.resignationYear === "") return true;
      return yearData.year <= Number(c.resignationYear);
    }) || company.ceoHistory[company.ceoHistory.length - 1];

  const basePrompt = `
    Company: ${company.name}, Year: ${yearData.year}, CEO: ${activeCeo.name}
    Rev: ${yearData.revenue}M, Profit: ${yearData.operatingProfit}M
    Event: ${yearData.companyEvent}
  `;

  if (type === DocumentType.NEWSLETTER) {
    const tPromptStart = nowMs();
    const prompt = `
      ${basePrompt}
      Write a realistic Japanese company newsletter (社内報) message from the CEO.
      Tone: ${
        yearData.operatingProfit < 0
          ? "Serious, apologizing but hopeful"
          : "Cautious optimism"
      }.
      Format: Markdown. Insert blank lines between paragraphs.
    `;
    const tPromptDone = nowMs();
    const promptBuildMs = Math.round(tPromptDone - tPromptStart);
    try {
      console.log(
        `AI PROMPT (generateSingleDocument:NEWSLETTER) year=${yearData.year}:`,
        prompt
      );
    } catch (e) {
      /* ignore */
    }
    const apiRequestT0 = nowMs();
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    const apiRoundtripMs = Math.round(nowMs() - apiRequestT0);
    activityLogger.logEvent("api_response_received", {
      caller: "generateSingleDocument:NEWSLETTER",
      model: "gemini-2.5-flash",
      promptBuildMs,
      requestRoundtripMs: apiRoundtripMs,
      respLength: res.text?.length || 0,
      tokens: (res as any)?.usage?.totalTokens || null,
    });
    return {
      id: `${type}-${yearData.year}`,
      type,
      year: yearData.year,
      title: `社内報 ${yearData.year}年`,
      content: res.text || "Error",
    };
  }

  if (type === DocumentType.JE) {
    const prompt = `
      ${basePrompt}
      Generate "Monthly Summary Journal Entries" (月次合計仕訳) for April ${
        yearData.year - 1
      } to March ${yearData.year}.
      Output JSON. 12 sections (Apr-Mar). ~5 summary entries per month.
      Values in YEN.
      STRICT: Output ONLY valid JSON with structure:
      { "sections": [ { "title": "4月", "breakPage": true, "headers": ["日付","借方","金額","貸方","金額","摘要"], "items": [{"date":"4/30","account":"...","debit":100,"credit":0,"label":"..."}] } ] }
      If no data is available, return empty arrays but keep the structure (do not return plain text).
    `;

    try {
      const tPromptStart = nowMs();
      // prompt built above as `prompt`
      const tPromptDone = nowMs();
      const promptBuildMs = Math.round(tPromptDone - tPromptStart);
      try {
        console.log(
          `AI PROMPT (generateSingleDocument:JE) year=${yearData.year}:`,
          prompt
        );
      } catch (e) {
        /* ignore */
      }
      const apiRequestT0 = nowMs();
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      const apiRoundtripMs = Math.round(nowMs() - apiRequestT0);
      activityLogger.logEvent("api_response_received", {
        caller: `generateSingleDocument:JE:${yearData.year}`,
        model: "gemini-2.5-flash",
        promptBuildMs,
        requestRoundtripMs: apiRoundtripMs,
        respLength: res.text?.length || 0,
        tokens: (res as any)?.usage?.totalTokens || null,
      });

      let parsed: any = null;
      try {
        parsed = JSON.parse(res.text.trim());
      } catch (e) {
        logger.warn(
          `JE: AI returned non-JSON for ${yearData.year}, attempting safeParseJson`,
          e
        );
        if (typeof res.text === "string") parsed = safeParseJson(res.text);
        else parsed = res.text;
        if (!parsed) {
          const saved = saveDebugResponse(
            `JE-${yearData.year}`,
            res.text || ""
          );
          logger.error(
            "JE: failed to parse AI response and safeParseJson returned null",
            { saved }
          );
        }
      }

      const hasSections =
        parsed &&
        Array.isArray(parsed.sections) &&
        parsed.sections.length > 0 &&
        parsed.sections.some(
          (s: any) => Array.isArray(s.items) && s.items.length > 0
        );

      if (!hasSections) {
        // Fallback: create 12 months Apr (year-1) to Mar (year)
        const months = [] as any[];
        const monthNamesJP = [
          "4月",
          "5月",
          "6月",
          "7月",
          "8月",
          "9月",
          "10月",
          "11月",
          "12月",
          "1月",
          "2月",
          "3月",
        ];
        const yearlyRevenueYen = Math.round(
          (yearData.revenue || 0) * 1_000_000
        );
        const monthlyRevenueYen = Math.round(yearlyRevenueYen / 12);

        for (let i = 0; i < 12; i++) {
          const title = monthNamesJP[i];
          const items = [
            {
              date: `${i + 1}月末`,
              account: "売掛金",
              debit: monthlyRevenueYen,
              credit: 0,
              label: "月間売上(概算)",
            },
            {
              date: `${i + 1}月末`,
              account: "売上",
              debit: 0,
              credit: monthlyRevenueYen,
              label: "月間売上計上(概算)",
            },
          ];
          months.push({
            title,
            breakPage: false,
            headers: ["日付", "借方", "金額", "貸方", "金額", "摘要"],
            items,
          });
        }

        return {
          id: `${type}-${yearData.year}`,
          type,
          year: yearData.year,
          title: `仕訳帳 ${yearData.year}年3月期`,
          content: { sections: months },
        };
      }

      return {
        id: `${type}-${yearData.year}`,
        type,
        year: yearData.year,
        title: `仕訳帳 ${yearData.year}年3月期`,
        content: parsed,
      };
    } catch (e) {
      logger.error("JE generation failed, falling back to synthesized JE", e);
      const months = [] as any[];
      const monthNamesJP = [
        "4月",
        "5月",
        "6月",
        "7月",
        "8月",
        "9月",
        "10月",
        "11月",
        "12月",
        "1月",
        "2月",
        "3月",
      ];
      const yearlyRevenueYen = Math.round((yearData.revenue || 0) * 1_000_000);
      const monthlyRevenueYen = Math.round(yearlyRevenueYen / 12);
      for (let i = 0; i < 12; i++) {
        const title = monthNamesJP[i];
        const items = [
          {
            date: `${i + 1}月末`,
            account: "売掛金",
            debit: monthlyRevenueYen,
            credit: 0,
            label: "月間売上(概算)",
          },
          {
            date: `${i + 1}月末`,
            account: "売上",
            debit: 0,
            credit: monthlyRevenueYen,
            label: "月間売上計上(概算)",
          },
        ];
        months.push({
          title,
          breakPage: false,
          headers: ["日付", "借方", "金額", "貸方", "金額", "摘要"],
          items,
        });
      }
      return {
        id: `${type}-${yearData.year}`,
        type,
        year: yearData.year,
        title: `仕訳帳 ${yearData.year}年3月期`,
        content: { sections: months },
      };
    }
  }

  throw new Error("Unknown type for single generation");
};

// --- Main Batch Controller ---
export const batchGenerateDocuments = async (
  company: CompanyInput,
  history: YearlyData[],
  types: DocumentType[],
  onProgress: (completed: number, currentDoc: string) => void
): Promise<GeneratedDocument[]> => {
  const results: GeneratedDocument[] = [];

  const localTypes = types.filter((t) =>
    [DocumentType.BS, DocumentType.PL, DocumentType.CF].includes(t)
  );
  const apiTypes = types.filter(
    (t) => ![DocumentType.BS, DocumentType.PL, DocumentType.CF].includes(t)
  );

  let completedCount = 0;

  // 1. Generate Local Docs (Instant)
  for (const h of history) {
    for (const t of localTypes) {
      if (h.financials) {
        results.push(generateLocalFinancialDocuments(h, t));
      }
      completedCount++;
    }
  }

  // 2. Generate API Docs (Serial with delay)
  // 2. Generate API Docs: use bulk generation per type (chunked) to reduce requests
  const chooseModelForType = (t: DocumentType) => {
    if (t === DocumentType.JE) return "gemini-2.5-flash-lite";
    return "gemini-2.5-flash";
  };

  for (const t of apiTypes) {
    onProgress(completedCount, `Generating ${DOC_TYPE_LABELS[t]} (bulk)`);
    try {
      const model = chooseModelForType(t);
      const docs = await generateBulkDocuments(company, history, t, model);
      results.push(...docs);
      completedCount += docs.length;
    } catch (e) {
      logger.error("Bulk generationFailed for", t, e);
      // As a final fallback, attempt per-year serial generation
      for (const h of history) {
        onProgress(completedCount, `${DOC_TYPE_LABELS[t]} (${h.year})`);
        try {
          const doc = await generateSingleDocument(company, h, t);
          results.push(doc);
        } catch (err) {
          logger.error(err);
        }
        completedCount++;
        // keep a small pause to avoid accidental rate limits, reduced from 2s to 0.2s
        await delay(200);
      }
    }
  }

  onProgress(completedCount, "完了");
  return results;
};
