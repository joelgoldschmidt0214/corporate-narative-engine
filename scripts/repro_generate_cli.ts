import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import {
  generateCompanyHistory,
  batchGenerateDocuments,
} from "../services/geminiService.ts";

// Avoid importing project-wide TypeScript enums (which can break ts-node ESM strip-only mode).
// Define a minimal local DocumentType mapping used by the CLI for filenames and type selection.
const DocumentType = {
  NEWSLETTER: "NEWSLETTER",
  JE: "JE",
  BS: "BS",
  PL: "PL",
  CF: "CF",
} as const;

type CLIArgs = {
  companyJson?: string;
  companyName?: string;
  fromYear?: number;
  toYear?: number;
  types?: string[];
  apiKey?: string;
  saveDir?: string;
  promptFile?: string;
  savePrompt?: boolean;
};

const parseArgs = (): CLIArgs => {
  const out: CLIArgs = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--company-json") out.companyJson = argv[++i];
    else if (a === "--company-name") out.companyName = argv[++i];
    else if (a === "--from-year") out.fromYear = Number(argv[++i]);
    else if (a === "--to-year") out.toYear = Number(argv[++i]);
    else if (a === "--types")
      out.types = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--api-key") out.apiKey = argv[++i];
    else if (a === "--save-dir") out.saveDir = argv[++i];
    else if (a === "--prompt-file") out.promptFile = argv[++i];
    else if (a === "--save-prompt") out.savePrompt = true;
  }
  return out;
};

const mapTypes = (names?: string[]) => {
  if (!names || names.length === 0)
    return [DocumentType.NEWSLETTER, DocumentType.JE];
  const out: DocumentType[] = [];
  for (const n of names) {
    const up = n.toUpperCase();
    if (up === "NEWSLETTER" || up === "NEWS" || up === "N")
      out.push(DocumentType.NEWSLETTER);
    else if (up === "JE" || up === "JOURNAL" || up === "J")
      out.push(DocumentType.JE);
    else if (up === "BS") out.push(DocumentType.BS);
    else if (up === "PL") out.push(DocumentType.PL);
    else if (up === "CF") out.push(DocumentType.CF);
  }
  return out;
};

const ensureDir = (p: string) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

const run = async () => {
  const args = parseArgs();

  // If API key is provided as CLI arg, set it on process.env so services read it.
  if (args.apiKey) {
    process.env.GEMINI_API_KEY = args.apiKey;
  }
  // If CLI requested to save prompts, set env var consumed by service
  if (args.savePrompt) process.env.SAVE_PROMPT = "1";
  const saveDir =
    args.saveDir || path.join(process.cwd(), "debug", "repro_output");
  ensureDir(saveDir);

  // If a raw prompt file is provided, send that exact prompt to the API and exit.
  if (args.promptFile) {
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY not set. Provide via --api-key or env.");
      process.exit(2);
    }
    const promptText = fs.readFileSync(path.resolve(args.promptFile), "utf-8");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log("[repro_cli] Sending raw prompt file to model...");
    const res = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: promptText,
    } as any);
    const outPath = path.join(saveDir, "prompt_response.txt");
    fs.writeFileSync(outPath, String(res.text || ""), { encoding: "utf-8" });
    console.log(`[repro_cli] Wrote response to ${outPath}`);
    if (args.savePrompt) {
      const ppath = path.join(saveDir, "sent_prompt.txt");
      fs.writeFileSync(ppath, promptText, { encoding: "utf-8" });
      console.log(`[repro_cli] Saved sent prompt to ${ppath}`);
    }
    process.exit(0);
  }

  let company: any = null;
  if (args.companyJson) {
    const txt = fs.readFileSync(path.resolve(args.companyJson), "utf-8");
    company = JSON.parse(txt);
  } else {
    company = {
      name: args.companyName || "株式会社CLI再現",
      industry: "製造業",
      foundedYear: args.fromYear || 2000,
      currentYear: args.toYear || new Date().getFullYear(),
      initialEmployees: 5,
      currentEmployees: 50,
      persona: "保守的だが粘り強い創業者",
      keyEvents: "サンプル企業。CLI再現用",
      ceoHistory: [{ name: "代表取締役", resignationYear: "" }],
    } as any;
  }

  console.log(
    "[repro_cli] Generating company history (this calls the same service as the UI)"
  );
  const history = await generateCompanyHistory(company as any);
  console.log(`[repro_cli] Generated ${history.length} years`);

  const types = mapTypes(args.types);
  console.log("[repro_cli] Requesting document generation for types:", types);

  const docs = await batchGenerateDocuments(
    company as any,
    history,
    types as any,
    (completed: number, currentDoc: string) => {
      process.stdout.write(`progress: ${completed} ${currentDoc}\n`);
    }
  );

  console.log(
    `[repro_cli] Received ${docs.length} documents. Writing to ${saveDir}`
  );
  for (const d of docs) {
    const safeId = `${d.type}-${d.year}`.replace(/[^a-z0-9._-]/gi, "_");
    if (d.type === DocumentType.NEWSLETTER) {
      const filepath = path.join(saveDir, `${safeId}.md`);
      const content =
        typeof d.content === "string"
          ? d.content
          : JSON.stringify(d.content, null, 2);
      fs.writeFileSync(filepath, `# ${d.title}\n\n${content}`);
    } else if (d.type === DocumentType.JE) {
      const filepath = path.join(saveDir, `${safeId}.json`);
      fs.writeFileSync(filepath, JSON.stringify(d.content, null, 2));
    } else {
      const filepath = path.join(saveDir, `${safeId}.json`);
      fs.writeFileSync(filepath, JSON.stringify(d.content, null, 2));
    }
  }

  console.log("[repro_cli] Done. Files:");
  console.log(
    fs
      .readdirSync(saveDir)
      .map((f) => ` - ${f}`)
      .join("\n")
  );
};

run().catch((e) => {
  console.error("[repro_cli] Fatal:", e);
  process.exit(1);
});
