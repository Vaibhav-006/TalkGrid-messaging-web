const mongoose = require('mongoose');

const statusSchema = new mongoose.Schema(
  {
    sqlId: { type: Number, required: true, unique: true, index: true },
    userSqlId: { type: Number, required: true, index: true },
    mediaUrl: { type: String, required: true },
    type: { type: String, enum: ['image', 'video'], required: true },
  },
  { timestamps: true }
);

statusSchema.index({ createdAt: -1 });

const Status = mongoose.models.Status || mongoose.model('Status', statusSchema);

module.exports = { Status, statusSchema };
