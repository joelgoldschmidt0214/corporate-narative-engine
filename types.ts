export enum AppStep {
  INPUT_DETAILS = 'INPUT_DETAILS',
  REVIEW_HISTORY = 'REVIEW_HISTORY',
  SELECT_DOCS = 'SELECT_DOCS',
  PREVIEW_DOCS = 'PREVIEW_DOCS',
}

export interface CeoHistoryItem {
  name: string;
  resignationYear: number | string; // number for year, '' for current
}

export type FieldSource = 'manual' | 'ai' | null;

export interface CompanyInput {
  name: string;
  ceoHistory: CeoHistoryItem[];
  foundedYear: number | string; // Allow string for empty input
  currentYear: number | string; // New: Current year for simulation context
  industry: string;
  persona: string;
  initialEmployees: number | string; // Allow string for empty input
  currentEmployees: number | string; // New: Current employees
  keyEvents: string;
}

export interface DetailedFinancials {
  // PL Items (Millions)
  sales: number;
  cogs: number;
  grossProfit: number;
  sga: number;
  operatingProfit: number; // Should match parent
  nonOperatingIncome: number;
  nonOperatingExpenses: number;
  ordinaryProfit: number;
  extraordinaryIncome: number;
  extraordinaryLoss: number;
  preTaxProfit: number;
  tax: number;
  netProfit: number;

  // BS Items (Millions)
  // Assets
  currentAssets: {
    cash: number;
    notesReceivable: number; // 受取手形
    accountsReceivable: number; // 売掛金
    inventory: number;
    other: number;
  };
  fixedAssets: {
    tangible: number; // 有形
    intangible: number; // 無形
    investments: number; // 投資等
  };
  totalAssets: number;

  // Liabilities
  currentLiabilities: {
    notesPayable: number; // 支払手形
    accountsPayable: number; // 買掛金
    shortTermDebt: number;
    other: number;
  };
  fixedLiabilities: {
    longTermDebt: number;
    other: number;
  };
  totalLiabilities: number;

  // Net Assets
  netAssets: {
    capitalStock: number; // 資本金
    retainedEarnings: number; // 利益剰余金
    other: number;
  };
  totalNetAssets: number;

  // CF Items (Millions) - breakdown
  operatingCF: number;
  investingCF: number;
  financingCF: number;
  cashAtBeginning: number;
  cashAtEnd: number;
}

export interface YearlyData {
  year: number;
  revenue: number; // In million JPY
  operatingProfit: number; // In million JPY
  cashFlow: number; // In million JPY
  employees: number;
  marketContext: string; // Real-world context (e.g., Covid)
  companyEvent: string; // Internal event
  financials?: DetailedFinancials; // Detailed breakdown generated upfront
}

export enum DocumentType {
  BS = 'BS', // Balance Sheet
  PL = 'PL', // Profit & Loss
  CF = 'CF', // Cash Flow
  JE = 'JE', // Journal Entries (Monthly)
  NEWSLETTER = 'NEWSLETTER',
}

export interface FinancialTableItem {
  label: string;
  value: number | string;
  isTotal?: boolean;
  indent?: number;
  // For JE specific columns
  debit?: number | string;
  credit?: number | string;
  account?: string;
  date?: string;
  description?: string;
}

export interface FinancialSection {
  title?: string;
  items: FinancialTableItem[];
  // For JE
  headers?: string[]; 
  breakPage?: boolean; // New: force page break after section
}

export interface GeneratedDocument {
  id: string;
  type: DocumentType;
  year: number;
  title: string;
  // Content can be a markdown string (for newsletter) or a structured object (for financials)
  content: string | {
    sections: FinancialSection[];
  }; 
}

export interface DocGenerationRequest {
  types: DocumentType[];
  startYear: number;
  endYear: number;
}