import { jsPDF } from "jspdf";
import mammoth from "mammoth";

const PAGE_MARGIN = 48;

function textToPdf(title: string, text: string): Blob {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - PAGE_MARGIN * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, PAGE_MARGIN, PAGE_MARGIN);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const lines = doc.splitTextToSize(text || "(empty)", usableWidth) as string[];
  let y = PAGE_MARGIN + 24;
  const lineHeight = 15;
  for (const line of lines) {
    if (y > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    doc.text(line, PAGE_MARGIN, y);
    y += lineHeight;
  }
  return doc.output("blob");
}

async function imageToPdf(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = dataUrl;
  });

  const doc = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation: dimensions.width > dimensions.height ? "landscape" : "portrait",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - PAGE_MARGIN * 2;
  const usableHeight = pageHeight - PAGE_MARGIN * 2;
  const scale = Math.min(usableWidth / dimensions.width, usableHeight / dimensions.height, 1);
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  const format = file.type.includes("png") ? "PNG" : "JPEG";
  doc.addImage(dataUrl, format, (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
  return doc.output("blob");
}

async function docxToPdf(file: File): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return textToPdf(file.name, value);
}

export type PdfConversionResult = {
  blob: Blob;
  note?: string;
};

export async function convertFileToPdf(file: File): Promise<PdfConversionResult> {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return { blob: file };
  if (file.type.startsWith("image/") || /\.(png|jpe?g)$/.test(name)) {
    return { blob: await imageToPdf(file) };
  }
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      return {
        blob: await docxToPdf(file),
        note: "Converted from .docx — formatting, images, and tables may not carry over.",
      };
    } catch {
      // Fall through to a clear explanatory PDF.
    }
  }

  const note = `"${file.name}" cannot be converted to PDF in the browser. Save it as a PDF and upload it again.`;
  return { blob: textToPdf("Conversion not available", note), note };
}

export function essayToPdf(essayText: string): Blob {
  return textToPdf("Essay Draft", essayText);
}
