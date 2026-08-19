// Report -> PDF blob, shared by the manual Download flow (download.html) and
// OneDrive sync -- both need to turn one or more reports into a printable
// PDF via the exact same rasterize-each-sheet pipeline, so this is the one
// place that logic lives rather than two copies drifting apart.

const jsPDF = window.jspdf.jsPDF;

// Rasterize each sheet at roughly this many dots per inch. The DOM renders at
// 96dpi, so the html2canvas scale needed for a target DPI is TARGET/96 --
// adjusted for the fact that the sheet gets shrunk onto the page. Anything
// much below ~250 turns the 8pt label text into unreadable grey mush.
const TARGET_DPI = 300;

function pdfFilename(reports) {
  const projectNo = (reports[0] && reports[0].projectNo) || 'PR';
  if (reports.length === 1) {
    return `PR${projectNo}_DailyReport_${reports[0].date || 'undated'}.pdf`;
  }
  return `PR${projectNo}_DailyReports_${reports.length}reports.pdf`;
}

// Renders each report's sheets into `sandbox` one at a time, rasterizes each
// at print resolution, and places it on a real US Letter page at the size and
// orientation the template's own page setup asks for. Returns the finished
// PDF blob alongside each page's own JPEG capture -- callers that don't need
// the per-page images (OneDrive sync, uploading only the PDF) can just
// ignore `captures`.
async function buildPdfBlob(sandbox, layout, reports, logoBlob, onProgress) {
  const captures = [];
  let done = 0;
  const total = reports.length * 2;

  for (const report of reports) {
    const pages = renderReportPages(sandbox, layout, report, logoBlob);
    await waitForImages(sandbox);
    // A rAF-based settle wait can hang indefinitely if the tab is backgrounded
    // (rAF is throttled/suspended when not visible) -- setTimeout still fires.
    await new Promise((resolve) => setTimeout(resolve, 50));

    for (const { el, geom } of pages) {
      // el is laid out at 1pt = 1/72in but the DOM measures in 96dpi px, so
      // its on-screen width is contentW * 96/72. Scaling so the FINAL printed
      // width (geom.drawW points) resolves at TARGET_DPI:
      const targetPx = (geom.drawW / 72) * TARGET_DPI;
      const scale = targetPx / el.offsetWidth;

      const canvas = await html2canvas(el, {
        scale,
        backgroundColor: '#ffffff',
        useCORS: true,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });

      // dataUrl feeds jsPDF's addImage; viewBlob is a plain image file for
      // callers that want one (the mobile preview gallery, or a page image
      // uploaded to OneDrive) -- a blob: URL isn't subject to the
      // top-level-navigation block browsers apply to data: URLs.
      const viewBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
      captures.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.94), viewBlob, geom });

      $$('img', el).forEach((img) => {
        if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      });
      el.remove();
      done++;
      if (onProgress) onProgress(done, total);
    }
  }

  const doc = new jsPDF({
    unit: 'pt',
    format: [captures[0].geom.pageW, captures[0].geom.pageH],
    orientation: captures[0].geom.orientation,
  });
  captures.forEach((cap, i) => {
    const g = cap.geom;
    if (i > 0) doc.addPage([g.pageW, g.pageH], g.orientation);
    doc.addImage(cap.dataUrl, 'JPEG', g.x, g.y, g.drawW, g.drawH);
  });
  return { blob: doc.output('blob'), captures };
}
