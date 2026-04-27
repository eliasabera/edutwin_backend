require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/database");
const { VirtualLabResource } = require("../models");

(async () => {
  try {
    await connectDB();

    const rows = await VirtualLabResource.aggregate([
      { $match: { interaction_type: "CANVAS" } },
      {
        $group: {
          _id: {
            grade: "$grade_level",
            subject: "$parameters.subject",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.grade": 1, "_id.subject": 1 } },
    ]);

    console.log(JSON.stringify(rows, null, 2));
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("Failed to report canvas distribution:", error.message);
    try {
      await mongoose.connection.close();
    } catch {
      // ignore close errors
    }
    process.exit(1);
  }
})();
