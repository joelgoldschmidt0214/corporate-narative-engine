import React, { useState } from 'react';
import { YearlyData } from '../types';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Edit3, ArrowLeft, FileText } from 'lucide-react';

interface Props {
  data: YearlyData[];
  onUpdate: (data: YearlyData[]) => void;
  onProceed: () => void;
  onBack: () => void;
}

const CustomizedDot = (props: any) => {
  const { cx, cy, value, stroke } = props;
  if (value < 0) {
    return (
      <svg x={cx - 4} y={cy - 4} width={8} height={8} fill="white" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="3" stroke="#ef4444" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg x={cx - 3} y={cy - 3} width={6} height={6} fill={stroke} viewBox="0 0 6 6">
      <circle cx="3" cy="3" r="3" />
    </svg>
  );
};

const HistoryEditor: React.FC<Props> = ({ data, onUpdate, onProceed, onBack }) => {
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleCellChange = (index: number, field: keyof YearlyData, value: string | number) => {
    const newData = [...data];
    const numValue = Number(value);
    
    // Update high-level metric
    newData[index] = {
      ...newData[index],
      [field]: field === 'marketContext' || field === 'companyEvent' ? value : numValue,
    };

    // Sync to detailed financials if available
    if (newData[index].financials) {
      const f = newData[index].financials!;
      if (field === 'revenue') {
        f.sales = numValue;
        f.grossProfit = f.sales - f.cogs;
        f.operatingProfit = f.grossProfit - f.sga;
      } else if (field === 'operatingProfit') {
        f.operatingProfit = numValue;
        // Adjust SGA to balance
        f.sga = f.grossProfit - f.operatingProfit;
      } else if (field === 'cashFlow') {
        f.operatingCF = numValue;
      }
    }

    setTouched(prev => ({ ...prev, [`${index}-${field}`]: true }));
    onUpdate(newData);
  };

  const getCellClass = (index: number, field: string) => `
    w-full bg-transparent border-b border-transparent focus:outline-none px-1
    ${touched[`${index}-${field}`] ? 'bg-orange-50 border-orange-300' : 'hover:border-slate-300'}
    focus:border-blue-500 focus:bg-white
  `;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="sticky top-16 z-20 bg-white/90 backdrop-blur-md shadow-sm border-b border-slate-200 -mx-4 px-4 py-3 flex justify-between items-center mb-6">
         <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 bg-white text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition font-bold text-sm">
          <ArrowLeft className="w-4 h-4" />
          戻る
        </button>
        <h2 className="text-lg font-bold text-slate-700">財務・経営履歴の編集</h2>
        <button onClick={onProceed} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-md hover:shadow-lg font-bold text-sm">
          <FileText className="w-4 h-4" />
          ドキュメント生成へ
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-slate-800">業績推移チャート</h3>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded-sm"></span>売上高 (左軸)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-green-500"></span>営業利益 (右軸)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-purple-500"></span>CF (右軸)</span>
          </div>
        </div>
        <div style={{ width: '100%', height: '320px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" />
              <YAxis yAxisId="left" orientation="left" stroke="#2563eb" />
              <YAxis yAxisId="right" orientation="right" stroke="#10b981" />
              <ReferenceLine y={0} yAxisId="right" stroke="#ef4444" strokeDasharray="3 3" />
              <Tooltip contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }} labelFormatter={(label) => `${label}年度`} />
              <Bar yAxisId="left" dataKey="revenue" fill="#3b82f6" name="売上高" barSize={20} />
              <Line yAxisId="right" type="linear" dataKey="operatingProfit" stroke="#10b981" strokeWidth={2} name="営業利益" dot={<CustomizedDot />} />
              <Line yAxisId="right" type="linear" dataKey="cashFlow" stroke="#8b5cf6" strokeWidth={2} name="キャッシュフロー" dot={<CustomizedDot />} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Edit3 className="w-4 h-4" />
            財務・イベントデータ編集
          </h3>
          <span className="text-xs text-slate-500">セルをクリックして直接編集できます</span>
        </div>
        <div className="overflow-x-auto relative" style={{ maxHeight: '600px' }}>
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 sticky left-0 bg-slate-50 z-20 border-r border-slate-200 whitespace-nowrap">年度</th>
                <th className="px-4 py-3 min-w-[100px] whitespace-nowrap">売上高</th>
                <th className="px-4 py-3 min-w-[100px] whitespace-nowrap">営業利益</th>
                <th className="px-4 py-3 min-w-[100px] whitespace-nowrap">CF</th>
                <th className="px-4 py-3 min-w-[80px] whitespace-nowrap">社員数</th>
                <th className="px-4 py-3 min-w-[300px]">市場環境 (外部要因)</th>
                <th className="px-4 py-3 min-w-[300px]">社内イベント</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((row, index) => (
                <tr key={row.year} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-bold text-slate-900 sticky left-0 bg-white hover:bg-slate-50 z-10 border-r border-slate-100">
                    {row.year}
                  </td>
                  <td className="px-4 py-3"><input type="number" value={row.revenue} onChange={(e) => handleCellChange(index, 'revenue', e.target.value)} className={getCellClass(index, 'revenue')} /></td>
                  <td className="px-4 py-3"><input type="number" value={row.operatingProfit} onChange={(e) => handleCellChange(index, 'operatingProfit', e.target.value)} className={`${getCellClass(index, 'operatingProfit')} ${row.operatingProfit < 0 ? 'text-red-600 font-bold' : ''}`} /></td>
                  <td className="px-4 py-3"><input type="number" value={row.cashFlow} onChange={(e) => handleCellChange(index, 'cashFlow', e.target.value)} className={getCellClass(index, 'cashFlow')} /></td>
                  <td className="px-4 py-3"><input type="number" value={row.employees} onChange={(e) => handleCellChange(index, 'employees', e.target.value)} className={getCellClass(index, 'employees')} /></td>
                  <td className="px-4 py-3">
                     <div className="max-h-24 overflow-y-auto">
                        <textarea value={row.marketContext} onChange={(e) => handleCellChange(index, 'marketContext', e.target.value)} rows={2} className={`${getCellClass(index, 'marketContext')} resize-none whitespace-normal min-h-[3rem] w-full`} />
                     </div>
                  </td>
                   <td className="px-4 py-3">
                     <div className="max-h-24 overflow-y-auto">
                        <textarea value={row.companyEvent} onChange={(e) => handleCellChange(index, 'companyEvent', e.target.value)} rows={2} className={`${getCellClass(index, 'companyEvent')} resize-none whitespace-normal min-h-[3rem] w-full`} />
                     </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default HistoryEditor;