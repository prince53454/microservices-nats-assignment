const mongoose = require('mongoose');

/** A notification delivered to a single user. */
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['WELCOME', 'PROFILE_UPDATED'],
    },
    message: { type: String, required: true },
    status: { type: String, enum: ['created', 'read'], default: 'created' },
  },
  { timestamps: true } // createdAt / updatedAt
);

notificationSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

/**
 * Idempotency ledger: one row per processed eventId. The unique index is the
 * guarantee — a duplicate insert throws MongoServerError 11000, which tells
 * the consumer "this event was already handled" (ACK and move on).
 */
const processedEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
  }
);

module.exports = {
  Notification: mongoose.models.Notification || mongoose.model('Notification', notificationSchema),
  ProcessedEvent: mongoose.models.ProcessedEvent || mongoose.model('ProcessedEvent', processedEventSchema),
};
