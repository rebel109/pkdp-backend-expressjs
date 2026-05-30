const r = require('express').Router();
const c = require('../controllers/dosenVerificationController');
const { authenticate, authorize } = require('../middlewares/auth');
const { uploadAny } = require('../middlewares/upload');

r.use(authenticate);

r.get('/me', authorize('DOSEN'), c.getMyStatus);
r.post('/submit', authorize('DOSEN'), uploadAny.fields([{name:'sk_file',maxCount:1},{name:'functional_title_file',maxCount:1}]), c.submit);

r.get('/admin/submissions', authorize('ADMIN'), c.adminList);
r.patch('/admin/submissions/:id/verify', authorize('ADMIN'), c.adminVerify);
r.patch('/admin/submissions/:id/reject', authorize('ADMIN'), c.adminReject);
r.delete('/admin/submissions/:id', authorize('ADMIN'), c.adminDelete);

module.exports = r;
