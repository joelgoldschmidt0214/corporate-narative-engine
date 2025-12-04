import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import html2canvas from "html2canvas";
import { GeneratedDocument, DocumentType } from "../types";
import { logger } from "./logger";

// 日本語フォントを動的にロード（Google Noto Sans JP）
let fontLoaded = false;
let fontBase64: string | null = null;

// 複数のフォントURLを試行（最初に成功したものを使用）
const FONT_URLS = [
  // Google Fonts direct (WOFF2 is smaller but needs conversion)
  "https://fonts.gstatic.com/s/notosansjp/v52/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf",
  // unpkg fallback
  "https://unpkg.com/@aspect-build/aspect-workflows@0.0.0-beta.4/fonts/NotoSansJP-Regular.ttf",
  // jsdelivr fallback
  "https://cdn.jsdelivr.net/gh/nicknisi/dotfiles@master/fonts/NotoSansJP-Regular.ttf",
];

const loadJapaneseFont = async (): Promise<string> => {
  if (fontBase64) return fontBase64;

  for (const url of FONT_URLS) {
    try {
      logger.debug("Trying font URL:", url);
      const response = await fetch(url);
      if (!response.ok) {
        logger.debug(`Font fetch failed for ${url}: ${response.status}`);
        continue;
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
      fontBase64 = base64;
      logger.info("Japanese font loaded successfully from", url);
      return base64;
    } catch (e) {
      logger.debug("Font load error for", url, e);
      continue;
    }
  }

  logger.warn("All font URLs failed, falling back to default");
  return "";
};

const setupJapaneseFont = async (pdf: jsPDF): Promise<boolean> => {
  try {
    const base64 = await loadJapaneseFont();
    if (base64) {
      pdf.addFileToVFS("NotoSansJP-Regular.ttf", base64);
      pdf.addFont("NotoSansJP-Regular.ttf", "NotoSansJP", "normal");
      pdf.setFont("NotoSansJP");
      return true;
    }
  } catch (e) {
    logger.warn("Failed to setup Japanese font", e);
  }
  return false;
};

/**
 * Generate a ZIP file containing PDFs.
 */
export const generateZipPackage = async (
  documents: GeneratedDocument[],
  elementIds: Record<string, string>,
  onProgress?: (info: {
    index: number;
    total: number;
    docId: string;
    stage: string;
  }) => void
): Promise<Blob> => {
  const zip = new JSZip();
  const total = documents.length;

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const elementId = elementIds[doc.id];
    onProgress?.({ index: i + 1, total, docId: doc.id, stage: "start" });

    try {
      logger.debug("Creating PDF for", doc.id, elementId);

      let pdfBlob: Blob;

      // NEWSLETTERはテキストベースPDF、それ以外は画像ベース
      if (doc.type === DocumentType.NEWSLETTER || doc.type === "NEWSLETTER") {
        pdfBlob = await createTextPdf(doc);
      } else {
        const element = document.getElementById(elementId);
        if (element) {
          pdfBlob = await createPdfFromElement(element, doc.title, (p) =>
            onProgress?.({
              index: i + 1,
              total,
              docId: doc.id,
              stage: `render:${p}`,
            })
          );
        } else {
          // 要素がない場合はテキストPDFにフォールバック
          pdfBlob = await createTextPdf(doc);
        }
      }

      let folderName = "Other";
      if (["BS", "PL", "CF", "GL", "JE"].includes(doc.type))
        folderName = "Financial_Statements";
      if (doc.type === "NEWSLETTER") folderName = "Newsletters";

      const safeTitle = doc.title.replace(/[\s\/]/g, "_");
      const fileName = `${safeTitle}_${doc.year || doc.id}.pdf`;
      zip.folder(folderName)?.file(fileName, pdfBlob);
      onProgress?.({ index: i + 1, total, docId: doc.id, stage: "done" });
    } catch (e) {
      logger.error(`Failed to generate PDF for ${doc.id}`, e);
      onProgress?.({ index: i + 1, total, docId: doc.id, stage: "error" });
    }
  }

  onProgress?.({ index: total, total, docId: "all", stage: "zipping" });
  return await zip.generateAsync({ type: "blob" });
};

/**
 * テキストベースのPDF生成（NEWSLETTER向け）
 * Markdownのようなフォーマットを維持しつつ、テキスト認識可能なPDFを出力
 */
const createTextPdf = async (doc: GeneratedDocument): Promise<Blob> => {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  // 日本語フォントを設定
  const hasJapaneseFont = await setupJapaneseFont(pdf);

  let y = margin;

  // ヘッダー
  pdf.setFontSize(18);
  pdf.text(doc.title, pageWidth / 2, y, { align: "center" });
  y += 15;

  // 区切り線
  pdf.setDrawColor(100, 100, 100);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 10;

  // 本文
  pdf.setFontSize(11);
  const content =
    typeof doc.content === "string"
      ? doc.content
      : JSON.stringify(doc.content, null, 2);

  // Markdownの簡易パース
  const lines = content.split("\n");

  for (const line of lines) {
    // ページ溢れチェック
    if (y > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }

    let text = line;
    let fontSize = 11;
    let isBold = false;

    // 見出しの処理
    if (line.startsWith("### ")) {
      text = line.slice(4);
      fontSize = 13;
      isBold = true;
      y += 3;
    } else if (line.startsWith("## ")) {
      text = line.slice(3);
      fontSize = 15;
      isBold = true;
      y += 5;
    } else if (line.startsWith("# ")) {
      text = line.slice(2);
      fontSize = 17;
      isBold = true;
      y += 7;
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      text = "• " + line.slice(2);
    }

    pdf.setFontSize(fontSize);

    // テキストを折り返し
    const splitText = pdf.splitTextToSize(text, contentWidth);

    for (const splitLine of splitText) {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(splitLine, margin, y);
      y += fontSize * 0.5;
    }

    // 空行の処理
    if (line.trim() === "") {
      y += 3;
    }
  }

  // フッター
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setFontSize(9);
    pdf.setTextColor(128, 128, 128);
    pdf.text(
      `${doc.year}年 - Page ${i}/${pageCount}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: "center" }
    );
    pdf.setTextColor(0, 0, 0);
  }

  return pdf.output("blob");
};

/**
 * 画像ベースのPDF生成（財務諸表向け）
 * JPEG圧縮で軽量化（PNG→JPEGで約1/10）
 */
const createPdfFromElement = async (
  element: HTMLElement,
  title: string,
  onRenderProgress?: (step: string) => void
): Promise<Blob> => {
  onRenderProgress?.("start-capture");
  const canvas = await html2canvas(element, {
    scale: 1.5, // 2→1.5に削減して軽量化
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
  });
  onRenderProgress?.("captured");

  // JPEG圧縮（品質0.7）でファイルサイズを大幅削減
  const imgData = canvas.toDataURL("image/jpeg", 0.7);
  onRenderProgress?.("to-dataurl");

  const pdf = new jsPDF("p", "mm", "a4");
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pdfWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
  heightLeft -= pdfHeight;

  while (heightLeft >= 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;
  }

  onRenderProgress?.("pdf-ready");
  return pdf.output("blob");
};
