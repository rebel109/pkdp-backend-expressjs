const db=require('../config/db');
const puppeteer=require('puppeteer');

const formatDateTime=value=>value?new Date(value).toLocaleString('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const escapeHtml=value=>String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const pdfFileNamePart=value=>String(value||'rekap-survei').replace(/[^a-zA-Z0-9-_]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'rekap-survei';

const getLocalBrowserPath=()=>{
  const candidates=[
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  return candidates.find(path=>require('fs').existsSync(path));
};

const buildPdfChartSliceData=items=>{
  const total=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
  let angle=0;
  const pieParts=[];
  const rows=items.map((item,index)=>{
    const qty=Number(item.quantity||0);
    const pct=total?((qty/total)*100):0;
    const next=angle+(total?(qty/total)*360:0);
    if(qty) pieParts.push(`${item.color} ${angle}deg ${next}deg`);
    angle=next;
    return {...item,no:index+1,percent:pct};
  });
  if(angle<360) pieParts.push(`#e5e7eb ${angle}deg 360deg`);
  return {rows,total,pieStyle:pieParts.length?`conic-gradient(${pieParts.join(',')})`:'#e5e7eb'};
};

const buildSurveyPdfSections=data=>{
  const isIsc1=data?.survey?.survey_kind==='PHASE_MAPPING_BUNDLE'&&data?.survey?.phase==='ISC1';
  if(isIsc1){
    const details=data?.details||[];
    const questions=data?.questions||[];
    const rows=data?.survey?.matrix_rows||[];
    return rows.map(row=>{
      const counts={a:0,b:0,c:0,d:0,e:0,'1':0,'2':0,'3':0,'4':0};
      const questionTypes=new Set();
      const optionLabels={a:'Opsi A',b:'Opsi B',c:'Opsi C',d:'Opsi D',e:'Opsi E'};
      const respondentIds=new Set();
      for(const detail of details){
        let scoredByThisRespondent=false;
        for(const question of questions){
          const answers=Array.isArray(detail?.answers?.[question.id])?detail.answers[question.id]:[];
          for(const answer of answers){
            if(Number(answer?.isc1_assignment_id)!==Number(row.id)) continue;
            questionTypes.add(question.question_type);
            if(question.question_type==='single_choice'){
              const key=String(answer?.answer_choice||'').toLowerCase();
              if(key&&key in counts){ counts[key]+=1; optionLabels[key]=question?.[`option_${key}`]||optionLabels[key]||String(key).toUpperCase(); scoredByThisRespondent=true; }
            }
            if(question.question_type==='scale_1_4'){
              const key=String(answer?.answer_scale||'');
              if(key&&key in counts){ counts[key]+=1; scoredByThisRespondent=true; }
            }
          }
        }
        if(scoredByThisRespondent) respondentIds.add(detail.response_id||detail.user_id||detail.email);
      }
      const useScale=questionTypes.has('scale_1_4');
      const items=useScale
        ?[{label:'Sangat Baik',key:'4',color:'#10b981',quantity:counts['4'],weight:4},{label:'Baik',key:'3',color:'#3b82f6',quantity:counts['3'],weight:3},{label:'Cukup',key:'2',color:'#f59e0b',quantity:counts['2'],weight:2},{label:'Kurang',key:'1',color:'#ef4444',quantity:counts['1'],weight:1}]
        :[{label:optionLabels.a,key:'a',color:'#2563eb',quantity:counts.a},{label:optionLabels.b,key:'b',color:'#10b981',quantity:counts.b},{label:optionLabels.c,key:'c',color:'#f59e0b',quantity:counts.c},{label:optionLabels.d,key:'d',color:'#ef4444',quantity:counts.d},{label:optionLabels.e,key:'e',color:'#8b5cf6',quantity:counts.e}].filter(item=>item.quantity>0);
      const chart=buildPdfChartSliceData(items);
      const totalScore=useScale?items.reduce((sum,item)=>sum+(item.quantity*(item.weight||0)),0):chart.total;
      const average=chart.total?useScale?(totalScore/chart.total).toFixed(2):chart.total:0;
      return {
        title:row.narasumber_name||'Narasumber',
        subtitle:`${row.material_title||'—'} · ${row.class_name||'—'}`,
        respondentCount:respondentIds.size,
        useScale,
        chart,
        totalScore,
        average
      };
    }).filter(section=>section.chart.total>0);
  }

  const aggregates=data?.aggregates||[];
  const choiceAggregate=aggregates.find(a=>a.question_type==='single_choice');
  const scaleAggregate=aggregates.find(a=>a.question_type==='scale_1_4');
  if(scaleAggregate){
    const items=[{label:'Sangat Baik',key:'4',color:'#10b981',quantity:Number(scaleAggregate.counts?.['4']||0),weight:4},{label:'Baik',key:'3',color:'#3b82f6',quantity:Number(scaleAggregate.counts?.['3']||0),weight:3},{label:'Cukup',key:'2',color:'#f59e0b',quantity:Number(scaleAggregate.counts?.['2']||0),weight:2},{label:'Kurang',key:'1',color:'#ef4444',quantity:Number(scaleAggregate.counts?.['1']||0),weight:1}];
    const chart=buildPdfChartSliceData(items);
    const totalScore=items.reduce((sum,item)=>sum+(item.quantity*(item.weight||0)),0);
    return [{title:'Rekap Nilai Keseluruhan',subtitle:'Gabungan seluruh penilaian',respondentCount:data?.summary?.responded_count||0,useScale:true,chart,totalScore,average:chart.total?(totalScore/chart.total).toFixed(2):0}].filter(section=>section.chart.total>0);
  }
  if(choiceAggregate){
    const optionLabels={a:choiceAggregate.option_a||'Opsi A',b:choiceAggregate.option_b||'Opsi B',c:choiceAggregate.option_c||'Opsi C',d:choiceAggregate.option_d||'Opsi D',e:choiceAggregate.option_e||'Opsi E'};
    const items=[{label:optionLabels.a,key:'a',color:'#2563eb',quantity:Number(choiceAggregate.counts?.a||0)},{label:optionLabels.b,key:'b',color:'#10b981',quantity:Number(choiceAggregate.counts?.b||0)},{label:optionLabels.c,key:'c',color:'#f59e0b',quantity:Number(choiceAggregate.counts?.c||0)},{label:optionLabels.d,key:'d',color:'#ef4444',quantity:Number(choiceAggregate.counts?.d||0)},{label:optionLabels.e,key:'e',color:'#8b5cf6',quantity:Number(choiceAggregate.counts?.e||0)}].filter(item=>item.quantity>0);
    const chart=buildPdfChartSliceData(items);
    return [{title:'Rekap Pilihan Keseluruhan',subtitle:'Gabungan seluruh penilaian',respondentCount:data?.summary?.responded_count||0,useScale:false,chart,totalScore:chart.total,average:chart.total}].filter(section=>section.chart.total>0);
  }
  return [];
};

const renderSurveyRecapPdfHtml=({data,query})=>{
  const surveyTitle=data?.survey?.title||'Rekap Survei';
  const roleLabel=query?.target_role==='NARASUMBER'?'Narasumber':'Peserta';
  const generatedAt=formatDateTime(new Date());
  const summary=data?.summary||{};
  const sections=buildSurveyPdfSections(data);
  const respondentRows=(data?.details||[]).map((detail,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(detail.name)}</td><td>${escapeHtml(detail.email)}</td><td>${escapeHtml(formatDateTime(detail.updated_at))}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Belum ada responden</td></tr>';
  const sectionHtml=sections.map(section=>{
    const legendHtml=section.chart.rows.map(row=>`<div class="legend-item"><span class="dot" style="background:${row.color}"></span>${escapeHtml(row.label)}</div>`).join('');
    const rowsHtml=section.chart.rows.map(row=>`<tr><td>${row.no}</td><td>${escapeHtml(row.label)}</td><td>${row.quantity}</td>${section.useScale?`<td>${row.weight||0}</td>`:''}<td>${section.useScale?row.quantity*(row.weight||0):row.quantity}</td><td>${row.percent.toFixed(1)}%</td></tr>`).join('')||`<tr><td colspan="${section.useScale?6:5}" class="empty">Belum ada data</td></tr>`;
    return `
      <section class="narasumber-card">
        <div class="narasumber-head">
          <div>
            <h3>${escapeHtml(section.title)}</h3>
            <div class="meta-line">${escapeHtml(section.subtitle)}</div>
          </div>
          <div class="meta-count">${escapeHtml(section.respondentCount)} penilai</div>
        </div>
        <div class="chart-grid">
          <div class="pie-wrap"><div class="pie" style="background:${section.chart.pieStyle}"></div></div>
          <div class="legend">${legendHtml||'<div class="muted">Belum ada data</div>'}</div>
        </div>
        <table>
          <thead><tr><th>No</th><th>Jawaban</th><th>Kuantitas</th>${section.useScale?'<th>Bobot</th>':''}<th>${section.useScale?'Kuantitas × Bobot':'Kuantitas'}</th><th>%</th></tr></thead>
          <tbody>${rowsHtml}<tr><td colspan="2" style="font-weight:700">Total</td><td style="font-weight:700">${section.chart.total}</td>${section.useScale?'<td>—</td>':''}<td style="font-weight:700">${section.totalScore}</td><td style="font-weight:700">${section.average}</td></tr></tbody>
        </table>
      </section>`;
  }).join('')||'<div class="empty">Belum ada data recap untuk diekspor.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:10px;background:#fff}
    .sheet{border:1px solid #d7e3f4;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(30,64,175,.08)}
    .header{padding:22px 26px;background:linear-gradient(135deg,#123f5c 0%,#0f5f8f 52%,#1db6e7 100%);color:#fff;position:relative}
    .header:after{content:"";position:absolute;right:-42px;top:-50px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.18)}
    .eyebrow{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.9;margin-bottom:7px}
    h1{font-size:22px;margin:0 0 7px;text-transform:uppercase;letter-spacing:.03em;line-height:1.2}
    .subtitle{font-size:12px;opacity:.92;max-width:680px;line-height:1.5}
    .meta{display:grid;grid-template-columns:1.25fr 1fr 1.2fr 1.15fr;gap:10px;padding:14px 18px;background:#f7fbff;border-bottom:1px solid #d7e3f4}
    .meta-card{padding:10px 12px;border:1px solid #dbeafe;border-radius:12px;background:#fff}
    .meta-label{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:800;margin-bottom:4px}
    .meta-value{font-size:11px;color:#0f172a;font-weight:700;line-height:1.35}
    .content{padding:18px}
    h2{font-size:15px;margin:0 0 12px;color:#0f172a}
    h3{font-size:14px;margin:0 0 4px;line-height:1.4}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
    .stat{border:1px solid #dbeafe;border-radius:12px;padding:10px 12px;background:#fff}
    .stat-value{font-size:18px;font-weight:800;color:#0f5f8f;margin-bottom:4px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
    .narasumber-card{border:1px solid #d1d5db;border-radius:14px;padding:14px;margin-bottom:14px;page-break-inside:avoid;background:#fff}
    .narasumber-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:12px}
    .meta-line{color:#6b7280;font-size:11px;line-height:1.5}
    .meta-count{border:1px solid #dbeafe;background:#f8fbff;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;color:#1d4ed8}
    .chart-grid{display:grid;grid-template-columns:240px 1fr;gap:18px;align-items:start;margin-bottom:12px}
    .pie-wrap{display:flex;justify-content:center;align-items:center}
    .pie{width:220px;height:220px;border-radius:50%;border:1px solid #e5e7eb}
    .legend{display:grid;gap:8px;padding-top:10px}
    .legend-item{display:flex;align-items:center;gap:8px;font-size:12px}
    .dot{width:11px;height:11px;border-radius:999px;display:inline-block}
    .table-title{display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px;color:#334155;font-size:11px}
    .table-title strong{font-size:13px;color:#0f172a}
    table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden}
    th,td{padding:8px 9px;vertical-align:top;line-height:1.4;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
    th:last-child,td:last-child{border-right:0}
    tbody tr:last-child td{border-bottom:0}
    th{background:#123f5c;color:#fff;text-align:left;font-weight:800;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
    tbody tr:nth-child(even){background:#f8fafc}
    tbody tr:nth-child(odd){background:#fff}
    .empty{text-align:center;color:#64748b;padding:18px;font-weight:700}
    .footer{padding:11px 18px;background:#f8fafc;color:#64748b;font-size:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:10px}
  </style></head><body>
    <div class="sheet">
      <div class="header">
        <div class="eyebrow">Rekap Survei PKDP</div>
        <h1>Data Rekap Survei</h1>
        <div class="subtitle">Ringkasan hasil survei berdasarkan filter aktif, lengkap dengan distribusi penilaian dan daftar responden.</div>
      </div>
      <div class="meta">
        <div class="meta-card"><div class="meta-label">Survei</div><div class="meta-value">${escapeHtml(surveyTitle)}</div></div>
        <div class="meta-card"><div class="meta-label">Role</div><div class="meta-value">${escapeHtml(roleLabel)}</div></div>
        <div class="meta-card"><div class="meta-label">Periode</div><div class="meta-value">${escapeHtml(query?.period_id||'—')}</div></div>
        <div class="meta-card"><div class="meta-label">Dicetak</div><div class="meta-value">${escapeHtml(generatedAt)}</div></div>
      </div>
      <div class="content">
        <div class="stats">
          <div class="stat"><div class="stat-value">${summary.total_target||0}</div><div class="stat-label">Target</div></div>
          <div class="stat"><div class="stat-value">${summary.responded_count||0}</div><div class="stat-label">Sudah Isi</div></div>
          <div class="stat"><div class="stat-value">${summary.not_responded_count||0}</div><div class="stat-label">Belum Isi</div></div>
          <div class="stat"><div class="stat-value">${summary.response_rate||0}%</div><div class="stat-label">Response Rate</div></div>
        </div>
        <h2>${data?.survey?.survey_kind==='PHASE_MAPPING_BUNDLE'&&data?.survey?.phase==='ISC1'?'Rekap per Narasumber':'Rekap Keseluruhan'}</h2>
        ${sectionHtml}
        <div class="table-title"><strong>Daftar Responden</strong><span>Dicetak: ${escapeHtml(generatedAt)}</span></div>
        <table><thead><tr><th>No</th><th>Nama</th><th>Email</th><th>Waktu Submit</th></tr></thead><tbody>${respondentRows}</tbody></table>
      </div>
      <div class="footer"><span>Dicetak dari Sistem PKDP</span><span>${escapeHtml(generatedAt)}</span></div>
    </div>
  </body></html>`;
};

const exportSurveyRecapPdfBuffer=async query=>{
  let browser;
  try{
    const data=await getAdminRecapData(query);
    const html=renderSurveyRecapPdfHtml({data,query});
    const executablePath=getLocalBrowserPath();
    browser=await puppeteer.launch({headless:'new',executablePath,args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:'networkidle0'});
    return await page.pdf({format:'A4',printBackground:true,margin:{top:'14mm',right:'12mm',bottom:'14mm',left:'12mm'}});
  }finally{ if(browser) await browser.close(); }
};

const sendSurveyRecapPdf=async(req,res,next)=>{
  try{
    const pdf=await exportSurveyRecapPdfBuffer(req.query);
    const suffix=pdfFileNamePart(req.query?.survey_instance_id||'rekap-survei');
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="rekap-survei-${suffix}.pdf"`);
    res.send(Buffer.from(pdf));
  }catch(e){next(e);}
};

const renderSurveyRecapCsv=async query=>buildRecapCsv(await getAdminRecapData(query));
const getAdminRecapCsvData=async(query)=>renderSurveyRecapCsv(query);

const parseChoiceQuestion=q=>({
  ...q,
  options:[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e].filter(Boolean)
});

const activeWindowWhere=`sa.is_active=1 AND (sa.opens_at IS NULL OR sa.opens_at<=NOW()) AND (sa.closes_at IS NULL OR sa.closes_at>=NOW())`;

const isAnswerComplete=(answer,q)=>{
  if(!q) return false;
  if(q.question_type==='text') return String(answer?.answer_text||'').trim().length>0;
  if(q.question_type==='single_choice') return !!String(answer?.answer_choice||'').trim();
  if(q.question_type==='scale_1_4') return [1,2,3,4].includes(Number(answer?.answer_scale));
  return false;
};

const ensureSurveyAnswersComplete=({answers,questions,scopeResolver,scopeValues})=>{
  if(!Array.isArray(answers)||!answers.length||!Array.isArray(questions)||!questions.length) return false;
  const answerMap=new Map();
  for(const answer of answers){
    const scopeKey=scopeResolver(answer);
    if(scopeKey==null) return false;
    answerMap.set(`${scopeKey}:${answer.question_id}`,answer);
  }
  return scopeValues.every(scope=>questions.every(q=>isAnswerComplete(answerMap.get(`${scope}:${q.id}`),q)));
};

const parseActivationToken=id=>{
  const m=String(id||'').match(/^act-(\d+)(?:-map-(\d+)|-ojc)$/);
  if(!m) return null;
  return {activationId:Number(m[1]),mappingId:m[2]?Number(m[2]):null};
};

const getIsc1ActivationBundles=async(user)=>{
  if(user.role!=='DOSEN') return [];
  const[rows]=await db.query(
    `SELECT CONCAT('act-',sa.id,'-map-',MIN(sia.id)) AS id,'activation' AS source_type,sa.id AS activation_id,MIN(sia.id) AS mapping_id,
            sa.phase,'PHASE_MAPPING_BUNDLE' AS survey_kind,sa.title,sa.description,sa.period_id,p.label AS period_label,sa.target_role,sa.lock_required,
            COUNT(DISTINCT sbq.id) AS question_count,sar.id AS response_id,sar.submitted_at,sar.submitted_at AS updated_at,
            CONCAT('Angkatan ',co.cohort_no) AS class_name,
            CONCAT(COUNT(DISTINCT sia.id),' evaluasi narasumber') AS material_title,
            CONCAT(COUNT(DISTINCT sia.narasumber_id),' narasumber') AS narasumber_name,
            NULL AS category_key,NULL AS category_title,COUNT(DISTINCT sia.narasumber_id) AS narasumber_count,
            COUNT(DISTINCT sia.id) AS matrix_row_count
     FROM survey_activations sa
     JOIN periods p ON p.id=sa.period_id
     JOIN survey_activation_mappings sam ON sam.activation_id=sa.id AND sam.isc1_assignment_id IS NOT NULL
     JOIN survey_isc1_assignments sia ON sia.id=sam.isc1_assignment_id AND sia.is_active=1
     JOIN cohorts co ON co.id=sia.cohort_id
     LEFT JOIN survey_bank_questions sbq ON sbq.bank_id=sia.bank_id
     LEFT JOIN survey_activation_responses sar ON sar.activation_id=sa.id AND sar.user_id=? AND sar.mapping_id IS NULL
     WHERE ${activeWindowWhere} AND sa.phase='ISC1' AND sa.target_role=?
       AND sia.cohort_id IN (
         SELECT DISTINCT c.cohort_id
         FROM class_members cm
         JOIN classes c ON c.id=cm.class_id
         WHERE cm.user_id=? AND c.cohort_id IS NOT NULL
       )
     GROUP BY sa.id,sar.id,co.cohort_no
     ORDER BY sa.id DESC`,
    [user.id,user.role,user.id]
  );
  return rows;
};

const getActivationObligations=async(user)=>{
  const isc1Rows=await getIsc1ActivationBundles(user);
  const[ojcRows]=await db.query(
    `SELECT CONCAT('act-',sa.id,'-ojc') AS id,'activation' AS source_type,sa.id AS activation_id,NULL AS mapping_id,
            sa.phase,'OJC_GLOBAL' AS survey_kind,sa.title,sa.description,sa.period_id,p.label AS period_label,sa.target_role,sa.lock_required,
            COUNT(DISTINCT sbq.id) AS question_count,sar.id AS response_id,sar.submitted_at,sar.submitted_at AS updated_at,
            NULL AS class_name,NULL AS material_title,NULL AS narasumber_name,soc.category_key,soc.title AS category_title,NULL AS narasumber_count,
            NULL AS matrix_row_count
     FROM survey_activations sa
     JOIN periods p ON p.id=sa.period_id
     LEFT JOIN survey_ojc_categories soc ON soc.id=sa.ojc_category_id
     LEFT JOIN survey_bank_questions sbq ON sbq.bank_id=sa.bank_id
     LEFT JOIN survey_activation_responses sar ON sar.activation_id=sa.id AND sar.user_id=? AND sar.mapping_id IS NULL
     WHERE ${activeWindowWhere} AND sa.phase='OJC' AND sa.target_role=?
     GROUP BY sa.id,sar.id
     ORDER BY sa.id DESC`,
    [user.id,user.role]
  );
  return [...isc1Rows,...ojcRows];
};

const getActivationDetail=async({token,user})=>{
  const parsed=parseActivationToken(token);
  if(!parsed) return null;

  if(parsed.mappingId){
    if(user.role!=='DOSEN') return null;
    const[[row]]=await db.query(
      `SELECT sa.*,p.label AS period_label,'activation' AS source_type,NULL AS mapping_id,
              CONCAT('Angkatan ',co.cohort_no) AS class_name,
              CONCAT(COUNT(DISTINCT sia.id),' evaluasi narasumber') AS material_title,
              CONCAT(COUNT(DISTINCT sia.narasumber_id),' narasumber') AS narasumber_name,
              NULL AS category_key,NULL AS category_title,
              COALESCE(MIN(sia.bank_id),sa.bank_id) AS effective_bank_id,
              sar.id AS response_id,sar.submitted_at
       FROM survey_activations sa
       JOIN periods p ON p.id=sa.period_id
       JOIN survey_activation_mappings sam ON sam.activation_id=sa.id AND sam.isc1_assignment_id IS NOT NULL
       JOIN survey_isc1_assignments sia ON sia.id=sam.isc1_assignment_id AND sia.is_active=1
       JOIN cohorts co ON co.id=sia.cohort_id
       LEFT JOIN survey_activation_responses sar ON sar.activation_id=sa.id AND sar.user_id=? AND sar.mapping_id IS NULL
       WHERE ${activeWindowWhere} AND sa.id=? AND sa.phase='ISC1' AND sa.target_role=?
         AND sia.cohort_id IN (
           SELECT DISTINCT c.cohort_id
           FROM class_members cm
           JOIN classes c ON c.id=cm.class_id
           WHERE cm.user_id=? AND c.cohort_id IS NOT NULL
         )
       GROUP BY sa.id,sar.id,co.cohort_no
       LIMIT 1`,
      [user.id,parsed.activationId,user.role,user.id]
    );
    if(!row) return null;
    const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[row.effective_bank_id]);
    const[matrixRows]=await db.query(
      `SELECT sia.id,CONCAT('Angkatan ',co.cohort_no) AS class_name,co.id AS cohort_id,co.cohort_no,sim.name AS material_title,NULL AS task_id,
              sin.id AS narasumber_id,sin.name AS narasumber_name,sia.bank_id,sam.activation_id
       FROM survey_activation_mappings sam
       JOIN survey_isc1_assignments sia ON sia.id=sam.isc1_assignment_id AND sia.is_active=1
       JOIN cohorts co ON co.id=sia.cohort_id
       JOIN survey_isc1_materials sim ON sim.id=sia.material_id
       JOIN survey_isc1_narasumbers sin ON sin.id=sia.narasumber_id
       WHERE sam.activation_id=?
         AND sia.cohort_id IN (
           SELECT DISTINCT c.cohort_id
           FROM class_members cm
           JOIN classes c ON c.id=cm.class_id
           WHERE cm.user_id=? AND c.cohort_id IS NOT NULL
         )
       ORDER BY co.cohort_no,sim.name,sin.name,sia.id`,
      [parsed.activationId,user.id]
    );
    let answers=[];
    if(row.response_id){
      const[a]=await db.query('SELECT * FROM survey_activation_response_answers WHERE response_id=? ORDER BY isc1_assignment_id,question_id,id',[row.response_id]);
      answers=a;
    }
    return {
      ...row,
      activation_id:row.id,
      id:token,
      survey_kind:'PHASE_MAPPING_BUNDLE',
      phase:'ISC1',
      questions:questions.map(parseChoiceQuestion),
      matrix_rows:matrixRows,
      response:row.response_id?{id:row.response_id,submitted_at:row.submitted_at}:null,
      answers,
      ojc_category:null
    };
  }

  const[[row]]=await db.query(
    `SELECT sa.*,p.label AS period_label,'activation' AS source_type,
            NULL AS mapping_id,NULL AS material_title,NULL AS class_name,NULL AS narasumber_name,soc.category_key,soc.title AS category_title,sa.bank_id AS effective_bank_id,
            sar.id AS response_id,sar.submitted_at
     FROM survey_activations sa
     JOIN periods p ON p.id=sa.period_id
     LEFT JOIN survey_ojc_categories soc ON soc.id=sa.ojc_category_id
     LEFT JOIN survey_activation_responses sar ON sar.activation_id=sa.id AND sar.user_id=? AND sar.mapping_id IS NULL
     WHERE ${activeWindowWhere} AND sa.id=? AND sa.target_role=? AND sa.phase='OJC'
     LIMIT 1`,
    [user.id,parsed.activationId,user.role]
  );
  if(!row) return null;
  const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[row.effective_bank_id]);
  let answers=[];
  if(row.response_id){
    const[a]=await db.query('SELECT * FROM survey_activation_response_answers WHERE response_id=?',[row.response_id]);
    answers=a;
  }
  return {...row,activation_id:row.id,id:token,survey_kind:'OJC_GLOBAL',questions:questions.map(parseChoiceQuestion),response:row.response_id?{id:row.response_id,submitted_at:row.submitted_at}:null,answers,ojc_category:row.category_key?{category_key:row.category_key,title:row.category_title}:null};
};

const getActivationAdminDetail=async({token,targetRole})=>{
  const parsed=parseActivationToken(token);
  if(!parsed) return null;

  if(parsed.mappingId){
    const[[row]]=await db.query(
      `SELECT sa.*,p.label AS period_label,'activation' AS source_type,NULL AS mapping_id,
              CONCAT('Angkatan ',co.cohort_no) AS class_name,
              CONCAT(COUNT(DISTINCT sia.id),' evaluasi narasumber') AS material_title,
              CONCAT(COUNT(DISTINCT sia.narasumber_id),' narasumber') AS narasumber_name,
              NULL AS category_key,NULL AS category_title,
              COALESCE(MIN(sia.bank_id),sa.bank_id) AS effective_bank_id
       FROM survey_activations sa
       JOIN periods p ON p.id=sa.period_id
       JOIN survey_activation_mappings sam ON sam.activation_id=sa.id AND sam.isc1_assignment_id IS NOT NULL
       JOIN survey_isc1_assignments sia ON sia.id=sam.isc1_assignment_id AND sia.is_active=1
       JOIN cohorts co ON co.id=sia.cohort_id
       WHERE sa.id=? AND sa.phase='ISC1' AND sa.target_role=?
       GROUP BY sa.id,co.cohort_no
       LIMIT 1`,
      [parsed.activationId,targetRole]
    );
    if(!row) return null;
    const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[row.effective_bank_id]);
    const[matrixRows]=await db.query(
      `SELECT sia.id,CONCAT('Angkatan ',co.cohort_no) AS class_name,co.id AS cohort_id,co.cohort_no,sim.name AS material_title,NULL AS task_id,
              sin.id AS narasumber_id,sin.name AS narasumber_name,sia.bank_id,sam.activation_id
       FROM survey_activation_mappings sam
       JOIN survey_isc1_assignments sia ON sia.id=sam.isc1_assignment_id AND sia.is_active=1
       JOIN cohorts co ON co.id=sia.cohort_id
       JOIN survey_isc1_materials sim ON sim.id=sia.material_id
       JOIN survey_isc1_narasumbers sin ON sin.id=sia.narasumber_id
       WHERE sam.activation_id=?
       ORDER BY co.cohort_no,sim.name,sin.name,sia.id`,
      [parsed.activationId]
    );
    return {...row,activation_id:row.id,id:token,survey_kind:'PHASE_MAPPING_BUNDLE',phase:'ISC1',questions:questions.map(parseChoiceQuestion),matrix_rows:matrixRows,ojc_category:null};
  }

  const[[row]]=await db.query(
    `SELECT sa.*,p.label AS period_label,'activation' AS source_type,
            NULL AS mapping_id,NULL AS material_title,NULL AS class_name,NULL AS narasumber_name,soc.category_key,soc.title AS category_title,sa.bank_id AS effective_bank_id
     FROM survey_activations sa
     JOIN periods p ON p.id=sa.period_id
     LEFT JOIN survey_ojc_categories soc ON soc.id=sa.ojc_category_id
     WHERE sa.id=? AND sa.target_role=? AND sa.phase='OJC'
     LIMIT 1`,
    [parsed.activationId,targetRole]
  );
  if(!row) return null;
  const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[row.effective_bank_id]);
  return {...row,activation_id:row.id,id:token,survey_kind:'OJC_GLOBAL',questions:questions.map(parseChoiceQuestion),ojc_category:row.category_key?{category_key:row.category_key,title:row.category_title}:null};
};

const getGeneralSurveyTargetCount=async({instanceId,targetRole,periodId})=>{
  if(targetRole==='DOSEN'){
    const[[row]]=await db.query(
      `SELECT COUNT(DISTINCT cm.user_id) AS total
       FROM class_members cm
       JOIN classes c ON c.id=cm.class_id
       JOIN users u ON u.id=cm.user_id
       WHERE c.period_id=? AND u.role='DOSEN' AND u.status='active'`,
      [periodId]
    );
    return Number(row?.total||0);
  }
  const[[row]]=await db.query(
    `SELECT COUNT(*) AS total
     FROM users u
     WHERE u.period_id=? AND u.role=? AND u.status='active'`,
    [periodId,targetRole]
  );
  return Number(row?.total||0);
};

const buildGeneralSurveyRecap=async({survey,questions})=>{
  const totalTarget=await getGeneralSurveyTargetCount({instanceId:survey.id,targetRole:survey.target_role,periodId:survey.period_id});
  const[detailRows]=await db.query(
    `SELECT sr.id AS response_id,sr.user_id,sr.submitted_at,sr.updated_at,
            u.name,u.email,
            sra.question_id,sra.answer_text,sra.answer_choice,sra.answer_scale
     FROM survey_responses sr
     JOIN users u ON u.id=sr.user_id
     LEFT JOIN survey_response_answers sra ON sra.response_id=sr.id
     WHERE sr.instance_id=?
     ORDER BY sr.updated_at DESC,sr.id DESC,sra.question_id,sra.id`,
    [survey.id]
  );

  const detailMap=new Map();
  for(const row of detailRows){
    if(!detailMap.has(row.response_id)){
      detailMap.set(row.response_id,{
        response_id:row.response_id,
        user_id:row.user_id,
        name:row.name,
        email:row.email,
        updated_at:row.updated_at||row.submitted_at||null,
        answers:{}
      });
    }
    if(row.question_id){
      detailMap.get(row.response_id).answers[row.question_id]={
        question_id:row.question_id,
        answer_text:row.answer_text,
        answer_choice:row.answer_choice,
        answer_scale:row.answer_scale
      };
    }
  }
  const details=[...detailMap.values()];
  const respondedCount=details.length;
  const notRespondedCount=Math.max(totalTarget-respondedCount,0);
  const responseRate=totalTarget?Math.round((respondedCount/totalTarget)*100):0;

  const aggregates=questions.map(q=>({
    question_id:q.id,
    question_text:q.question_text,
    question_type:q.question_type,
    counts:{},
    texts:[]
  }));
  const aggregateMap=new Map(aggregates.map(a=>[a.question_id,a]));
  for(const row of detailRows){
    if(!row.question_id) continue;
    const target=aggregateMap.get(row.question_id);
    if(!target) continue;
    if(target.question_type==='text'){
      if(row.answer_text&&String(row.answer_text).trim()) target.texts.push(row.answer_text);
      continue;
    }
    const key=target.question_type==='scale_1_4'?String(row.answer_scale||''):String(row.answer_choice||'').toLowerCase();
    if(!key) continue;
    target.counts[key]=(target.counts[key]||0)+1;
  }

  return {
    survey,
    questions,
    summary:{
      total_target:totalTarget,
      responded_count:respondedCount,
      not_responded_count:notRespondedCount,
      response_rate:responseRate
    },
    aggregates,
    details
  };
};

const buildEvalSurveyRecap=async({sessionId,survey})=>{
  const[tasks]=await db.query(
    `SELECT t.id,t.title,t.description
     FROM survey_eval_session_tasks sest
     JOIN tasks t ON t.id=sest.task_id
     WHERE sest.session_id=?
     ORDER BY t.order_no,t.title`,
    [sessionId]
  );
  const[narasumbers]=await db.query(
    `SELECT u.id,u.name
     FROM survey_eval_session_narasumbers sesn
     JOIN users u ON u.id=sesn.narasumber_id
     WHERE sesn.session_id=?
     ORDER BY u.name`,
    [sessionId]
  );
  const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[survey.bank_id]);
  const[respondentRows]=await db.query(
    `SELECT DISTINCT u.id AS user_id,u.name,u.email
     FROM class_members cm
     JOIN users u ON u.id=cm.user_id
     WHERE cm.class_id=? AND u.role=? AND u.status='active'
     ORDER BY u.name`,
    [survey.class_id,survey.target_role]
  );
  const[answerRows]=await db.query(
    `SELECT ser.id AS response_id,ser.user_id,ser.submitted_at,ser.submitted_at AS updated_at,
            u.name,u.email,
            seai.task_id,seai.narasumber_id,seai.question_id,seai.answer_text,seai.answer_choice,seai.answer_scale
     FROM survey_eval_responses ser
     JOIN users u ON u.id=ser.user_id
     LEFT JOIN survey_eval_answer_items seai ON seai.response_id=ser.id
     WHERE ser.session_id=?
     ORDER BY ser.submitted_at DESC,ser.id DESC,seai.task_id,seai.narasumber_id,seai.question_id,seai.id`,
    [sessionId]
  );

  const detailMap=new Map();
  for(const row of answerRows){
    if(!detailMap.has(row.response_id)){
      detailMap.set(row.response_id,{
        response_id:row.response_id,
        user_id:row.user_id,
        name:row.name,
        email:row.email,
        updated_at:row.updated_at||row.submitted_at||null,
        answers:{}
      });
    }
    if(row.question_id){
      const answerBucket=detailMap.get(row.response_id).answers;
      if(!Array.isArray(answerBucket[row.question_id])) answerBucket[row.question_id]=[];
      answerBucket[row.question_id].push({
        task_id:row.task_id,
        narasumber_id:row.narasumber_id,
        question_id:row.question_id,
        answer_text:row.answer_text,
        answer_choice:row.answer_choice,
        answer_scale:row.answer_scale
      });
    }
  }
  const details=[...detailMap.values()];
  const totalTarget=respondentRows.length;
  const respondedCount=details.length;
  const notRespondedCount=Math.max(totalTarget-respondedCount,0);
  const responseRate=totalTarget?Math.round((respondedCount/totalTarget)*100):0;

  const aggregates=questions.map(q=>({
    question_id:q.id,
    question_text:q.question_text,
    question_type:q.question_type,
    counts:{},
    texts:[]
  }));
  const aggregateMap=new Map(aggregates.map(a=>[a.question_id,a]));
  for(const row of answerRows){
    if(!row.question_id) continue;
    const target=aggregateMap.get(row.question_id);
    if(!target) continue;
    if(target.question_type==='text'){
      if(row.answer_text&&String(row.answer_text).trim()) target.texts.push(row.answer_text);
      continue;
    }
    const key=target.question_type==='scale_1_4'?String(row.answer_scale||''):String(row.answer_choice||'').toLowerCase();
    if(!key) continue;
    target.counts[key]=(target.counts[key]||0)+1;
  }

  return {
    survey:{...survey,tasks,narasumbers},
    questions:questions.map(parseChoiceQuestion),
    summary:{
      total_target:totalTarget,
      responded_count:respondedCount,
      not_responded_count:notRespondedCount,
      response_rate:responseRate
    },
    aggregates,
    details
  };
};

const getAdminRecapData=async({period_id,target_role,survey_instance_id})=>{
  if(!period_id||!target_role||!survey_instance_id){
    const err=new Error('period_id, target_role, dan survey_instance_id wajib');
    err.statusCode=400;
    throw err;
  }

  if(String(survey_instance_id).startsWith('act-')){
    const activationDetail=await getActivationAdminDetail({token:survey_instance_id,targetRole:target_role});
    if(!activationDetail){
      const err=new Error('Survei aktivasi tidak ditemukan');
      err.statusCode=404;
      throw err;
    }
    const[responseRows]=await db.query(
      `SELECT sar.id AS response_id,sar.user_id,sar.submitted_at,
              u.name,u.email,
              saraa.isc1_assignment_id,saraa.question_id,saraa.answer_text,saraa.answer_choice,saraa.answer_scale
       FROM survey_activation_responses sar
       JOIN users u ON u.id=sar.user_id
       LEFT JOIN survey_activation_response_answers saraa ON saraa.response_id=sar.id
       WHERE sar.activation_id=?
       ORDER BY sar.submitted_at DESC,sar.id DESC,saraa.isc1_assignment_id,saraa.question_id,saraa.id`,
      [activationDetail.activation_id]
    );
    const detailMap=new Map();
    for(const row of responseRows){
      if(!detailMap.has(row.response_id)){
        detailMap.set(row.response_id,{response_id:row.response_id,user_id:row.user_id,name:row.name,email:row.email,updated_at:row.submitted_at||null,answers:{}});
      }
      if(!row.question_id) continue;
      const detail=detailMap.get(row.response_id);
      if(activationDetail.survey_kind==='PHASE_MAPPING_BUNDLE'){
        if(!Array.isArray(detail.answers[row.question_id])) detail.answers[row.question_id]=[];
        detail.answers[row.question_id].push({isc1_assignment_id:row.isc1_assignment_id,question_id:row.question_id,answer_text:row.answer_text,answer_choice:row.answer_choice,answer_scale:row.answer_scale});
      }else{
        detail.answers[row.question_id]={question_id:row.question_id,answer_text:row.answer_text,answer_choice:row.answer_choice,answer_scale:row.answer_scale};
      }
    }
    const details=[...detailMap.values()];
    const questions=activationDetail.questions||[];
    const aggregates=questions.map(q=>({question_id:q.id,question_text:q.question_text,question_type:q.question_type,counts:{},texts:[]}));
    const aggregateMap=new Map(aggregates.map(a=>[a.question_id,a]));
    for(const row of responseRows){
      if(!row.question_id) continue;
      const target=aggregateMap.get(row.question_id);
      if(!target) continue;
      if(target.question_type==='text'){
        if(row.answer_text&&String(row.answer_text).trim()) target.texts.push(row.answer_text);
      }else{
        const key=target.question_type==='scale_1_4'?String(row.answer_scale||''):String(row.answer_choice||'').toLowerCase();
        if(key) target.counts[key]=(target.counts[key]||0)+1;
      }
    }

    let narasumberRecap=[];
    if(activationDetail.survey_kind==='PHASE_MAPPING_BUNDLE'){
      const matrixMap=new Map((activationDetail.matrix_rows||[]).map(row=>[Number(row.id),row]));
      const scaleQuestionIds=new Set(questions.filter(q=>q.question_type==='scale_1_4').map(q=>Number(q.id)));
      const recapMap=new Map();
      for(const row of responseRows){
        const assignmentId=Number(row.isc1_assignment_id||0);
        const questionId=Number(row.question_id||0);
        const scaleValue=Number(row.answer_scale||0);
        if(!assignmentId||!scaleQuestionIds.has(questionId)||!scaleValue) continue;
        const matrixRow=matrixMap.get(assignmentId);
        if(!matrixRow) continue;
        if(!recapMap.has(assignmentId)){
          recapMap.set(assignmentId,{
            isc1_assignment_id:assignmentId,
            class_name:matrixRow.class_name,
            cohort_id:matrixRow.cohort_id,
            cohort_no:matrixRow.cohort_no,
            material_title:matrixRow.material_title,
            narasumber_id:matrixRow.narasumber_id,
            narasumber_name:matrixRow.narasumber_name,
            counts:{kurang:0,cukup:0,baik:0,sangat_baik:0},
            total:0,
            average_score:0,
            percentages:{kurang:0,cukup:0,baik:0,sangat_baik:0}
          });
        }
        const recap=recapMap.get(assignmentId);
        if(scaleValue===1) recap.counts.kurang+=1;
        if(scaleValue===2) recap.counts.cukup+=1;
        if(scaleValue===3) recap.counts.baik+=1;
        if(scaleValue===4) recap.counts.sangat_baik+=1;
        recap.total+=1;
        recap.average_score+=scaleValue;
      }
      narasumberRecap=[...recapMap.values()].map(item=>{
        const total=item.total||1;
        const average=item.total?Number((item.average_score/item.total).toFixed(2)):0;
        return {
          ...item,
          average_score:average,
          percentages:{
            kurang:Math.round((item.counts.kurang/total)*100),
            cukup:Math.round((item.counts.cukup/total)*100),
            baik:Math.round((item.counts.baik/total)*100),
            sangat_baik:Math.round((item.counts.sangat_baik/total)*100)
          }
        };
      }).sort((a,b)=>b.average_score-a.average_score||String(a.narasumber_name||'').localeCompare(String(b.narasumber_name||''),'id-ID'));
    }

    let totalTarget=0;
    if(activationDetail.survey_kind==='PHASE_MAPPING_BUNDLE'){
      const[[row]]=await db.query(
        `SELECT COUNT(DISTINCT cm.user_id) AS total
         FROM survey_activation_mappings sam
         JOIN survey_isc1_assignments sia ON sia.id=sam.isc1_assignment_id AND sia.is_active=1
         JOIN classes c ON c.cohort_id=sia.cohort_id AND c.period_id=sia.period_id
         JOIN class_members cm ON cm.class_id=c.id
         JOIN users u ON u.id=cm.user_id
         WHERE sam.activation_id=? AND u.role=? AND u.status='active'`,
        [activationDetail.activation_id,target_role]
      );
      totalTarget=Number(row?.total||0);
    }else{
      const[[row]]=await db.query(
        `SELECT COUNT(*) AS total FROM users WHERE period_id=? AND role=? AND status='active'`,
        [period_id,target_role]
      );
      totalTarget=Number(row?.total||0);
    }
    const respondedCount=details.length;
    return {
      survey:activationDetail,
      questions,
      summary:{
        total_target:totalTarget,
        responded_count:respondedCount,
        not_responded_count:Math.max(totalTarget-respondedCount,0),
        response_rate:totalTarget?Math.round((respondedCount/totalTarget)*100):0
      },
      aggregates,
      narasumber_recap:narasumberRecap,
      details
    };
  }

  if(String(survey_instance_id).startsWith('eval-')){
    const sessionId=Number(String(survey_instance_id).replace('eval-',''));
    const[[session]]=await db.query(
      `SELECT ses.*,si.id AS survey_instance_id,si.bank_id,si.period_id,si.target_role,si.survey_kind,si.title,si.description,c.name AS class_name
       FROM survey_eval_sessions ses
       JOIN survey_instances si ON si.id=ses.survey_instance_id
       JOIN classes c ON c.id=ses.class_id
       WHERE ses.id=? AND ses.period_id=? AND si.target_role=? AND si.survey_kind='EVAL_NARASUMBER'`,
      [sessionId,period_id,target_role]
    );
    if(!session){
      const err=new Error('Sesi evaluasi survei tidak ditemukan');
      err.statusCode=404;
      throw err;
    }
    return buildEvalSurveyRecap({sessionId,survey:session});
  }

  const[[survey]]=await db.query(
    `SELECT si.*
     FROM survey_instances si
     WHERE si.id=? AND si.period_id=? AND si.target_role=? AND si.survey_kind=?`,
    [survey_instance_id,period_id,target_role,survey_kind]
  );
  if(!survey){
    const err=new Error('Survei tidak ditemukan');
    err.statusCode=404;
    throw err;
  }
  const[questions]=await db.query('SELECT * FROM survey_instance_questions WHERE instance_id=? ORDER BY order_no,id',[survey.id]);
  return buildGeneralSurveyRecap({survey,questions:questions.map(parseChoiceQuestion)});
};

const toCsvValue=value=>`"${String(value??'').replace(/"/g,'""')}"`;
const buildRecapCsv=({survey,questions,details})=>{
  const headers=['Nama','Email','Waktu Submit',...questions.map((q,idx)=>`Q${idx+1}`)];
  const rows=details.map(detail=>[
    detail.name||'',
    detail.email||'',
    detail.updated_at?new Date(detail.updated_at).toLocaleString('id-ID'):'',
    ...questions.map(q=>{
      const ans=detail.answers?.[q.id];
      if(Array.isArray(ans)){
        return ans.map(item=>q.question_type==='text'
          ? (item.answer_text||'')
          : q.question_type==='scale_1_4'
            ? (item.answer_scale||'')
            : String(item.answer_choice||'').toUpperCase()).filter(Boolean).join(' | ');
      }
      if(!ans) return '';
      if(q.question_type==='text') return ans.answer_text||'';
      if(q.question_type==='scale_1_4') return ans.answer_scale||'';
      return String(ans.answer_choice||'').toUpperCase();
    })
  ]);
  return [headers,...rows].map(cols=>cols.map(toCsvValue).join(',')).join('\n');
};

const getActivationAdminRecapPlaceholder=()=>null;

exports.getMySurveys=async(req,res,next)=>{
  try{
    const activationRows=await getActivationObligations(req.user);
    const[general]=await db.query(
      `SELECT si.id,'legacy' AS source_type,si.survey_kind,si.title,si.description,
               CASE WHEN si.survey_kind='EVAL_NARASUMBER' THEN 'OJC' ELSE NULL END AS phase,
              COUNT(DISTINCT siq.id) AS question_count,
              sr.id AS response_id,sr.updated_at AS updated_at
       FROM survey_instances si
       LEFT JOIN survey_instance_questions siq ON siq.instance_id=si.id
       LEFT JOIN survey_responses sr ON sr.instance_id=si.id AND sr.user_id=?
       WHERE si.is_active=1 AND si.target_role=?
       GROUP BY si.id,sr.id
       ORDER BY si.id DESC`,
      [req.user.id,req.user.role]
    );
    const[evalRows]=await db.query(
      `SELECT CONCAT('eval-',ses.id) AS id,'legacy' AS source_type,'EVAL_NARASUMBER' AS survey_kind,
              si.title,si.description,'OJC' AS phase,
              COUNT(DISTINCT q.id) AS question_count,
              ser.id AS response_id,ser.submitted_at AS updated_at,
              c.name AS class_name,
              GROUP_CONCAT(DISTINCT t.title ORDER BY t.order_no,t.title SEPARATOR ' | ') AS task_titles,
              COUNT(DISTINCT sesn.narasumber_id) AS narasumber_count
       FROM survey_eval_sessions ses
       JOIN survey_instances si ON si.id=ses.survey_instance_id
       JOIN classes c ON c.id=ses.class_id
       LEFT JOIN survey_eval_session_tasks sest ON sest.session_id=ses.id
       LEFT JOIN tasks t ON t.id=sest.task_id
       LEFT JOIN survey_eval_session_narasumbers sesn ON sesn.session_id=ses.id
       LEFT JOIN survey_eval_responses ser ON ser.session_id=ses.id AND ser.user_id=?
       LEFT JOIN survey_bank_questions q ON q.bank_id=si.bank_id
       WHERE ses.is_active=1 AND si.target_role=? AND si.is_active=1
         AND ses.class_id IN (SELECT cm.class_id FROM class_members cm WHERE cm.user_id=?)
       GROUP BY ses.id,si.title,si.description,ser.id,c.name
       ORDER BY ses.id DESC`,
      [req.user.id,req.user.role,req.user.id]
    );
    res.json([...activationRows,...general,...evalRows]);
  }catch(e){next(e);}
};

exports.getSurveyDetail=async(req,res,next)=>{
  try{
    const activationDetail=await getActivationDetail({token:req.params.id,user:req.user});
    if(activationDetail) return res.json(activationDetail);
    if(String(req.params.id||'').startsWith('eval-')){
      const sessionId=Number(String(req.params.id).replace('eval-',''));
      const[[row]]=await db.query(
        `SELECT ses.*,c.name AS class_name
         FROM survey_eval_sessions ses
         JOIN classes c ON c.id=ses.class_id
         WHERE ses.id=? AND ses.is_active=1 AND ses.target_role=?
           AND ses.class_id IN (SELECT cm.class_id FROM class_members cm WHERE cm.user_id=?)`,
        [sessionId,req.user.role,req.user.id]
      );
      if(!row) return res.status(404).json({message:'Survei tidak ditemukan'});
      const[tasks]=await db.query(
        `SELECT t.id,t.title,t.description
         FROM survey_eval_session_tasks sest
         JOIN tasks t ON t.id=sest.task_id
         WHERE sest.session_id=?
         ORDER BY t.order_no,t.title`,
        [sessionId]
      );
      const[narasumbers]=await db.query(
        `SELECT u.id,u.name
         FROM survey_eval_session_narasumbers sesn
         JOIN users u ON u.id=sesn.narasumber_id
         WHERE sesn.session_id=?
         ORDER BY u.name`,
        [sessionId]
      );
      const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[row.bank_id]);
      const[[response]]=await db.query('SELECT * FROM survey_eval_responses WHERE session_id=? AND user_id=?',[sessionId,req.user.id]);
      let answers=[];
      if(response){
        const[a]=await db.query('SELECT * FROM survey_eval_answer_items WHERE response_id=? ORDER BY task_id,narasumber_id,question_id,id',[response.id]);
        answers=a;
      }
      return res.json({...row,id:req.params.id,survey_kind:'EVAL_NARASUMBER',tasks,narasumbers,questions:questions.map(parseChoiceQuestion),response,answers});
    }

    const[[survey]]=await db.query('SELECT * FROM survey_instances WHERE id=? AND is_active=1 AND target_role=?',[req.params.id,req.user.role]);
    if(!survey) return res.status(404).json({message:'Survei tidak ditemukan'});
    const[questions]=await db.query('SELECT * FROM survey_instance_questions WHERE instance_id=? ORDER BY order_no,id',[survey.id]);
    const[[response]]=await db.query('SELECT * FROM survey_responses WHERE instance_id=? AND user_id=?',[survey.id,req.user.id]);
    let answers=[];
    if(response){
      const[a]=await db.query('SELECT * FROM survey_response_answers WHERE response_id=?',[response.id]);
      answers=a;
    }
    res.json({...survey,questions:questions.map(parseChoiceQuestion),response,answers});
  }catch(e){next(e);}
};

exports.submitSurvey=async(req,res,next)=>{
  try{
    const role=req.user.role;
    if(!['DOSEN','NARASUMBER'].includes(role)) return res.status(403).json({message:'Akses ditolak'});
    const{answers}=req.body;
    if(!Array.isArray(answers)||!answers.length) return res.status(400).json({message:'answers wajib'});

    const activationDetail=await getActivationDetail({token:req.params.id,user:req.user});
    if(activationDetail){
      if(activationDetail.response_id) return res.status(403).json({message:'Survei sudah dikunci (hanya 1x submit)'});
      const activationQuestions=activationDetail.questions||[];
      const activationScopes=activationDetail.survey_kind==='PHASE_MAPPING_BUNDLE'
        ? (activationDetail.matrix_rows||[]).map(row=>String(row.id))
        : ['single'];
      const activationAnswersComplete=ensureSurveyAnswersComplete({
        answers,
        questions:activationQuestions,
        scopeValues:activationScopes,
        scopeResolver:answer=>activationDetail.survey_kind==='PHASE_MAPPING_BUNDLE'
          ? String(answer?.isc1_assignment_id||'')
          : 'single'
      });
      if(!activationAnswersComplete) return res.status(400).json({message:'Semua pertanyaan survei wajib diisi sebelum dikirim'});
      const conn=await db.getConnection();
      try{
        await conn.beginTransaction();
        const[r]=await conn.query(
          'INSERT INTO survey_activation_responses (activation_id,mapping_id,ojc_category_id,user_id) VALUES (?,?,?,?)',
          [activationDetail.activation_id,null,activationDetail.ojc_category_id||null,req.user.id]
        );
        const responseId=r.insertId;
        for(const a of answers){
          await conn.query(
            'INSERT INTO survey_activation_response_answers (response_id,isc1_assignment_id,question_id,answer_text,answer_choice,answer_scale) VALUES (?,?,?,?,?,?)',
            [responseId,a.isc1_assignment_id||null,a.question_id,a.answer_text||null,a.answer_choice||null,a.answer_scale||null]
          );
        }
        await conn.commit();
        return res.json({message:'Jawaban survei tersimpan'});
      }catch(e){await conn.rollback();throw e;}finally{conn.release();}
    }

    if(String(req.params.id||'').startsWith('eval-')){
      const sessionId=Number(String(req.params.id).replace('eval-',''));
      const[[session]]=await db.query(
        `SELECT ses.*,si.bank_id
         FROM survey_eval_sessions ses
         JOIN survey_instances si ON si.id=ses.survey_instance_id
         WHERE ses.id=? AND ses.is_active=1 AND ses.target_role=?
           AND ses.class_id IN (SELECT cm.class_id FROM class_members cm WHERE cm.user_id=?)`,
        [sessionId,req.user.role,req.user.id]
      );
      if(!session) return res.status(404).json({message:'Survei tidak ditemukan'});
      const[questions]=await db.query('SELECT * FROM survey_bank_questions WHERE bank_id=? ORDER BY order_no,id',[session.bank_id]);
      const[narasumbers]=await db.query(
        `SELECT u.id
         FROM survey_eval_session_narasumbers sesn
         JOIN users u ON u.id=sesn.narasumber_id
         WHERE sesn.session_id=?`,
        [sessionId]
      );
      const scopes=(narasumbers||[]).map(ns=>String(ns.id));
      const isComplete=ensureSurveyAnswersComplete({
        answers,
        questions,
        scopeValues:scopes,
        scopeResolver:answer=>String(answer?.narasumber_id||'')
      });
      if(!isComplete) return res.status(400).json({message:'Semua pertanyaan survei wajib diisi sebelum dikirim'});
    }

    const[[survey]]=await db.query('SELECT * FROM survey_instances WHERE id=? AND is_active=1 AND target_role=?',[req.params.id,role]);
    if(!survey) return res.status(404).json({message:'Survei tidak ditemukan'});

    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      if(survey.survey_kind==='GENERAL'){
        const[questions]=await conn.query('SELECT * FROM survey_instance_questions WHERE instance_id=? ORDER BY order_no,id',[req.params.id]);
        const isComplete=ensureSurveyAnswersComplete({
          answers,
          questions,
          scopeValues:['single'],
          scopeResolver:()=> 'single'
        });
        if(!isComplete) return res.status(400).json({message:'Semua pertanyaan survei wajib diisi sebelum dikirim'});
        const[[existing]]=await conn.query('SELECT id FROM survey_responses WHERE instance_id=? AND user_id=?',[req.params.id,req.user.id]);
        if(existing) return res.status(403).json({message:'Survei sudah dikunci (hanya 1x submit)'});
        const[r]=await conn.query('INSERT INTO survey_responses (instance_id,user_id) VALUES (?,?)',[req.params.id,req.user.id]);
        const responseId=r.insertId;
        for(const a of answers){
          await conn.query('INSERT INTO survey_response_answers (response_id,question_id,answer_text,answer_choice,answer_scale) VALUES (?,?,?,?,?)',[responseId,a.question_id,a.answer_text||null,a.answer_choice||null,a.answer_scale||null]);
        }
      }
      await conn.commit();
      res.json({message:'Jawaban survei tersimpan'});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }catch(e){next(e);}
};

exports.getAdminInstances=async(req,res,next)=>{
  try{
    const{period_id,target_role}=req.query;
    if(!period_id||!target_role) return res.status(400).json({message:'period_id dan target_role wajib'});

    const[legacyRows]=await db.query(
      `SELECT si.id,si.title,si.description,si.target_role,si.period_id,si.is_active,si.created_at,
              COUNT(DISTINCT siq.id) AS question_count,
              COUNT(DISTINCT sr.id) AS response_count,
              'legacy' AS source_type
       FROM survey_instances si
       LEFT JOIN survey_instance_questions siq ON siq.instance_id=si.id
       LEFT JOIN survey_responses sr ON sr.instance_id=si.id
       WHERE si.period_id=? AND si.target_role=? AND si.survey_kind='GENERAL'
       GROUP BY si.id
       ORDER BY si.created_at DESC`,
      [period_id,target_role]
    );

    const[activationRows]=target_role==='DOSEN'
      ? await db.query(
          `SELECT CONCAT('act-',sa.id,'-map-',MIN(sia.id)) AS id,sa.title,sa.description,sa.target_role,sa.period_id,sa.is_active,sa.created_at,
                  COUNT(DISTINCT sbq.id) AS question_count,
                  COUNT(DISTINCT sar.id) AS response_count,
                  'activation' AS source_type
           FROM survey_activations sa
           JOIN survey_activation_mappings sam ON sam.activation_id=sa.id AND sam.isc1_assignment_id IS NOT NULL
           JOIN survey_isc1_assignments sia ON sia.id=sam.isc1_assignment_id AND sia.is_active=1
           LEFT JOIN survey_bank_questions sbq ON sbq.bank_id=sia.bank_id
           LEFT JOIN survey_activation_responses sar ON sar.activation_id=sa.id
           WHERE sa.period_id=? AND sa.target_role=? AND sa.phase='ISC1'
           GROUP BY sa.id
           ORDER BY sa.created_at DESC,sa.id DESC`,
          [period_id,target_role]
        )
      : [[]];

    const[ojcActivationRows]=await db.query(
      `SELECT CONCAT('act-',sa.id,'-ojc') AS id,sa.title,sa.description,sa.target_role,sa.period_id,sa.is_active,sa.created_at,
              COUNT(DISTINCT sbq.id) AS question_count,
              COUNT(DISTINCT sar.id) AS response_count,
              'activation' AS source_type
       FROM survey_activations sa
       LEFT JOIN survey_bank_questions sbq ON sbq.bank_id=sa.bank_id
       LEFT JOIN survey_activation_responses sar ON sar.activation_id=sa.id
       WHERE sa.period_id=? AND sa.target_role=? AND sa.phase='OJC'
       GROUP BY sa.id
       ORDER BY sa.created_at DESC,sa.id DESC`,
      [period_id,target_role]
    );

    const merged=[...legacyRows,...activationRows,...(ojcActivationRows||[])];
    const deduped=[];
    const seen=new Set();
    for(const row of merged){
      const key=String(row.id);
      if(seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    deduped.sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
    res.json(deduped);
  }catch(e){next(e);}
};

exports.getAdminRecap=async(req,res,next)=>{
  try{
    res.json(await getAdminRecapData(req.query));
  }catch(e){next(e);}
};
exports.getAdminRecapCsv=async(req,res,next)=>{
  try{
    const csv=await getAdminRecapCsvData(req.query);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="survey-recap-${req.query.survey_instance_id||'data'}.csv"`);
    res.send(csv);
  }catch(e){next(e);}
};
exports.getAdminRecapPdf=sendSurveyRecapPdf;
exports.publishFromBank=async(req,res,next)=>{try{res.status(501).json({message:'Legacy publish tidak dipakai pada flow ini'});}catch(e){next(e);}};
exports.syncQuestionsFromBank=async(req,res,next)=>{try{res.json({affected_instances:0,added:0});}catch(e){next(e);}};
