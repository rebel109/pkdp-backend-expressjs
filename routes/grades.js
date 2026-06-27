const r=require('express').Router(),c=require('../controllers/gradeController'),{authenticate,authorize,ensurePaymentVerified}=require('../middlewares/auth');
r.use(authenticate);
r.get('/summary/:userId',ensurePaymentVerified,c.summary);
r.get('/unlock-audit',authorize('ADMIN'),c.getAllUnlockAudit);
r.get('/',ensurePaymentVerified,c.getAll);r.post('/',authorize('NARASUMBER','ADMIN'),c.create);
r.get('/:id/unlock-audit',authorize('ADMIN'),c.getUnlockAudit);
r.put('/:id',authorize('NARASUMBER','ADMIN'),c.update);r.delete('/:id',authorize('ADMIN'),c.remove);
// Lock/unlock endpoints for admin only
r.patch('/:id/lock',authorize('ADMIN'),c.lock);
r.patch('/:id/unlock',authorize('ADMIN'),c.unlock);
r.get('/all-summary',authorize('ADMIN'),c.allSummary);
r.get('/narasumber-summary',authorize('ADMIN'),c.narasumberSummary);
r.get('/participant-recap/tasks-detail',authorize('ADMIN'),c.participantRecapTasksDetail);
r.get('/participant-recap',authorize('ADMIN'),c.participantRecap);
module.exports=r;
