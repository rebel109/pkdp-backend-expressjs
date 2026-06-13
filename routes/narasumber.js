const r = require('express').Router();
const c = require('../controllers/narasumberController');
const { authenticate, authorize } = require('../middlewares/auth');
const { uploadAny } = require('../middlewares/upload');

r.get('/template', c.publicTemplate);

r.use(authenticate);

r.get('/me', authorize('NARASUMBER'), c.myStatus);
r.post('/submit', authorize('DOSEN','NARASUMBER'), uploadAny.single('consent_file'), c.submit);
r.post('/resubmit', authorize('NARASUMBER'), uploadAny.single('consent_file'), c.resubmit);

r.get('/admin/submissions', authorize('ADMIN'), c.adminList);
r.get('/admin/recap', authorize('ADMIN'), c.adminRecap);
r.get('/admin/recap-pdf', authorize('ADMIN'), c.adminRecapPdf);
r.get('/admin/users/:userId/history', authorize('ADMIN'), c.adminHistory);
r.patch('/admin/submissions/:id/verify', authorize('ADMIN'), c.adminVerify);
r.patch('/admin/submissions/:id/reject', authorize('ADMIN'), c.adminReject);
r.post('/admin/template', authorize('ADMIN'), uploadAny.single('template_file'), c.adminSetTemplate);

module.exports = r;
