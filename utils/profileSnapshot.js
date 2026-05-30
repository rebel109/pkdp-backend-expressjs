const db = require('../config/db');

const saveProfileSnapshot = async (userId, periodId, role, sourceSubmissionId = null) => {
  if (!userId || !periodId || !role) return;
  const [[row]] = await db.query(
    `SELECT u.name,u.email,
            pr.avatar_url,pr.nip,pr.nidn,pr.unit_kerja,pr.institution,pr.department,pr.golongan,pr.npwp,pr.phone,
            pr.rekening_no,pr.rekening_name,pr.bank_name,pr.cv_file,pr.rekening_file
     FROM users u
     LEFT JOIN profiles pr ON pr.user_id=u.id
     WHERE u.id=?`,
    [userId]
  );
  if (!row) return;
  await db.query(
    `INSERT INTO user_period_profile_snapshots (
       user_id,period_id,role,source_submission_id,name,email,avatar_url,nip,nidn,unit_kerja,institution,department,golongan,npwp,phone,rekening_no,rekening_name,bank_name,cv_file,rekening_file
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       source_submission_id=VALUES(source_submission_id),name=VALUES(name),email=VALUES(email),avatar_url=VALUES(avatar_url),nip=VALUES(nip),nidn=VALUES(nidn),unit_kerja=VALUES(unit_kerja),institution=VALUES(institution),department=VALUES(department),golongan=VALUES(golongan),npwp=VALUES(npwp),phone=VALUES(phone),rekening_no=VALUES(rekening_no),rekening_name=VALUES(rekening_name),bank_name=VALUES(bank_name),cv_file=VALUES(cv_file),rekening_file=VALUES(rekening_file)`,
    [userId,periodId,role,sourceSubmissionId,row.name,row.email,row.avatar_url,row.nip,row.nidn,row.unit_kerja,row.institution,row.department,row.golongan,row.npwp,row.phone,row.rekening_no,row.rekening_name,row.bank_name,row.cv_file,row.rekening_file]
  );
};

module.exports = { saveProfileSnapshot };
