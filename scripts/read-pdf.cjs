// Extracts a PDF's text: npm run read-pdf -- <file.pdf> <out.txt> (made docs/scope/*.txt).
const fs = require('fs');
const PDFParser = require("pdf2json");

let pdfParser = new PDFParser(this, 1);
pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
pdfParser.on("pdfParser_dataReady", pdfData => {
    fs.writeFileSync(process.argv[3], pdfParser.getRawTextContent());
});

pdfParser.loadPDF(process.argv[2]);
