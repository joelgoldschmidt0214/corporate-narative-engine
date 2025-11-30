import jsPDF from "jspdf";
import JSZip from "jszip";
import html2canvas from "html2canvas";
import { GeneratedDocument } from "../types";
import { logger } from "./logger";

/**
 * Generate a ZIP file containing PDFs.
 * This function expects that the DOM elements for the documents have been rendered
 * temporarily or are accessible via IDs.
 *
 * Since we need to capture the *visual* state (official Japanese tables),
 * we will rely on a callback or ID reference system.
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
    const element = document.getElementById(elementId);
    onProgress?.({ index: i + 1, total, docId: doc.id, stage: "start" });

    if (element) {
      try {
        logger.debug("Creating PDF for", doc.id, elementId);
        const pdfBlob = await createPdfFromElement(element, doc.title, (p) =>
          onProgress?.({
            index: i + 1,
            total,
            docId: doc.id,
            stage: `render:${p}`,
          })
        );

        let folderName = "Other";
        if (["BS", "PL", "CF", "GL", "JE"].includes(doc.type))
          folderName = "Financial_Statements";
        if (doc.type === "NEWSLETTER") folderName = "Newsletters";

        // Ensure unique file names per document (include year/id) to avoid overwriting
        const safeTitle = doc.title.replace(/[\s\/]/g, "_");
        const fileName = `${safeTitle}_${doc.year || doc.id}.pdf`;
        zip.folder(folderName)?.file(fileName, pdfBlob);
        onProgress?.({ index: i + 1, total, docId: doc.id, stage: "done" });
      } catch (e) {
        logger.error(`Failed to generate PDF for ${doc.id}`, e);
        onProgress?.({ index: i + 1, total, docId: doc.id, stage: "error" });
      }
    } else {
      logger.warn("Element not found for PDF generation", elementId, doc.id);
      onProgress?.({
        index: i + 1,
        total,
        docId: doc.id,
        stage: "missing-element",
      });
    }
  }

  onProgress?.({ index: total, total, docId: "all", stage: "zipping" });
  return await zip.generateAsync({ type: "blob" });
};

const createPdfFromElement = async (
  element: HTMLElement,
  title: string,
  onRenderProgress?: (step: string) => void
): Promise<Blob> => {
  // 1. Capture the element as a canvas
  // scale: 2 improves resolution for text
  onRenderProgress?.("start-capture");
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
  });
  onRenderProgress?.("captured");

  const imgData = canvas.toDataURL("image/png");
  onRenderProgress?.("to-dataurl");

  // 2. Create PDF (A4 size)
  const pdf = new jsPDF("p", "mm", "a4");
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pdfWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Add image to PDF
  // If height > page, we might need multiple pages, but for this summary format, fit to width is usually primary.
  // If it's very long, we simply slice. For now, we assume single page fit or basic multi-page logic.

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pdfHeight;

  while (heightLeft >= 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;
  }

  onRenderProgress?.("pdf-ready");
  return pdf.output("blob");
};
