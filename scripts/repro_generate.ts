import dotenv from "dotenv";
dotenv.config();

import { generateCompanyHistory } from "../services/geminiService";

async function run() {
  try {
    const sample = {
      name: "株式会社テストサンプル",
      industry: "製造業",
      foundedYear: 2000,
      currentYear: 2024,
      initialEmployees: 5,
      currentEmployees: 50,
      persona: "保守的だが粘り強い創業者",
      keyEvents: "海外展開失敗、リストラ、設備更新",
      ceoHistory: [{ name: "創業者", resignationYear: "" }],
    } as any;

    console.log("Starting generateCompanyHistory (server repro)");
    const res = await generateCompanyHistory(sample);
    console.log("Result years:", res.length);
  } catch (e) {
    console.error("Repro failed:", e);
  }
}

run();
