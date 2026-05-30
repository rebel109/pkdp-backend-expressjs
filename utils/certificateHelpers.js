const crypto = require('crypto');

const OJC_WEIGHTS = {
  OJC_RPS_INSTRUMEN:30,
  OJC_VIDEO_PEMBELAJARAN_PRAKTIK:30,
  OJC_ARTIKEL_ILMIAH:25,
  OJC_KONTEN_MODERASI:15
};

const ISC2_WEIGHTS = {
  ISC2_VIDEO_PRAKTIK:50,
  ISC2_ARTIKEL_SUBMITTED:50
};

const round=n=>Math.round(n);

const avg=arr=>arr.length?round(arr.reduce((s,v)=>s+v,0)/arr.length):null;

const strictWeightedScore=(componentScores,weights)=>{
  const keys=Object.keys(weights);
  const complete=keys.every(k=>componentScores[k]!=null);
  if(!complete) return null;
  const weightedTotal=keys.reduce((sum,key)=>sum+(componentScores[key]*weights[key]),0);
  return round(weightedTotal/100);
};

const buildComponentScores=(subs,weightMap)=>{
  const scores={};
  Object.keys(weightMap).forEach(key=>{scores[key]=null;});
  const grouped={};
  subs.forEach(s=>{
    if(!s.assessment_component||s.final_score==null) return;
    if(!weightMap[s.assessment_component]) return;
    if(!grouped[s.assessment_component]) grouped[s.assessment_component]=[];
    grouped[s.assessment_component].push(Number(s.final_score));
  });
  Object.keys(grouped).forEach(k=>{scores[k]=avg(grouped[k]);});
  return scores;
};

const finalNKKontribusi=(isc1,ojc,isc2)=>{
  if([isc1,ojc,isc2].some(v=>v==null)) return null;
  return round((isc1*0.3)+(ojc*0.5)+(isc2*0.2));
};

const toPredikat=score=>{
  if(score==null) return {predikat:null,status_kelulusan:null};
  if(score>=91) return {predikat:'Sangat Baik',status_kelulusan:'Lulus'};
  if(score>=76) return {predikat:'Baik',status_kelulusan:'Lulus'};
  if(score>=61) return {predikat:'Cukup',status_kelulusan:'Lulus'};
  return {predikat:'Kurang',status_kelulusan:'Tidak Lulus'};
};

const computeKelulusan = ({ mcqRows, gradeRows }) => {
  const preScores=(mcqRows||[]).filter(r=>r.task_type==='PRETEST').map(r=>r.score);
  const postScores=(mcqRows||[]).filter(r=>r.task_type==='POSTTEST').map(r=>r.score);

  const pretestScore=preScores.length?avg(preScores):null;
  const posttestScore=postScores.length?avg(postScores):null;
  const isc1Score=posttestScore!=null?round(posttestScore):null;

  const ojcGrades=(gradeRows||[]).filter(r=>r.phase==='OJC'&&r.final_score!=null);
  const isc2Grades=(gradeRows||[]).filter(r=>r.phase==='ISC2'&&r.final_score!=null);

  const ojcComponentScores=buildComponentScores(ojcGrades,OJC_WEIGHTS);
  const isc2ComponentScores=buildComponentScores(isc2Grades,ISC2_WEIGHTS);

  const ojcScore=strictWeightedScore(ojcComponentScores,OJC_WEIGHTS);
  const isc2Score=strictWeightedScore(isc2ComponentScores,ISC2_WEIGHTS);

  const nkFinal=finalNKKontribusi(isc1Score,ojcScore,isc2Score);
  const predikatInfo=toPredikat(nkFinal);

  return {
    nk_final: nkFinal,
    predikat: predikatInfo.predikat,
    status_kelulusan: predikatInfo.status_kelulusan
  };
};

const makeVerificationToken=()=>crypto.randomBytes(24).toString('hex');

const makeCertificateNo=({ periodYear, serial, startNo, issuedAt=new Date() })=>{
  const activePeriodYear=String(periodYear||issuedAt.getFullYear());
  const publishMonth=String(issuedAt.getMonth()+1).padStart(2,'0');
  const currentYear=String(issuedAt.getFullYear());
  const baseNumber=Number(startNo||1);
  const serialNumber=baseNumber+Math.max(0,Number(serial||1)-1);
  return `B-${serialNumber}/Un.09/PKDP.${activePeriodYear}/${publishMonth}/${currentYear}`;
};

const safeJsonParse=(v,fallback={})=>{
  if(v==null) return fallback;
  if(typeof v==='object') return v;
  try{return JSON.parse(v);}catch{return fallback;}
};

module.exports={
  computeKelulusan,
  makeVerificationToken,
  makeCertificateNo,
  safeJsonParse
};