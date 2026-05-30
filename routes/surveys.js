const r=require('express').Router(),c=require('../controllers/surveyController'),{authenticate,authorize,ensurePaymentVerified,ensureBodyPeriodActive}=require('../middlewares/auth');

r.use(authenticate);

r.get('/admin/instances',authorize('ADMIN'),c.getAdminInstances);
r.get('/admin/recap',authorize('ADMIN'),c.getAdminRecap);
r.get('/admin/recap-csv',authorize('ADMIN'),c.getAdminRecapCsv);
r.get('/admin/recap-pdf',authorize('ADMIN'),c.getAdminRecapPdf);

r.get('/me',ensurePaymentVerified,authorize('DOSEN','NARASUMBER'),c.getMySurveys);
r.get('/:id',ensurePaymentVerified,authorize('DOSEN','NARASUMBER'),c.getSurveyDetail);
r.post('/:id/submit',ensurePaymentVerified,authorize('DOSEN','NARASUMBER'),c.submitSurvey);

r.post('/publish-from-bank',authorize('ADMIN'),ensureBodyPeriodActive,c.publishFromBank);
r.post('/admin/sync-questions',authorize('ADMIN'),c.syncQuestionsFromBank);

module.exports=r;