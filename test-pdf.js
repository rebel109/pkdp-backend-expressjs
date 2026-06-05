const db = require('./config/db');
const fs = require('fs');

(async () => {
  try {
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
    if (rows.length === 0) { process.exit(0); }

    // Group by cohort_no → phase → class_name
    const cohortData = {};
    rows.forEach(row => {
      const cohortNo = row.cohort_no || 0;
      const className = row.class_name || 'ISC1';
      const phase = row.class_phase || 'ISC1';
      if (!cohortData[cohortNo]) cohortData[cohortNo] = { cohort_no: cohortNo, phases: {} };
      if (!cohortData[cohortNo].phases[phase]) cohortData[cohortNo].phases[phase] = {};
      if (!cohortData[cohortNo].phases[phase][className]) cohortData[cohortNo].phases[phase][className] = [];
      cohortData[cohortNo].phases[phase][className].push(row);
    });

    const totalParticipants = new Set(rows.map(r => r.user_id)).size;
    const totalCohorts = new Set(rows.map(r => r.cohort_no).filter(Boolean)).size;
    const sortedCohorts = Object.keys(cohortData).sort((a, b) => Number(a) - Number(b));

    const sections = sortedCohorts.map((cohortNo, i) => {
      const cohort = cohortData[cohortNo];
      const cohortLabel = cohortNo ? `Angkatan ${cohortNo}` : 'Tanpa Angkatan';
      const pageBreak = i > 0 ? ' style="page-break-before:always;"' : '';

      const allClasses = [];
      const phaseOrder = ['ISC1', 'OJC', 'ISC2'];
      const phaseColors = { ISC1: '#1e40af', OJC: '#047857', ISC2: '#7c3aed' };
      const phaseLabels = { ISC1: 'ISC 1', OJC: 'OJC', ISC2: 'ISC 2' };

      for (const phase of phaseOrder) {
        const classNames = Object.keys(cohort.phases[phase] || {});
        for (const className of classNames.sort()) {
          const participants = cohort.phases[phase][className];
          allClasses.push({ phase, className, participants, color: phaseColors[phase] });
        }
      }

      const classHtml = allClasses.map(({ phase, className, participants, color }) => {
        const body = participants.map((r, j) => `<tr><td class="no">${j+1}</td><td>${r.identity_no||'—'}</td><td>${r.name||'—'}</td></tr>`).join('');
        return `<div class="class-card">
          <div class="class-head">
            <span class="phase-badge" style="background:${color}">${phaseLabels[phase]}</span>
            <span class="class-name">${className}</span>
            <span class="class-count">${participants.length} peserta</span>
          </div>
          <table>
            <thead><tr><th class="no">No</th><th>NIDN/NUPTK</th><th>Nama Peserta</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
      }).join('');

      return `<div class="angkatan-wrapper"${pageBreak}>
        <div class="angkatan-title">${cohortLabel}</div>
        ${classHtml}
      </div>`;
    }).join('');

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Daftar Kelas Peserta PKDP</title>
  <style>
    @page{size:A4;margin:12mm 10mm}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:10px;background:#fff}

    .sheet{border:1px solid #d7e3f4;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(30,64,175,.08)}
    .header{padding:16px 20px;background:linear-gradient(135deg,#123f5c 0%,#0f5f8f 52%,#1db6e7 100%);color:#fff;position:relative}
    .header:after{content:"";position:absolute;right:-42px;top:-50px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.18)}
    .eyebrow{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.9;margin-bottom:5px}
    h1{font-size:19px;margin:0 0 5px;text-transform:uppercase;letter-spacing:.03em;line-height:1.2}
    .subtitle{font-size:10px;opacity:.92;max-width:680px;line-height:1.4;margin:0}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 14px;background:#f7fbff;border-bottom:1px solid #d7e3f4}
    .meta-card{padding:7px 10px;border:1px solid #dbeafe;border-radius:10px;background:#fff}
    .meta-label{font-size:7px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:800;margin-bottom:3px}
    .meta-value{font-size:11px;color:#0f172a;font-weight:700;line-height:1.3}

    .content{padding:8px 14px}

    /* ANGKATAN */
    .angkatan-wrapper{margin-bottom:0}
    .angkatan-title{font-size:14px;font-weight:800;color:#0f172a;margin:2px 0 6px;padding:4px 0;border-bottom:3px solid #0f5f8f}

    /* CLASS CARD */
    .class-card{margin-bottom:5px;page-break-inside:avoid}
    .class-head{display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap}
    .phase-badge{display:inline-block;font-size:8px;font-weight:800;color:#fff;padding:1px 7px;border-radius:3px;letter-spacing:.04em}
    .class-name{font-size:11px;font-weight:700;color:#0f172a}
    .class-count{font-size:8px;color:#64748b;margin-left:auto}

    /* TABLE */
    table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden}
    th,td{padding:3px 6px;vertical-align:top;line-height:1.25;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
    th:last-child,td:last-child{border-right:0}
    tbody tr:last-child td{border-bottom:0}
    th{background:#0f5f8f;color:#fff;text-align:left;font-weight:700;font-size:7px;text-transform:uppercase;letter-spacing:.04em}
    tbody tr:nth-child(even){background:#f8fafc}
    .no{width:24px;text-align:center;font-weight:700;color:#0f5f8f;font-size:9px}
    th.no{color:#fff;text-align:center}

    /* FOOTER */
    .footer{padding:6px 14px;background:#f8fafc;color:#64748b;font-size:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:10px}
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="eyebrow">Daftar Kelas PKDP</div>
      <h1>Daftar Kelas Peserta</h1>
      <div class="subtitle">Peserta dikelompokkan per angkatan, dilengkapi fase dan kelas masing-masing.</div>
    </div>
    <div class="meta">
      <div class="meta-card"><div class="meta-label">Periode</div><div class="meta-value">Test Period</div></div>
      <div class="meta-card"><div class="meta-label">Total Peserta</div><div class="meta-value">${totalParticipants}</div></div>
      <div class="meta-card"><div class="meta-label">Total Angkatan</div><div class="meta-value">${totalCohorts}</div></div>
    </div>
    <div class="content">${sections || '<div style="padding:16px;color:#64748b;text-align:center;font-weight:700">Belum ada peserta</div>'}</div>
    <div class="footer"><span>Dicetak dari Sistem PKDP</span><span>Test</span></div>
  </div>
</body>
</html>`;

    fs.writeFileSync('c:\\temp\\test-pdf.html', html);
    console.log('HTML saved to c:\\temp\\test-pdf.html');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
})();
