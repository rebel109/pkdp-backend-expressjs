const db = require('./config/db');
const fs = require('fs');

(async () => {
  try {
    // Get sample data
    const [rows] = await db.query(`
      SELECT c.id AS class_id, c.name AS class_name, c.phase AS class_phase, c.period_id,
             p.label AS period_label, p.year AS period_year, co.id AS cohort_id, co.cohort_no, co.ojc_mode,
             u.id AS user_id, u.name, COALESCE(NULLIF(pr.nidn,''), NULLIF(pr.nuptk,''), '—') AS identity_no
      FROM class_members cm
      JOIN classes c ON c.id = cm.class_id
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      LEFT JOIN periods p ON p.id = c.period_id
      LEFT JOIN cohorts co ON co.id = c.cohort_id
      WHERE u.role = 'DOSEN' AND c.period_id = 5
      ORDER BY FIELD(c.phase, 'ISC1', 'OJC', 'ISC2'), COALESCE(co.cohort_no, 9999), c.name, u.name
      LIMIT 50
    `);

    console.log('Sample rows:', rows.length);
    if (rows.length === 0) {
      console.log('No data found. Check period_id and class data.');
      process.exit(0);
    }

    // Build HTML
    const phaseData = { ISC1: {}, OJC: {}, ISC2: {} };
    rows.forEach(row => {
      const phase = row.class_phase || 'ISC1';
      const cohortNo = row.cohort_no || 0;
      if (!phaseData[phase]) phaseData[phase] = {};
      if (!phaseData[phase][cohortNo]) phaseData[phase][cohortNo] = { cohort_no: cohortNo, classes: {} };
      const className = row.class_name || 'ISC1';
      if (!phaseData[phase][cohortNo].classes[className]) phaseData[phase][cohortNo].classes[className] = [];
      phaseData[phase][cohortNo].classes[className].push(row);
    });

    const totalParticipants = new Set(rows.map(r => r.user_id)).size;
    const totalCohorts = new Set(rows.map(r => r.cohort_no).filter(Boolean)).size;

    let isFirstCohort = true;
    const phaseSections = Object.keys(phaseData).map(phase => {
      const cohorts = phaseData[phase];
      if (!Object.keys(cohorts).length) return '';
      const cohortHtml = Object.keys(cohorts).sort((a, b) => Number(a) - Number(b)).map(cohortNo => {
        const cohort = cohorts[cohortNo];
        const cohortLabel = cohortNo ? `Angkatan ${cohortNo}` : 'Tanpa Angkatan';
        const pageBreakStyle = isFirstCohort ? '' : 'page-break-before:always;page-break-inside:avoid;';
        isFirstCohort = false;
        const classHtml = Object.keys(cohort.classes).map(className => {
          const participants = cohort.classes[className];
          const body = participants.map((r, i) => `<tr><td class="no">${i+1}</td><td>${r.identity_no||'—'}</td><td>${r.name||'—'}</td></tr>`).join('');
          return `<div class="class-section"><div class="class-title"><strong>${className}</strong><span>${participants.length} peserta</span></div><table><thead><tr><th class="no">No</th><th>NIDN/NUPTK</th><th>Nama Peserta</th></tr></thead><tbody>${body}</tbody></table></div>`;
        }).join('');
        return `<div class="cohort-section" style="${pageBreakStyle}"><div class="cohort-header">${cohortLabel}</div>${classHtml}</div>`;
      }).join('');
      return `<div class="phase-section"><div class="phase-header">${phase}</div>${cohortHtml}</div>`;
    }).join('');

    const html = `<!doctype html>
<html>
<head>
  <title>Daftar Kelas Peserta</title>
  <style>
    @page{size:A4;margin:12mm 10mm}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:10px;background:#fff}
    .sheet{border:1px solid #d7e3f4;border-radius:8px;overflow:hidden;box-shadow:none}
    .header{padding:12px 14px;background:linear-gradient(135deg,#1d4ed8 0%,#38bdf8 55%,#dbeafe 100%);color:#fff;position:relative}
    .header:after{content:"";position:absolute;right:-32px;top:-40px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,.15)}
    .eyebrow{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9;margin-bottom:2px}
    h1{font-size:16px;margin:0 0 2px;text-transform:uppercase;letter-spacing:.02em;line-height:1}
    .subtitle{font-size:9px;opacity:.9;max-width:560px;line-height:1.2;margin:0}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 10px;background:#f7fbff;border-bottom:1px solid #d7e3f4}
    .meta-card{padding:5px 7px;border:1px solid #dbeafe;border-radius:6px;background:#fff}
    .meta-label{font-size:7px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:800;margin-bottom:1px}
    .meta-value{font-size:10px;color:#0f172a;font-weight:700;line-height:1.2}
    .content{padding:8px 10px}
    .phase-section{margin-bottom:0}
    .phase-header{font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid #1d4ed8}
    .cohort-section{margin-bottom:0;padding-top:2px}
    .cohort-header{font-size:11px;font-weight:700;color:#0f172a;margin-bottom:4px;padding:3px 0;border-left:3px solid #1d4ed8;padding-left:6px}
    .class-section{margin-bottom:5px;break-inside:avoid}
    .class-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;color:#334155;font-size:9px}
    .class-title strong{font-size:10px;color:#0f172a;font-weight:700}
    .class-title span{font-size:8px;color:#64748b}
    table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden}
    th,td{padding:4px 7px;vertical-align:top;line-height:1.3;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
    th:last-child,td:last-child{border-right:0}
    tbody tr:last-child td{border-bottom:0}
    th{background:#1e3a8a;color:#fff;text-align:left;font-weight:700;font-size:8px;text-transform:uppercase;letter-spacing:.02em}
    tbody tr:nth-child(even){background:#f8fafc}
    tbody tr:nth-child(odd){background:#fff}
    .no{width:28px;text-align:center;font-weight:700;color:#1d4ed8;font-size:9px}
    th.no{color:#fff;text-align:center}
    .footer{padding:5px 10px;background:#f8fafc;color:#64748b;font-size:7px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:8px}
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="eyebrow">Daftar Kelas PKDP</div>
      <h1>Daftar Kelas Peserta</h1>
      <div class="subtitle">Peserta dikelompokkan per fase dan angkatan.</div>
    </div>
    <div class="meta">
      <div class="meta-card"><div class="meta-label">Periode</div><div class="meta-value">Test Period</div></div>
      <div class="meta-card"><div class="meta-label">Total Peserta</div><div class="meta-value">${totalParticipants}</div></div>
      <div class="meta-card"><div class="meta-label">Total Angkatan</div><div class="meta-value">${totalCohorts}</div></div>
    </div>
    <div class="content">${phaseSections || '<div>Belum ada peserta</div>'}</div>
    <div class="footer"><span>Dicetak dari Sistem PKDP</span><span>Test</span></div>
  </div>
</body>
</html>`;

    fs.writeFileSync('c:\\temp\\test-pdf.html', html);
    console.log('HTML saved to c:\\temp\\test-pdf.html');
    console.log('Open this file in a browser and check if header + Angkatan 1 fits on page 1');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
})();
