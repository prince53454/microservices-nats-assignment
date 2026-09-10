const { asyncHandler } = require('../../../shared/utils/asyncHandler');
const { sendSuccess } = require('../../../shared/utils/responses');
const { ApiError } = require('../../../shared/utils/ApiError');
const notificationService = require('../services/notification.service');

/** GET /notifications — only the authenticated user's notifications. */
const list = asyncHandler(async (req, res) => {
  const { notifications, page, limit, total, totalPages } =
    await notificationService.listForUser(req.user.sub, req.query);
  return sendSuccess(res, { notifications, pagination: { page, limit, total, totalPages } });
});

/** GET /notifications/:id — 404 unless the notification belongs to the caller. */
const getById = asyncHandler(async (req, res) => {
  const notification = await notificationService.getByIdForUser(
    req.params.id,
    req.user.sub
  );
  if (!notification) throw ApiError.notFound('Notification not found');
  return sendSuccess(res, { notification });
});

module.exports = { list, getById };
