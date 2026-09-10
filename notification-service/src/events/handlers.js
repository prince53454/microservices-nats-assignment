const { Notification } = require('../models/notification.model');
const logger = require('../config/logger');

/** Handle `user.created`: create the welcome notification. */
async function handleUserCreated(data) {
  const notification = await Notification.create({
    userId: data.userId,
    type: 'WELCOME',
    message: `Welcome ${data.name}! Your account has been successfully created.`,
    status: 'created',
  });
  logger.info({ notificationId: notification.id, userId: data.userId }, 'Welcome notification created');
  return notification;
}

/** Handle `user.updated`: create a profile-updated notification. */
async function handleUserUpdated(data) {
  const changed = [data.name && 'name', data.email && 'email'].filter(Boolean).join(', ');
  const notification = await Notification.create({
    userId: data.userId,
    type: 'PROFILE_UPDATED',
    message: `Your profile was updated (changed: ${changed}).`,
    status: 'created',
  });
  logger.info({ notificationId: notification.id, userId: data.userId }, 'Profile-updated notification created');
  return notification;
}

module.exports = { handleUserCreated, handleUserUpdated };
