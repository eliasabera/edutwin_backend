require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/database");
const { VirtualLabResource } = require("../models");

(async () => {
  try {
    await connectDB();

    const rows = await VirtualLabResource.find(
      {
        interaction_type: "CANVAS",
        grade_level: 9,
        "parameters.subject": "chemistry",
        $or: [
          { title: /boyle/i },
          { topic: /boyle/i },
          { resource_url: /boyle/i },
        ],
      },
      {
        title: 1,
        topic: 1,
        chapter: 1,
        resource_url: 1,
        "parameters.subject": 1,
      },
    ).lean();

    console.log(JSON.stringify(rows, null, 2));
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error(error);
    try {
      await mongoose.connection.close();
    } catch {
      // ignore close errors
    }
    process.exit(1);
  }
})();
