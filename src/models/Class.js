const mongoose = require("mongoose");
const { Schema } = mongoose;

const classSchema = new Schema(
  {
    school_id: { type: Schema.Types.ObjectId, ref: "School", required: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: "TeacherProfile", required: true },
    subject_id: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    name: { type: String, required: true, trim: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Class || mongoose.model("Class", classSchema);
