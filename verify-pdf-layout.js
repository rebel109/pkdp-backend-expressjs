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
    // Check if first page has the header AND Angkatan 1
    const firstPageContent = await page.evaluate(() => {
      // Get all cohort sections
      const cohorts = document.querySelectorAll('.cohort-section');
      const classes = document.querySelectorAll('.class-section');
      const sheet = document.querySelector('.sheet');

      // Measure the header + meta + first cohort combined
      const headerEl = document.querySelector('.header');
      const metaEl = document.querySelector('.meta');
      const firstCohort = document.querySelector('.cohort-section');
      const firstPhase = document.querySelector('.phase-header');

      const getTotalHeight = (els) => {
        if (!els.length) return 0;
        const first = els[0];
        const last = els[els.length - 1];
        return last.offsetTop + last.offsetHeight - first.offsetTop;
      };

      let headerEnd = 0;
      if (headerEl) headerEnd = headerEl.offsetTop + headerEl.offsetHeight;
      let metaEnd = 0;
      if (metaEl) metaEnd = metaEl.offsetTop + metaEl.offsetHeight;

      let firstCohortEnd = 0;
      if (firstCohort) firstCohortEnd = firstCohort.offsetTop + firstCohort.offsetHeight;

      let firstPhaseEnd = 0;
      if (firstPhase) firstPhaseEnd = firstPhase.offsetTop + firstPhase.offsetHeight;

      const pageContentHeight = 1123; // A4 at 96dpi with margins

      return {
        headerEnd,
        metaEnd,
        firstPhaseEnd,
        firstCohortEnd,
        firstCohortText: firstCohort ? firstCohort.innerText.substring(0, 60) : 'N/A',
        cohortCount: cohorts.length,
        classCount: classes.length,
        firstCohortFitsOnPage1: firstCohortEnd <= pageContentHeight,
        firstCohortOffsetTop: firstCohort ? firstCohort.offsetTop : 0,
      };
    });

    console.log(`\n=== First Page Analysis ===`);
    console.log(`Header ends at: ${firstPageContent.headerEnd}px`);
    console.log(`Meta ends at: ${firstPageContent.metaEnd}px`);
    console.log(`Phase header ends at: ${firstPageContent.firstPhaseEnd}px`);
    console.log(`First cohort ends at: ${firstPageContent.firstCohortEnd}px`);
    console.log(`First cohort: ${firstPageContent.firstCohortText}`);
    console.log(`\n✅ Header + Angkatan 1 di halaman 1: ${firstPageContent.firstCohortFitsOnPage1 ? 'YA' : 'TIDAK'}`);
    console.log(`Total cohort sections: ${firstPageContent.cohortCount}`);

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
