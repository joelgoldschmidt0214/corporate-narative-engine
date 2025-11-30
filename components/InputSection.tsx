import React, {
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { CompanyInput, CeoHistoryItem, FieldSource } from "../types";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { autocompleteCompanyInfo } from "../services/geminiService";

export type InputSectionHandle = {
  autoFill: () => Promise<void>;
  submit: () => void;
};

interface Props {
  initialData?: CompanyInput | null;
  onGenerate: (data: CompanyInput) => void;
  isLoading: boolean;
  showHeaderControls?: boolean;
  onAutoFillStatus?: (running: boolean, seconds?: number) => void;
}

const InputSection = forwardRef<InputSectionHandle, Props>(
  (
    {
      initialData,
      onGenerate,
      isLoading,
      showHeaderControls = false,
      onAutoFillStatus,
    },
    ref
  ) => {
    const [formData, setFormData] = useState<CompanyInput>(
      initialData || {
        name: "",
        ceoHistory: [{ name: "", resignationYear: "" }],
        foundedYear: 2005,
        currentYear: new Date().getFullYear(),
        industry: "",
        persona: "",
        initialEmployees: 5,
        currentEmployees: 30,
        keyEvents: "",
      }
    );

    const [sources, setSources] = useState<Record<string, FieldSource>>({});
    const [isAutoFilling, setIsAutoFilling] = useState(false);
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
      if (initialData) setFormData(initialData);
    }, [initialData]);

    useEffect(() => {
      let timer: any = null;
      if (isAutoFilling || isLoading) {
        setSeconds(0);
        timer = setInterval(() => setSeconds((s: number) => s + 1), 1000);
      } else {
        setSeconds(0);
      }
      return () => clearInterval(timer);
    }, [isAutoFilling, isLoading]);

    // Inform parent about autoFill status and elapsed seconds (if provided)
    useEffect(() => {
      if (typeof onAutoFillStatus === "function") {
        try {
          onAutoFillStatus(isAutoFilling, seconds);
        } catch (e) {
          // swallow callback errors
        }
      }
    }, [isAutoFilling, seconds, onAutoFillStatus]);

    const updateSource = (field: string, source: FieldSource) => {
      setSources((prev) => ({ ...prev, [field]: source }));
    };

    const handleChange = (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      const { name, value } = e.target;
      updateSource(name, "manual");
      setFormData((prev) => ({ ...prev, [name]: value } as any));
    };

    const handleCeoChange = (
      index: number,
      field: keyof CeoHistoryItem,
      value: string
    ) => {
      updateSource("ceoHistory", "manual");
      const newHistory = [...formData.ceoHistory];
      newHistory[index] = { ...newHistory[index], [field]: value };
      setFormData((prev) => ({ ...prev, ceoHistory: newHistory } as any));
    };

    const addCeoRow = () =>
      setFormData(
        (prev) =>
          ({
            ...prev,
            ceoHistory: [...prev.ceoHistory, { name: "", resignationYear: "" }],
          } as any)
      );

    const removeCeoRow = (index: number) => {
      if (formData.ceoHistory.length === 1) return;
      setFormData(
        (prev) =>
          ({
            ...prev,
            ceoHistory: prev.ceoHistory.filter((_, i) => i !== index),
          } as any)
      );
    };

    const handleAutoFill = async () => {
      setIsAutoFilling(true);
      try {
        const filled = await autocompleteCompanyInfo(formData);
        setFormData((prev) => ({ ...prev, ...filled } as any));

        const newSources = { ...sources };
        Object.keys(filled).forEach((key) => {
          if ((filled as any)[key] !== (formData as any)[key])
            newSources[key] = "ai";
        });
        if ((filled as any).ceoHistory !== formData.ceoHistory)
          newSources["ceoHistory"] = "ai";
        setSources(newSources);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("autocompleteCompanyInfo failed", e);
        alert("AI補完に失敗しました。再度お試しください。");
      } finally {
        setIsAutoFilling(false);
      }
    };

    const handleSubmit = () => {
      const finalData: CompanyInput = {
        ...formData,
        foundedYear: Number(formData.foundedYear) || 2000,
        currentYear: Number(formData.currentYear) || new Date().getFullYear(),
        initialEmployees: Number(formData.initialEmployees) || 1,
        currentEmployees: Number(formData.currentEmployees) || 10,
      };
      onGenerate(finalData);
    };

    useImperativeHandle(ref, () => ({
      autoFill: async () => await handleAutoFill(),
      submit: () => handleSubmit(),
    }));

    const isFormValid = () =>
      !!(
        formData.name &&
        formData.industry &&
        formData.foundedYear &&
        formData.persona
      );

    const getInputClass = (fieldName: string) => {
      const source = (sources as any)[fieldName] as FieldSource | undefined;
      let bgClass = "bg-white border-slate-300";
      if (source === "manual") bgClass = "bg-orange-50 border-orange-300";
      if (source === "ai") bgClass = "bg-purple-50 border-purple-300";
      return `w-full border rounded-lg outline-none transition px-4 py-2 ${bgClass} focus:ring-2 focus:ring-blue-500 focus:border-blue-500`;
    };

    return (
      <div className="w-full max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <div className="mb-6 border-b border-slate-100 pb-4">
          <h2 className="text-2xl font-bold text-slate-800">企業基本情報</h2>
          <p className="text-slate-500 mt-1">
            シミュレーションの基礎となるパラメータを設定してください。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">会社名</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className={getInputClass("name")}
              placeholder="株式会社 テック・フロンティア"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">
              業界・業種
            </label>
            <input
              type="text"
              name="industry"
              value={formData.industry}
              onChange={handleChange}
              placeholder="例: 製造業、SaaS、建設業"
              className={getInputClass("industry")}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">設立年</label>
            <input
              type="number"
              name="foundedYear"
              value={formData.foundedYear}
              onChange={handleChange}
              min={1950}
              max={2030}
              className={getInputClass("foundedYear")}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">
              現在 (シミュレーション終了年)
            </label>
            <input
              type="number"
              name="currentYear"
              value={formData.currentYear}
              onChange={handleChange}
              min={1950}
              max={2050}
              className={getInputClass("currentYear")}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">
              初期従業員数
            </label>
            <input
              type="number"
              name="initialEmployees"
              value={formData.initialEmployees}
              onChange={handleChange}
              className={getInputClass("initialEmployees")}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">
              現在従業員数
            </label>
            <input
              type="number"
              name="currentEmployees"
              value={formData.currentEmployees}
              onChange={handleChange}
              className={getInputClass("currentEmployees")}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">歴代社長</label>
            <div
              className={`border rounded-lg overflow-hidden ${
                sources["ceoHistory"] === "manual"
                  ? "border-orange-300 bg-orange-50"
                  : sources["ceoHistory"] === "ai"
                  ? "border-purple-300 bg-purple-50"
                  : "border-slate-300"
              }`}
            >
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 text-left">氏名</th>
                    <th className="px-4 py-2 text-left">
                      退任年度 (空欄なら現職)
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {formData.ceoHistory.map((ceo, index) => (
                    <tr key={index} className="bg-white/50">
                      <td className="p-2">
                        <input
                          type="text"
                          value={ceo.name}
                          onChange={(e) =>
                            handleCeoChange(index, "name", e.target.value)
                          }
                          className="w-full p-1 outline-none bg-transparent hover:bg-white focus:bg-white border-b border-transparent focus:border-blue-500"
                          placeholder="氏名を入力"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={ceo.resignationYear}
                          onChange={(e) =>
                            handleCeoChange(
                              index,
                              "resignationYear",
                              e.target.value
                            )
                          }
                          className="w-full p-1 outline-none bg-transparent hover:bg-white focus:bg-white border-b border-transparent focus:border-blue-500"
                          placeholder="現職"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => removeCeoRow(index)}
                          className="text-slate-400 hover:text-red-500"
                          disabled={formData.ceoHistory.length === 1}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                onClick={addCeoRow}
                className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center gap-1 border-t border-slate-200"
              >
                <Plus className="w-3 h-3" /> 行を追加
              </button>
            </div>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">
              歴代社長のペルソナ・経営スタイル
            </label>
            <textarea
              name="persona"
              value={formData.persona}
              onChange={handleChange}
              rows={4}
              placeholder="創業者：豪快だが慎重。二代目：財務重視で堅実、など。"
              className={`${getInputClass("persona")} resize-y`}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">
              重要イベント・特記事項
            </label>
            <textarea
              name="keyEvents"
              value={formData.keyEvents}
              onChange={handleChange}
              rows={4}
              placeholder="シミュレーションに反映させたい社史イベントがあれば入力してください..."
              className={`${getInputClass("keyEvents")} resize-y`}
            />
          </div>
        </div>

        {!showHeaderControls && (
          <div className="mt-8 flex justify-end gap-4">
            <button
              onClick={handleAutoFill}
              disabled={isAutoFilling || isLoading}
              className="flex items-center gap-2 px-4 py-3 bg-purple-100 text-purple-700 font-bold rounded-lg hover:bg-purple-200 transition disabled:opacity-50"
            >
              {isAutoFilling ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : null}
              <span>AIで補完</span>
            </button>

            <button
              onClick={handleSubmit}
              disabled={isLoading || !isFormValid()}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-white transition-all shadow-md ${
                isLoading || !isFormValid()
                  ? "bg-slate-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 hover:shadow-lg"
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span>会社情報を生成中... ({seconds}s)</span>
                </>
              ) : (
                <>会社情報・財務推移を生成</>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }
);

export default InputSection;
