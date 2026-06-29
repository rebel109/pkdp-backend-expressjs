const r=require('express').Router();
const c=require('../controllers/certificateController');
const { authenticate, authorize } = require('../middlewares/auth');
const { uploadCertificateImage } = require('../middlewares/upload');

const templateUpload = uploadCertificateImage.fields([
  { name:'page1_bg', maxCount:1 },
  { name:'page2_bg', maxCount:1 }
]);

const signatureUpload = uploadCertificateImage.fields([
  { name:'signer1_file', maxCount:1 },
  { name:'signer1_cap_file', maxCount:1 },
  { name:'signer2_file', maxCount:1 },
  { name:'signer2_cap_file', maxCount:1 }
]);

r.get('/verify/:token', c.verifyCertificate);

r.use(authenticate);

r.get('/my', c.myCertificates);
r.get('/:id/download', c.downloadCertificate);

r.get('/admin/list', authorize('ADMIN'), c.adminList);
r.get('/admin/templates', authorize('ADMIN'), c.templates);
r.get('/admin/settings', authorize('ADMIN'), c.getSettings);
r.get('/admin/number-settings', authorize('ADMIN'), c.getNumberSetting);
r.put('/admin/number-settings', authorize('ADMIN'), c.setNumberSetting);
r.patch('/admin/:id/withdraw', authorize('ADMIN'), c.withdrawCertificate);
r.delete('/admin/:id', authorize('ADMIN'), c.removeCertificate);

r.post('/templates', authorize('ADMIN'), templateUpload, c.createTemplate);
r.put('/templates/:id', authorize('ADMIN'), templateUpload, c.updateTemplate);
r.post('/settings/signatures', authorize('ADMIN'), signatureUpload, c.setSignatures);

r.post('/distribute/participant', authorize('ADMIN'), c.distributeParticipant);
r.post('/distribute/narasumber', authorize('ADMIN'), c.distributeNarasumber);

module.exports=r;