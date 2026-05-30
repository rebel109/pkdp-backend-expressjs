const r=require('express').Router(),c=require('../controllers/periodController'),{authenticate,authorize}=require('../middlewares/auth');
// GET /periods is public (for registration page)
r.get('/',c.getAll);
r.use(authenticate);
r.post('/',authorize('ADMIN'),c.create);
r.put('/:id',authorize('ADMIN'),c.update);r.patch('/:id/activate',authorize('ADMIN'),c.setActive);r.post('/deactivate-all',authorize('ADMIN'),c.deactivateAll);r.delete('/:id',authorize('ADMIN'),c.remove);
module.exports=r;
