const { Notification } = require('../models/notification.model');

/** List a user's notifications, newest first, paginated. */
async function listForUser(userId, query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);

  const filter = { userId };
  const [notifications, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),
    Notification.countDocuments(filter),
  ]);

  return {
    notifications,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

/**
 * Fetch one notification, scoped to its owner. Returns null when the row
 * does not exist OR belongs to somebody else (no existence leak).
 */
async function getByIdForUser(id, userId) {
  if (!id.match(/^[0-9a-fA-F]{24}$/)) return null; // not a valid ObjectId
  return Notification.findOne({ _id: id, userId });
}

module.exports = { listForUser, getByIdForUser };
