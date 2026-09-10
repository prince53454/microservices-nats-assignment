const { Router } = require('express');
const controller = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');

const router = Router();

// All notification endpoints require a valid JWT.
router.use(authenticate);
router.get('/', controller.list);
router.get('/:id', controller.getById);

module.exports = router;
