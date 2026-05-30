const r=require('express').Router(),c=require('../controllers/surveyFoundationController'),{authenticate,authorize,ensureBodyPeriodActive}=require('../middlewares/auth');

r.use(authenticate);
r.use(authorize('ADMIN'));

r.get('/isc1-materials',c.getIsc1Materials);
r.post('/isc1-materials',ensureBodyPeriodActive,c.createIsc1Material);
r.put('/isc1-materials/:id',ensureBodyPeriodActive,c.updateIsc1Material);
r.delete('/isc1-materials/:id',c.removeIsc1Material);

r.get('/isc1-narasumbers',c.getIsc1Narasumbers);
r.post('/isc1-narasumbers',ensureBodyPeriodActive,c.createIsc1Narasumber);
r.put('/isc1-narasumbers/:id',ensureBodyPeriodActive,c.updateIsc1Narasumber);
r.delete('/isc1-narasumbers/:id',c.removeIsc1Narasumber);

r.get('/mappings',c.getMappings);
r.post('/mappings',ensureBodyPeriodActive,c.createMapping);
r.put('/mappings/:id',ensureBodyPeriodActive,c.updateMapping);
r.delete('/mappings/:id',c.removeMapping);

r.get('/ojc-categories',c.getOjcCategories);
r.post('/ojc-categories',ensureBodyPeriodActive,c.createOjcCategory);
r.put('/ojc-categories/:id',ensureBodyPeriodActive,c.updateOjcCategory);
r.delete('/ojc-categories/:id',c.removeOjcCategory);

r.get('/activations',c.getActivations);
r.post('/activations',ensureBodyPeriodActive,c.createActivation);
r.put('/activations/:id',ensureBodyPeriodActive,c.updateActivation);
r.delete('/activations/:id',c.removeActivation);

module.exports=r;
