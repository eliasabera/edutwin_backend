const mongoose = require("mongoose");
const { Schema } = mongoose;

const teacherSubjectSchema = new Schema(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "TeacherProfile", required: true },
    subject_id: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.TeacherSubject || mongoose.model("TeacherSubject", teacherSubjectSchema);
