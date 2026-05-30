const r = require('express').Router();
const c = require('../controllers/paymentController');
const { authenticate, authorize } = require('../middlewares/auth');
const { uploadAny } = require('../middlewares/upload');

r.use(authenticate);

r.get('/me', c.getMyStatus);
r.post('/submit', authorize('DOSEN'), uploadAny.single('proof_file'), c.submitPayment);

r.get('/admin/submissions', authorize('ADMIN'), c.adminList);
r.patch('/admin/submissions/:id/verify', authorize('ADMIN'), c.adminVerify);
r.patch('/admin/submissions/:id/reject', authorize('ADMIN'), c.adminReject);

module.exports = r;
