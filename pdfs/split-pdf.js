const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

async function splitPdf(inputPath, maxSizeMB, outputDir) {
  const maxBytes = maxSizeMB * 1024 * 1024;
  const srcBytes = fs.readFileSync(inputPath);
  const srcDoc = await PDFDocument.load(srcBytes, { updateMetadata: false });
  const totalPages = srcDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error('Input PDF has no pages.');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const baseName = path.basename(inputPath, path.extname(inputPath));

  if (srcBytes.length <= maxBytes) {
    const outPath = path.join(outputDir, `${baseName}-part1.pdf`);
    fs.writeFileSync(outPath, srcBytes);
    console.log(`Input is already under ${maxSizeMB}MB. Wrote ${outPath} (${formatMB(srcBytes.length)}MB).`);
    return [outPath];
  }

  const avgBytesPerPage = srcBytes.length / totalPages;
  const outFiles = [];
  let pageIndex = 0;
  let chunkNum = 1;

  while (pageIndex < totalPages) {
    let estCount = Math.max(1, Math.floor((maxBytes * 0.9) / avgBytesPerPage));
    estCount = Math.min(estCount, totalPages - pageIndex);

    const chunkDoc = await PDFDocument.create();
    const initialIndices = Array.from({ length: estCount }, (_, i) => pageIndex + i);
    const initialPages = await chunkDoc.copyPages(srcDoc, initialIndices);
    initialPages.forEach((p) => chunkDoc.addPage(p));
    let bytes = await chunkDoc.save();

    if (bytes.length > maxBytes) {
      while (chunkDoc.getPageCount() > 1 && bytes.length > maxBytes) {
        chunkDoc.removePage(chunkDoc.getPageCount() - 1);
        bytes = await chunkDoc.save();
      }
      if (bytes.length > maxBytes) {
        console.warn(
          `Warning: page ${pageIndex + 1} alone is ${formatMB(bytes.length)}MB, over the ${maxSizeMB}MB limit. Writing it anyway.`
        );
      }
    } else {
      let nextIndex = pageIndex + chunkDoc.getPageCount();
      while (nextIndex < totalPages) {
        const [nextPage] = await chunkDoc.copyPages(srcDoc, [nextIndex]);
        chunkDoc.addPage(nextPage);
        const testBytes = await chunkDoc.save();
        if (testBytes.length > maxBytes) {
          chunkDoc.removePage(chunkDoc.getPageCount() - 1);
          break;
        }
        bytes = testBytes;
        nextIndex++;
      }
    }

    const outPath = path.join(outputDir, `${baseName}-part${chunkNum}.pdf`);
    fs.writeFileSync(outPath, bytes);
    console.log(`Wrote ${outPath} (${formatMB(bytes.length)}MB, ${chunkDoc.getPageCount()} pages).`);
    outFiles.push(outPath);

    pageIndex += chunkDoc.getPageCount();
    chunkNum++;
  }

  return outFiles;
}

async function main() {
  const [, , inputPath, maxSizeArg, outputDirArg] = process.argv;

  if (!inputPath) {
    console.error('Usage: node split-pdf.js <input.pdf> [maxSizeMB=30] [outputDir]');
    process.exit(1);
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const maxSizeMB = maxSizeArg ? Number(maxSizeArg) : 30;
  if (!Number.isFinite(maxSizeMB) || maxSizeMB <= 0) {
    console.error('maxSizeMB must be a positive number.');
    process.exit(1);
  }

  const outputDir = outputDirArg || `${path.basename(inputPath, path.extname(inputPath))}-split`;

  const outFiles = await splitPdf(inputPath, maxSizeMB, outputDir);
  console.log(`Done. ${outFiles.length} file(s) written to ${outputDir}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
