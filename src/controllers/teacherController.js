const mongoose = require("mongoose");
const { User, TeacherProfile, Class, StudentEnrollment, StudentProfile, School, Subject } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const toTeacherResponse = (user, profile) => ({
  user: {
    id: user._id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  },
  profile,
});

const getTeachers = async (_req, res) => {
  try {
    const teachers = await User.find({ role: "TEACHER" })
      .select("_id email role created_at")
      .sort({ created_at: -1 });

    const teacherIds = teachers.map((teacher) => teacher._id);
    const profiles = await TeacherProfile.find({ user_id: { $in: teacherIds } });
    const profileMap = new Map(profiles.map((profile) => [String(profile.user_id), profile]));

    const data = teachers.map((teacher) => ({
      user: {
        id: teacher._id,
        email: teacher.email,
        role: teacher.role,
        created_at: teacher.created_at,
      },
      profile: profileMap.get(String(teacher._id)) || null,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch teachers",
      error: error.message,
    });
  }
};

const getTeacherByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const user = await User.findOne({ _id: userId, role: "TEACHER" }).select("_id email role created_at");
    if (!user) {
      return res.status(404).json({ success: false, message: "Teacher user not found" });
    }

    const profile = await TeacherProfile.findOne({ user_id: user._id });

    return res.status(200).json({
      success: true,
      data: toTeacherResponse(user, profile),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch teacher",
      error: error.message,
    });
  }
};

const getMyTeacherProfile = async (req, res) => {
  try {
    if (!req.user?.id || !isValidId(req.user.id)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findOne({ _id: req.user.id, role: "TEACHER" }).select("_id email role created_at");
    if (!user) {
      return res.status(404).json({ success: false, message: "Teacher user not found" });
    }

    const profile = await TeacherProfile.findOne({ user_id: user._id });

    return res.status(200).json({
      success: true,
      data: toTeacherResponse(user, profile),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch teacher profile",
      error: error.message,
    });
  }
};

const getMyTeacherDashboard = async (req, res) => {
  try {
    if (!req.user?.id || !isValidId(req.user.id)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findOne({ _id: req.user.id, role: "TEACHER" }).select("_id email role created_at");
    if (!user) {
      return res.status(404).json({ success: false, message: "Teacher user not found" });
    }

    const teacherProfile = await TeacherProfile.findOne({ user_id: user._id });
    if (!teacherProfile) {
      return res.status(404).json({ success: false, message: "Teacher profile not found" });
    }

    const classes = await Class.find({ teacher_id: teacherProfile._id }).sort({ name: 1 });
    const classIds = classes.map((classItem) => classItem._id);
    const enrollments = classIds.length > 0
      ? await StudentEnrollment.find({ class_id: { $in: classIds } })
      : [];

    const studentIds = [...new Set(enrollments.map((enrollment) => String(enrollment.student_id)))];
    const students = studentIds.length > 0
      ? await StudentProfile.find({ _id: { $in: studentIds } })
        .populate({ path: "user_id", select: "_id email role created_at" })
        .populate({ path: "school_id", select: "name" })
      : [];

    const schools = classIds.length > 0
      ? await School.find({ _id: { $in: classes.map((classItem) => classItem.school_id) } }).select("_id name")
      : [];

    const subjects = classIds.length > 0
      ? await Subject.find({ _id: { $in: classes.map((classItem) => classItem.subject_id) } }).select("_id name grade_level")
      : [];

    const schoolMap = new Map(schools.map((school) => [String(school._id), school]));
    const subjectMap = new Map(subjects.map((subject) => [String(subject._id), subject]));
    const studentEnrollmentMap = new Map();
    enrollments.forEach((enrollment) => {
      const studentId = String(enrollment.student_id);
      if (!studentEnrollmentMap.has(studentId)) {
        studentEnrollmentMap.set(studentId, []);
      }
      studentEnrollmentMap.get(studentId).push(String(enrollment.class_id));
    });

    const classStudentCounts = new Map();
    enrollments.forEach((enrollment) => {
      const classId = String(enrollment.class_id);
      classStudentCounts.set(classId, (classStudentCounts.get(classId) || 0) + 1);
    });

    const studentsData = students.map((student) => {
      const enrolledClassIds = studentEnrollmentMap.get(String(student._id)) || [];
      const primaryClass = classes.find((classItem) => enrolledClassIds.includes(String(classItem._id))) || null;
      const primarySubject = primaryClass ? subjectMap.get(String(primaryClass.subject_id)) : null;
      const primarySchool = primaryClass ? schoolMap.get(String(primaryClass.school_id)) : null;

      return {
        key: String(student._id),
        fullName: student.full_name,
        email: student.user_id?.email || "-",
        school: primarySchool?.name || student.school_id?.name || "-",
        grade: String(student.grade_level ?? "-"),
        section: student.section || "-",
        photoUrl: student.student_photo_url || null,
        classes: enrolledClassIds.length,
        subject: primarySubject?.name || "-",
        gradeLevel: primarySubject?.grade_level ?? student.grade_level ?? null,
      };
    });

    const recentClasses = classes.slice(0, 5).map((classItem) => ({
      id: String(classItem._id),
      name: classItem.name,
      school: schoolMap.get(String(classItem.school_id))?.name || "-",
      subject: subjectMap.get(String(classItem.subject_id))?.name || "-",
      grade: subjectMap.get(String(classItem.subject_id))?.grade_level ?? null,
      studentCount: classStudentCounts.get(String(classItem._id)) || 0,
    }));

    const uniqueSchools = new Set(classes.map((classItem) => String(classItem.school_id))).size;
    const uniqueGrades = new Set(subjects.map((subject) => String(subject.grade_level))).size;

    return res.status(200).json({
      success: true,
      data: {
        teacher: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            created_at: user.created_at,
          },
          profile: teacherProfile,
        },
        summary: {
          total_students: studentsData.length,
          total_classes: classes.length,
          total_subjects: subjects.length,
          total_schools: uniqueSchools,
          total_grades: uniqueGrades,
          active_students: studentsData.length,
        },
        students: studentsData,
        classes: recentClasses,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch teacher dashboard",
      error: error.message,
    });
  }
};

const updateMyTeacherProfile = async (req, res) => {
  try {
    if (!req.user?.id || !isValidId(req.user.id)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findOne({ _id: req.user.id, role: "TEACHER" }).select("_id email role created_at");
    if (!user) {
      return res.status(404).json({ success: false, message: "Teacher user not found" });
    }

    const profile = await TeacherProfile.findOne({ user_id: user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: "Teacher profile not found" });
    }

    const updates = {};
    if (typeof req.body.full_name === "string" && req.body.full_name.trim()) {
      updates.full_name = req.body.full_name.trim();
    }

    if (typeof req.body.school_id === "string") {
      const schoolId = req.body.school_id.trim();
      updates.school_id = schoolId && isValidId(schoolId) ? schoolId : null;
    } else if (req.body.school_id === null) {
      updates.school_id = null;
    }

    if (Object.keys(updates).length > 0) {
      await TeacherProfile.updateOne({ _id: profile._id }, { $set: updates });
    }

    const refreshedProfile = await TeacherProfile.findById(profile._id);

    return res.status(200).json({
      success: true,
      message: "Teacher profile updated",
      data: toTeacherResponse(user, refreshedProfile),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update teacher profile",
      error: error.message,
    });
  }
};

module.exports = {
  getTeachers,
  getTeacherByUserId,
  getMyTeacherProfile,
  getMyTeacherDashboard,
  updateMyTeacherProfile,
};
