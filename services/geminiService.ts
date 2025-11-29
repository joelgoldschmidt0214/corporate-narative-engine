import { GoogleGenAI } from "@google/genai";
import {
  CompanyInput,
  YearlyData,
  DocumentType,
  GeneratedDocument,
  DetailedFinancials,
  FinancialSection,
} from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set process.env.API_KEY.");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper for delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const filled = JSON.parse(response.text.trim());
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
    console.error("Autocomplete failed", e);
    return currentInput;
  }
};

// --- History Generation ---
export const generateCompanyHistory = async (
  input: CompanyInput
): Promise<YearlyData[]> => {
  const ai = getClient();
  const endYear = Number(input.currentYear) || new Date().getFullYear();
  const startYear = Number(input.foundedYear);

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    const parsed: YearlyData[] = JSON.parse(response.text.trim());

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

      return { ...y, financials: f };
    };

    return parsed.map(normalizeYear);
  } catch (error) {
    console.error("Error generating history:", error);
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
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
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
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      let parsed: any = null;
      try {
        parsed = JSON.parse(res.text.trim());
      } catch (e) {
        console.warn(
          `JE: AI returned non-JSON for ${yearData.year}, falling back`,
          e
        );
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
      console.error("JE generation failed, falling back to synthesized JE", e);
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
  for (const h of history) {
    for (const t of apiTypes) {
      onProgress(completedCount, `${DOC_TYPE_LABELS[t]} (${h.year})`);
      try {
        const doc = await generateSingleDocument(company, h, t);
        results.push(doc);
      } catch (e) {
        console.error(e);
      }
      completedCount++;
      await delay(2000); // Rate limit buffer
    }
  }

  onProgress(completedCount, "完了");
  return results;
};
