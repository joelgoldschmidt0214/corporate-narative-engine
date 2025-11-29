import jsPDF from 'jspdf';
import JSZip from 'jszip';
import html2canvas from 'html2canvas';
import { GeneratedDocument } from '../types';

/**
 * Generate a ZIP file containing PDFs.
 * This function expects that the DOM elements for the documents have been rendered
 * temporarily or are accessible via IDs. 
 * 
 * Since we need to capture the *visual* state (official Japanese tables), 
 * we will rely on a callback or ID reference system.
 */
export const generateZipPackage = async (documents: GeneratedDocument[], elementIds: Record<string, string>): Promise<Blob> => {
  const zip = new JSZip();

  for (const doc of documents) {
    const elementId = elementIds[doc.id];
    const element = document.getElementById(elementId);
    
    if (element) {
      try {
        const pdfBlob = await createPdfFromElement(element, doc.title);
        
        let folderName = 'Other';
        if (['BS', 'PL', 'CF', 'GL', 'JE'].includes(doc.type)) folderName = 'Financial_Statements';
        if (doc.type === 'NEWSLETTER') folderName = 'Newsletters';

        const fileName = `${doc.title.replace(/[\s\/]/g, '_')}.pdf`;
        zip.folder(folderName)?.file(fileName, pdfBlob);
      } catch (e) {
        console.error(`Failed to generate PDF for ${doc.id}`, e);
      }
    }
  }

  return await zip.generateAsync({ type: 'blob' });
};

const createPdfFromElement = async (element: HTMLElement, title: string): Promise<Blob> => {
  // 1. Capture the element as a canvas
  // scale: 2 improves resolution for text
  const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false });
  
  const imgData = canvas.toDataURL('image/png');
  
  // 2. Create PDF (A4 size)
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  
  const imgWidth = pdfWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  
  // Add image to PDF
  // If height > page, we might need multiple pages, but for this summary format, fit to width is usually primary.
  // If it's very long, we simply slice. For now, we assume single page fit or basic multi-page logic.
  
  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pdfHeight;

  while (heightLeft >= 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;
  }

  return pdf.output('blob');
};