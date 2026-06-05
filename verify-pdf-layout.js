const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const htmlPath = 'file://c:\\temp\\test-pdf.html';
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    await page.setViewport({ width: 794, height: 1123 });
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });

    // Total scroll height
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    console.log(`=== PDF Layout Check ===`);
    console.log(`Total scroll height: ${scrollHeight}px (all pages combined)`);

    // Generate PDF and measure pages
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' } });
    console.log(`PDF generated: ${(pdf.length / 1024).toFixed(1)} KB`);

    // Save PDF
    const pdfPath = 'c:\\temp\\test-pdf-output.pdf';
    require('fs').writeFileSync(pdfPath, pdf);
    console.log(`PDF saved: ${pdfPath}`);

    // Analyze first page content
    const firstPageContent = await page.evaluate(() => {
      const headerEl = document.querySelector('.header');
      const firstAngkatan = document.querySelector('.angkatan-wrapper');
      const angkatanBlocks = document.querySelectorAll('.angkatan-wrapper');

      let headerEnd = 0;
      if (headerEl) headerEnd = headerEl.offsetTop + headerEl.offsetHeight;

      let firstAngkatanEnd = 0;
      let firstAngkatanText = 'N/A';
      if (firstAngkatan) {
        firstAngkatanEnd = firstAngkatan.offsetTop + firstAngkatan.offsetHeight;
        firstAngkatanText = firstAngkatan.innerText.substring(0, 80);
      }

      const pageContentHeight = 1123;

      return {
        headerEnd,
        firstAngkatanEnd,
        firstAngkatanText,
        angkatanCount: angkatanBlocks.length,
        firstAngkatanFitsOnPage1: firstAngkatanEnd <= pageContentHeight,
      };
    });

    console.log(`\n=== First Page Analysis ===`);
    console.log(`Header ends at: ${firstPageContent.headerEnd}px`);
    console.log(`First angkatan ends at: ${firstPageContent.firstAngkatanEnd}px`);
    console.log(`First angkatan preview: ${firstPageContent.firstAngkatanText}`);
    console.log(`\n✅ Header + Angkatan 1 di halaman 1: ${firstPageContent.firstAngkatanFitsOnPage1 ? 'YA' : 'TIDAK'}`);
    console.log(`Total angkatan blocks: ${firstPageContent.angkatanCount}`);

    // Take screenshot
    const screenshotPath = 'c:\\temp\\pdf-layout.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nScreenshot saved: ${screenshotPath}`);

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
