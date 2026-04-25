const pdfParse = require('pdf-parse');

async function extractPdfText(buffer) {
  const result = await pdfParse(buffer);
  return String(result.text || '').replace(/\r/g, '').trim();
}

module.exports = {
  extractPdfText,
};
