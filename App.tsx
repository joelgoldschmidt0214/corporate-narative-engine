import React, { useState } from 'react';
import { AppStep, CompanyInput, YearlyData } from './types';
import { generateCompanyHistory } from './services/geminiService';
import InputSection from './components/InputSection';
import HistoryEditor from './components/HistoryEditor';
import DocumentGenerator from './components/DocumentGenerator';
import { Layout, Briefcase, ChevronRight } from 'lucide-react';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.INPUT_DETAILS);
  const [companyData, setCompanyData] = useState<CompanyInput | null>(null);
  const [historyData, setHistoryData] = useState<YearlyData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerateHistory = async (input: CompanyInput) => {
    setIsLoading(true);
    setCompanyData(input);
    try {
      const data = await generateCompanyHistory(input);
      setHistoryData(data);
      setStep(AppStep.REVIEW_HISTORY);
    } catch (error) {
      alert("履歴の生成に失敗しました。APIキーを確認するか、もう一度お試しください。");
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case AppStep.INPUT_DETAILS:
        return (
           <InputSection 
             initialData={companyData}
             onGenerate={handleGenerateHistory} 
             isLoading={isLoading} 
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
            <span className={step === AppStep.INPUT_DETAILS ? 'text-blue-600 font-bold' : ''}>1. 会社情報</span>
            <ChevronRight className="w-4 h-4" />
            <span className={step === AppStep.REVIEW_HISTORY ? 'text-blue-600 font-bold' : ''}>2. 履歴編集</span>
            <ChevronRight className="w-4 h-4" />
            <span className={step === AppStep.SELECT_DOCS || step === AppStep.PREVIEW_DOCS ? 'text-blue-600 font-bold' : ''}>3. ドキュメント生成</span>
          </nav>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {renderStep()}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-slate-400">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Briefcase className="w-4 h-4" />
            <span>Built for Enterprise Sales Enablement</span>
          </div>
          <p>© {new Date().getFullYear()} Corporate Narrative Engine. Powered by Google Gemini.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;