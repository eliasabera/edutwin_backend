const mongoose = require("mongoose");
const { Schema } = mongoose;

const studentEnrollmentSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "StudentProfile", required: true },
    class_id: { type: Schema.Types.ObjectId, ref: "Class", required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.StudentEnrollment || mongoose.model("StudentEnrollment", studentEnrollmentSchema);
