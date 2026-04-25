const path = require("path");
const { StudentProfile } = require("../models");
const { uploadImageBuffer } = require("../services/cloudinaryService");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const sanitizeFileStem = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "upload";

const uploadStudentPhoto = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "STUDENT") {
      return res.status(403).json({
        success: false,
        message: "Only students can upload student photos",
      });
    }

    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "Image file is required",
      });
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported file type. Use JPG, PNG, WEBP, HEIC, or HEIF.",
      });
    }

    const studentProfile = await StudentProfile.findOne({ user_id: req.user.id });
    if (!studentProfile) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
      });
    }

    const fileName = sanitizeFileStem(path.parse(file.originalname || "photo").name);
    const publicId = `student-${req.user.id}-${fileName}`;

    const uploadResult = await uploadImageBuffer({
      buffer: file.buffer,
      publicId,
      folder: "edutwin/students",
      context: {
        user_id: req.user.id,
        student_profile_id: String(studentProfile._id),
      },
    });

    studentProfile.student_photo_url = uploadResult.secure_url;
    await studentProfile.save();

    return res.status(200).json({
      success: true,
      message: "Student photo uploaded",
      data: {
        student_photo_url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to upload student photo",
      error: error.message,
    });
  }
};

module.exports = {
  uploadStudentPhoto,
};
