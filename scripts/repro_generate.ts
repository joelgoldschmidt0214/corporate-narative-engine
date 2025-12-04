import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import {
  generateCompanyHistory,
  generateBulkDocuments,
  DocumentType,
} from "../services/geminiService";

async function run() {
  try {
    const sample = {
      name: "株式会社テストサンプル",
      industry: "製造業",
      foundedYear: 2020,
      currentYear: 2024,
      initialEmployees: 5,
      currentEmployees: 50,
      persona: "保守的だが粘り強い創業者",
      keyEvents: "海外展開失敗、リストラ、設備更新",
      ceoHistory: [{ name: "創業者", resignationYear: "" }],
    } as any;

    console.log("=== Step 1: generateCompanyHistory ===");
    console.log("Input:", JSON.stringify(sample, null, 2));

    const history = await generateCompanyHistory(sample);
    console.log("Result years:", history.length);
    console.log("Years:", history.map((h) => h.year).join(", "));

    console.log("\n=== Step 2: generateBulkDocuments (NEWSLETTER) ===");
    const newsletters = await generateBulkDocuments(
      sample,
      history,
      DocumentType.NEWSLETTER
    );
    console.log("Generated newsletters:", newsletters.length);
    newsletters.forEach((n) => {
      console.log(
        `- ${n.year}: ${
          typeof n.content === "string"
            ? n.content.slice(0, 50) + "..."
            : "structured"
        }`
      );
    });

    console.log("\n=== Step 3: generateBulkDocuments (JE) ===");
    const journals = await generateBulkDocuments(
      sample,
      history,
      DocumentType.JE
    );
    console.log("Generated journal entries:", journals.length);
    journals.forEach((j) => {
      const content = j.content as any;
      const sectionCount = content?.sections?.length || 0;
      console.log(`- ${j.year}: ${sectionCount} sections`);
    });

    console.log("\n=== All tests completed successfully ===");
  } catch (e) {
    console.error("Repro failed:", e);
    process.exit(1);
  }
}

run();
