import React, { useState, useRef, useEffect } from "react";
import { AppStep, CompanyInput, YearlyData } from "./types";
import { generateCompanyHistory } from "./services/geminiService";
import InputSection, { InputSectionHandle } from "./components/InputSection";
import HistoryEditor from "./components/HistoryEditor";
import DocumentGenerator from "./components/DocumentGenerator";
import { Layout, Briefcase, ChevronRight, Loader2 } from "lucide-react";

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.INPUT_DETAILS);
  const [companyData, setCompanyData] = useState<CompanyInput | null>(null);
  const [historyData, setHistoryData] = useState<YearlyData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [autoFillSeconds, setAutoFillSeconds] = useState(0);
  const inputRef = useRef<InputSectionHandle | null>(null);

  const handleGenerateHistory = async (input: CompanyInput) => {
    setIsLoading(true);
    setElapsedSeconds(0);
    setCompanyData(input);
    try {
      const start = Date.now();
      const timer = setInterval(
        () => setElapsedSeconds(Math.floor((Date.now() - start) / 1000)),
        1000
      );
      const data = await generateCompanyHistory(input);
      clearInterval(timer);
      setHistoryData(data);
      setStep(AppStep.REVIEW_HISTORY);
    } catch (error) {
      alert(
        "履歴の生成に失敗しました。APIキーを確認するか、もう一度お試しください。"
      );
    } finally {
      setIsLoading(false);
      setElapsedSeconds(0);
    }
  };

  const renderStep = () => {
    switch (step) {
      case AppStep.INPUT_DETAILS:
        return (
          <InputSection
            ref={inputRef}
            initialData={companyData}
            onGenerate={handleGenerateHistory}
            isLoading={isLoading}
            showHeaderControls={true}
            onAutoFillStatus={(running, seconds) => {
              setIsAutoFilling(running);
              setAutoFillSeconds(seconds ?? 0);
            }}
          />
        );
      case AppStep.REVIEW_HISTORY:
        return (
          <HistoryEditor
            data={historyData}
            onUpdate={setHistoryData}
            onProceed={() => setStep(AppStep.SELECT_DOCS)}
            onBack={() => setStep(AppStep.INPUT_DETAILS)}
          />
        );
      case AppStep.SELECT_DOCS:
      case AppStep.PREVIEW_DOCS:
        return (
          <DocumentGenerator
            company={companyData}
            history={historyData}
            onBack={() => setStep(AppStep.REVIEW_HISTORY)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Layout className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-slate-800">
              Corporate Narrative Engine
            </h1>
          </div>

          <nav className="hidden md:flex items-center gap-2 text-sm text-slate-500">
            <span
              className={
                step === AppStep.INPUT_DETAILS ? "text-blue-600 font-bold" : ""
              }
            >
              1. 会社情報
            </span>
            <ChevronRight className="w-4 h-4" />
            <span
              className={
                step === AppStep.REVIEW_HISTORY ? "text-blue-600 font-bold" : ""
              }
            >
              2. 履歴編集
            </span>
            <ChevronRight className="w-4 h-4" />
            <span
              className={
                step === AppStep.SELECT_DOCS || step === AppStep.PREVIEW_DOCS
                  ? "text-blue-600 font-bold"
                  : ""
              }
            >
              3. ドキュメント生成
            </span>
          </nav>
          {/* header has no action buttons; actions live in toolbar under header */}
        </div>
      </header>

      {/* Non-scrolling toolbar directly under header (visible on input step) */}
      {step === AppStep.INPUT_DETAILS && (
        <div className="sticky top-16 z-40 bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-end gap-3">
            <button
              onClick={async () => {
                try {
                  await inputRef.current?.autoFill();
                } catch (e) {
                  console.error(e);
                }
              }}
              disabled={isAutoFilling}
              className="flex items-center gap-2 px-3 py-2 bg-purple-100 text-purple-700 rounded-md text-sm font-bold"
            >
              {isAutoFilling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              <span>
                AIで補完{isAutoFilling ? ` (${autoFillSeconds}s)` : ""}
              </span>
            </button>

            <button
              onClick={async () => {
                try {
                  inputRef.current?.submit();
                } catch (e) {
                  console.error(e);
                }
              }}
              disabled={isLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold ${
                isLoading ? "bg-slate-400 text-white" : "bg-blue-600 text-white"
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>生成中… ({elapsedSeconds}s)</span>
                </>
              ) : (
                "会社情報を生成"
              )}
            </button>
          </div>
        </div>
      )}

      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {renderStep()}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-slate-400">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Briefcase className="w-4 h-4" />
            <span>Built for Enterprise Sales Enablement</span>
          </div>
          <p>
            © {new Date().getFullYear()} Corporate Narrative Engine. Powered by
            Google Gemini.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
