import * as pdfjsLib from "pdfjs-dist";

// Use CDN worker to avoid Vite ?url resolution issues in the Cloudflare plugin
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "xml",
  "yaml", "yml", "html", "htm", "js", "ts", "py",
]);

export interface ExtractedFile {
  name: string;
  content: string;
}

export function isSupportedFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf" || TEXT_EXTENSIONS.has(ext);
}

async function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

type PdfTextItem = {
  str: string;
  hasEOL: boolean;
  transform: number[];
  width: number;
};

async function extractPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    let pageText = "";
    let prevY: number | null = null;
    let prevXEnd = 0;

    for (const raw of content.items) {
      if (!("str" in raw) || raw.str === "") continue;
      const item = raw as unknown as PdfTextItem;

      const x = item.transform[4];
      const y = item.transform[5];

      if (prevY !== null) {
        const yDiff = Math.abs(y - prevY);
        if (yDiff > 8) {
          // New line — use double newline for large gaps (paragraph breaks)
          pageText += yDiff > 20 ? "\n\n" : "\n";
        } else if (x - prevXEnd > 3 && !pageText.endsWith(" ")) {
          // Word-level gap on the same line
          pageText += " ";
        }
      }

      pageText += item.str;
      prevXEnd = x + item.width;
      prevY = y;
    }

    const trimmed = pageText.trim();
    if (trimmed) pages.push(trimmed);
  }

  if (pages.length === 0) {
    return "[No extractable text found — this PDF may be image-based and requires OCR]";
  }

  return pages.join("\n\n");
}

export async function extractText(file: File): Promise<ExtractedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const content = ext === "pdf"
    ? await extractPdf(file)
    : await readAsText(file);
  return { name: file.name, content };
}
