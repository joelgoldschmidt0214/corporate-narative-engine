import React, { useState, useRef, useMemo } from "react";
import {
  DocumentType,
  GeneratedDocument,
  YearlyData,
  FinancialTableItem,
} from "../types";
import {
  Download,
  Check,
  Loader2,
  ArrowLeft,
  Clock,
  FileText,
} from "lucide-react";
import { batchGenerateDocuments } from "../services/geminiService";
import { generateZipPackage } from "../services/pdfService";
import { logger } from "../services/logger";
import ReactMarkdown from "react-markdown";

interface Props {
  company: any;
  history: YearlyData[];
  onBack: () => void;
}

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  [DocumentType.BS]: "貸借対照表",
  [DocumentType.PL]: "損益計算書",
  [DocumentType.CF]: "CF計算書",
  [DocumentType.JE]: "仕訳帳",
  [DocumentType.NEWSLETTER]: "社内報",
};

const DocumentGenerator: React.FC<Props> = ({ company, history, onBack }) => {
  const printContainerRef = useRef<HTMLDivElement>(null);
  const [selectedTypes, setSelectedTypes] = useState<DocumentType[]>([
    DocumentType.BS,
    DocumentType.PL,
    DocumentType.CF,
  ]);
  const [startYear, setStartYear] = useState(
    history[Math.max(0, history.length - 3)].year
  );
  const [endYear, setEndYear] = useState(history[history.length - 1].year);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generateSeconds, setGenerateSeconds] = useState(0);
  const [progress, setProgress] = useState({ currentDoc: "" });
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocument[]>([]);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");

  const [editingDoc, setEditingDoc] = useState<GeneratedDocument | null>(null);
  const [tempDocContent, setTempDocContent] = useState<any>(null);

  const toggleType = (type: DocumentType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerateSeconds(0);
    setGeneratedDocs([]);
    const targetHistory = history.filter(
      (h) => h.year >= startYear && h.year <= endYear
    );

    try {
      logger.info("Starting document batch generation", {
        company: company?.name,
        years: `${startYear}-${endYear}`,
        types: selectedTypes,
      });
      const start = Date.now();
      const timer = setInterval(
        () => setGenerateSeconds(Math.floor((Date.now() - start) / 1000)),
        1000
      );

      const docs = await batchGenerateDocuments(
        company,
        targetHistory,
        selectedTypes,
        (completed, currentDoc) => {
          setProgress({ currentDoc });
          logger.info("Generation progress", completed, currentDoc);
        }
      );
      clearInterval(timer);
      logger.info("Batch generation completed", { count: docs.length });
      setGeneratedDocs(docs);
    } catch (e) {
      logger.error("Generation failed", e);
      alert("生成エラー");
    } finally {
      setIsGenerating(false);
      setGenerateSeconds(0);
    }
  };

  const handleDownload = async (
    startIndex: number,
    endIndex: number,
    label: string
  ) => {
    if (generatedDocs.length === 0) return;
    setIsDownloading(true);
    setDownloadProgress(`準備中...`);

    const docsSubset = generatedDocs.slice(startIndex, endIndex);
    const elementIds: Record<string, string> = {};
    docsSubset.forEach((doc) => (elementIds[doc.id] = `print-${doc.id}`));

    try {
      setDownloadProgress("圧縮中...");
      const blob = await generateZipPackage(docsSubset, elementIds, (info) => {
        setDownloadProgress(
          `(${info.index}/${info.total}) ${info.docId} - ${info.stage}`
        );
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${company.name.replace(/\s+/g, "_")}_${label}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      logger.error("Download failed", e);
      alert("ダウンロード失敗");
    } finally {
      setIsDownloading(false);
      setDownloadProgress("");
    }
  };

  // --- Range Slider Logic ---
  const minYear = history[0].year;
  const maxYear = history[history.length - 1].year;

  const handleRangeChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "min" | "max"
  ) => {
    const val = Number(e.target.value);
    if (type === "min") {
      const newStart = Math.min(val, endYear);
      setStartYear(newStart);
    } else {
      const newEnd = Math.max(val, startYear);
      setEndYear(newEnd);
    }
  };

  // Calculate percentages for track highlight
  const getPercent = (value: number) =>
    Math.round(((value - minYear) / (maxYear - minYear)) * 100);
  const startPercent = getPercent(startYear);
  const endPercent = getPercent(endYear);

  // --- Calculation Stats ---
  const stats = useMemo(() => {
    const yearsCount = endYear - startYear + 1;
    const totalDocs = yearsCount * selectedTypes.length;

    // Estimation logic (chunk-aware):
    // Financials (BS/PL/CF) are generated locally (instant, 0s).
    // Heavy docs (JE, Newsletter) are requested in chunks; use Vite env VITE_CHUNK_YEARS.
    const heavyTypes = selectedTypes.filter(
      (t) => ![DocumentType.BS, DocumentType.PL, DocumentType.CF].includes(t)
    );
    const CHUNK_YEARS = Number(process.env.VITE_CHUNK_YEARS) || 5;
    const heavyCalls = Math.ceil(yearsCount / CHUNK_YEARS) * heavyTypes.length;
    const AI_ESTIMATE_SECONDS = 120; // conservative per-AI-request estimate (seconds)
    const estimatedSeconds = heavyCalls * AI_ESTIMATE_SECONDS;

    return { totalDocs, estimatedSeconds };
  }, [startYear, endYear, selectedTypes]);

  const openEditModal = (doc: GeneratedDocument) => {
    setEditingDoc(doc);
    setTempDocContent(JSON.parse(JSON.stringify(doc.content)));
  };

  const saveEdits = () => {
    if (editingDoc && tempDocContent) {
      setGeneratedDocs((prev) =>
        prev.map((d) =>
          d.id === editingDoc.id ? { ...d, content: tempDocContent } : d
        )
      );
      setEditingDoc(null);
    }
  };

  const handleTableValueChange = (
    sIdx: number,
    iIdx: number,
    val: string,
    field: "value" | "debit" | "credit" = "value"
  ) => {
    if (!tempDocContent) return;
    const newContent = { ...tempDocContent };
    const item = newContent.sections[sIdx].items[iIdx];
    if (field === "value")
      item.value = isNaN(parseFloat(val)) ? val : parseFloat(val);
    else item[field] = val;
    setTempDocContent(newContent);
  };

  const renderOfficialTable = (
    doc: GeneratedDocument,
    isEditable: boolean = false,
    contentOverride?: any
  ) => {
    const content = contentOverride || doc.content;
    const isJE = doc.type === DocumentType.JE;

    if (typeof content === "string") {
      return isEditable ? (
        <textarea
          value={content}
          onChange={(e) => setTempDocContent(e.target.value)}
          className="w-full h-full p-4 border rounded font-mono"
        />
      ) : (
        <div className="bg-white p-12 min-h-[297mm] prose prose-sm max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      );
    }

    return (
      <div className="bg-white p-12 min-h-[297mm] text-slate-900 font-serif">
        <div className="border-b-2 border-slate-800 pb-4 mb-8">
          <h1 className="text-xl font-bold">{doc.title}</h1>
          <div className="flex justify-between text-sm mt-2">
            <span>{company.name}</span>
            <span>(単位: {isJE ? "円" : "百万円"})</span>
          </div>
        </div>
        {content.sections?.map((section: any, sIdx: number) => (
          <div
            key={sIdx}
            className={section.breakPage ? "break-after-page mb-8" : "mb-8"}
          >
            {section.title && (
              <h3 className="font-bold border-b mb-2">{section.title}</h3>
            )}
            <table className="w-full text-sm border-collapse table-fixed">
              {section.headers && (
                <thead>
                  <tr className="bg-slate-50 border-b">
                    {section.headers.map((h: string, i: number) => (
                      <th key={i} className="py-1 px-2 text-left border-r">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {section.items.map((item: FinancialTableItem, iIdx: number) => (
                  <tr key={iIdx} className="border-b border-slate-100">
                    {isJE ? (
                      <>
                        <td className="p-2 w-[10%]">{item.date}</td>
                        <td className="p-2 w-[20%]">{item.account}</td>
                        <td className="p-2 text-right w-[15%] font-mono">
                          {isEditable ? (
                            <input
                              value={item.debit || ""}
                              onChange={(e) =>
                                handleTableValueChange(
                                  sIdx,
                                  iIdx,
                                  e.target.value,
                                  "debit"
                                )
                              }
                              className="w-full text-right bg-blue-50"
                            />
                          ) : (
                            Number(item.debit || 0).toLocaleString()
                          )}
                        </td>
                        <td className="w-[5%]"></td>
                        <td className="p-2 text-right w-[15%] font-mono">
                          {isEditable ? (
                            <input
                              value={item.credit || ""}
                              onChange={(e) =>
                                handleTableValueChange(
                                  sIdx,
                                  iIdx,
                                  e.target.value,
                                  "credit"
                                )
                              }
                              className="w-full text-right bg-blue-50"
                            />
                          ) : (
                            Number(item.credit || 0).toLocaleString()
                          )}
                        </td>
                        <td className="p-2 text-xs text-slate-500">
                          {item.label}
                        </td>
                      </>
                    ) : (
                      <>
                        <td
                          className="py-1 px-2"
                          style={{
                            paddingLeft: item.indent ? `${item.indent}rem` : 0,
                          }}
                        >
                          {item.label}
                        </td>
                        <td className="py-1 px-2 text-right w-40 font-mono">
                          {isEditable ? (
                            <input
                              value={item.value}
                              onChange={(e) =>
                                handleTableValueChange(
                                  sIdx,
                                  iIdx,
                                  e.target.value
                                )
                              }
                              className="w-full text-right bg-blue-50"
                            />
                          ) : (
                            item.value.toLocaleString()
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  };

  const CHUNK_SIZE = 50;
  const downloadButtons = [];
  if (generatedDocs.length > 0) {
    for (let i = 0; i < generatedDocs.length; i += CHUNK_SIZE) {
      const end = Math.min(i + CHUNK_SIZE, generatedDocs.length);
      downloadButtons.push(
        <button
          key={i}
          onClick={() =>
            handleDownload(i, end, `Part${Math.floor(i / CHUNK_SIZE) + 1}`)
          }
          disabled={isDownloading}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs shadow-md"
        >
          <Download className="w-4 h-4" />{" "}
          {end > CHUNK_SIZE || generatedDocs.length > CHUNK_SIZE
            ? `DL (${i + 1}-${end})`
            : "一括DL"}
        </button>
      );
    }
  }

  const sliderStyle = `
    .thumb-input {
      -webkit-appearance: none;
      background: transparent;
      pointer-events: none;
    }
    .thumb-input::-webkit-slider-thumb {
      pointer-events: auto;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #3b82f6;
      cursor: pointer;
      -webkit-appearance: none;
      margin-top: 0px;
      position: relative;
      z-index: 50;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .thumb-input::-moz-range-thumb {
      pointer-events: auto;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #3b82f6;
      cursor: pointer;
      border: none;
      position: relative;
      z-index: 50;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .thumb-input::-webkit-slider-runnable-track {
      background: transparent;
      height: 100%;
    }
    .thumb-input::-moz-range-track {
      background: transparent;
      height: 100%;
    }
  `;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <style>{sliderStyle}</style>

      <div className="sticky top-16 z-20 bg-white/90 backdrop-blur-md shadow-sm border-b border-slate-200 -mx-4 px-4 py-3 flex justify-between items-center">
        {generatedDocs.length > 0 ? (
          <button
            onClick={() => setGeneratedDocs([])}
            className="flex items-center gap-2 px-4 py-2 bg-white text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 font-bold text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            条件変更
          </button>
        ) : (
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 bg-white text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 font-bold text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            戻る
          </button>
        )}
        <div className="flex gap-2 items-center">
          {downloadButtons}
          {isDownloading && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{downloadProgress || "処理中..."}</span>
            </div>
          )}
        </div>
        {generatedDocs.length === 0 && (
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />{" "}
                {progress.currentDoc}
              </>
            ) : (
              "一括生成"
            )}
          </button>
        )}
      </div>

      {generatedDocs.length === 0 ? (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
          <div className="mb-8">
            <label className="block text-sm font-bold text-slate-700 mb-3">
              ドキュメント種類
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                DocumentType.BS,
                DocumentType.PL,
                DocumentType.CF,
                DocumentType.JE,
                DocumentType.NEWSLETTER,
              ].map((t) => (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`p-3 rounded-lg border-2 text-sm font-bold transition flex items-center justify-center gap-2 ${
                    selectedTypes.includes(t)
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 hover:border-blue-300"
                  }`}
                >
                  {DOC_TYPE_LABELS[t]}{" "}
                  {selectedTypes.includes(t) && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <label className="block text-sm font-bold text-slate-700">
                対象期間の設定
              </label>
              <div className="flex gap-4">
                <select
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value))}
                  className="border rounded p-1 text-sm bg-slate-50"
                >
                  {history.map((h) => (
                    <option key={h.year} value={h.year}>
                      {h.year}年
                    </option>
                  ))}
                </select>
                <span className="text-slate-400">〜</span>
                <select
                  value={endYear}
                  onChange={(e) => setEndYear(Number(e.target.value))}
                  className="border rounded p-1 text-sm bg-slate-50"
                >
                  {history.map((h) => (
                    <option key={h.year} value={h.year}>
                      {h.year}年
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Custom Dual Range Slider */}
            <div className="h-16 w-full px-4 select-none flex items-center">
              <div className="relative w-full h-2">
                {/* Background Track */}
                <div className="absolute top-0 left-0 w-full h-full bg-slate-200 rounded"></div>

                {/* Active Range Highlight */}
                <div
                  className="absolute top-0 h-full bg-blue-500 rounded z-10"
                  style={{
                    left: `${startPercent}%`,
                    right: `${100 - endPercent}%`,
                  }}
                ></div>

                {/* Inputs Overlay - Perfectly centered vertically */}
                <div className="absolute top-1/2 left-0 w-full -translate-y-1/2 h-5">
                  <input
                    type="range"
                    min={minYear}
                    max={maxYear}
                    value={startYear}
                    onChange={(e) => handleRangeChange(e, "min")}
                    className="thumb-input absolute w-full h-full top-0 left-0 m-0 p-0 z-20"
                  />
                  <input
                    type="range"
                    min={minYear}
                    max={maxYear}
                    value={endYear}
                    onChange={(e) => handleRangeChange(e, "max")}
                    className="thumb-input absolute w-full h-full top-0 left-0 m-0 p-0 z-30"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between text-xs text-slate-400 mt-0 px-1">
              <span>{minYear}年</span>
              <span>{maxYear}年</span>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-center justify-between text-blue-900">
            <div className="flex items-center gap-3">
              <div className="bg-blue-200 p-2 rounded-full">
                <FileText className="w-5 h-5 text-blue-700" />
              </div>
              <div>
                <div className="text-xs text-blue-600 font-bold uppercase tracking-wider">
                  生成対象
                </div>
                <div className="font-bold text-lg">
                  {stats.totalDocs} ドキュメント
                </div>
                <div className="text-xs text-blue-600">
                  ({endYear - startYear + 1}年分 × {selectedTypes.length}種)
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-xs text-blue-600 font-bold uppercase tracking-wider">
                <Clock className="w-3 h-3" /> 想定所要時間
              </div>
              <div className="font-bold text-lg">
                約 {stats.estimatedSeconds} 秒
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="p-3 border-b bg-slate-50 w-24 text-center">
                  年度
                </th>
                {selectedTypes.map((t) => (
                  <th key={t} className="p-3 border-b bg-slate-50 text-center">
                    {DOC_TYPE_LABELS[t]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(generatedDocs.map((d) => d.year)))
                .sort((a, b) => Number(a) - Number(b))
                .map((y) => (
                  <tr key={y} className="hover:bg-slate-50">
                    <td className="p-3 border-b font-bold text-center">{y}</td>
                    {selectedTypes.map((t) => {
                      const doc = generatedDocs.find(
                        (d) => d.year === y && d.type === t
                      );
                      return (
                        <td key={t} className="p-3 border-b text-center">
                          {doc ? (
                            <button
                              onClick={() => openEditModal(doc)}
                              className="text-blue-600 hover:underline"
                            >
                              {doc.title}
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hidden Print Container */}
      <div className="print-container" ref={printContainerRef}>
        {generatedDocs.map((doc) => (
          <div
            key={doc.id}
            id={`print-${doc.id}`}
            className="mb-8 bg-white"
            style={{ width: "210mm", minHeight: "297mm", padding: "15mm" }}
          >
            {renderOfficialTable(doc, false)}
          </div>
        ))}
      </div>

      {editingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-slate-100 w-full max-w-6xl h-[90vh] rounded-xl flex flex-col">
            <div className="p-4 bg-white border-b flex justify-between">
              <h3 className="font-bold">編集</h3>
              <div>
                <button onClick={() => setEditingDoc(null)} className="mr-4">
                  破棄
                </button>
                <button
                  onClick={saveEdits}
                  className="bg-blue-600 text-white px-4 py-2 rounded"
                >
                  保存
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-8 flex justify-center">
              {renderOfficialTable(editingDoc, true, tempDocContent)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentGenerator;
