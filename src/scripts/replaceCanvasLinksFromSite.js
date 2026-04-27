require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/database");
const {
  syncCanvasResourcesFromSite,
} = require("../controllers/virtualLabResourceController");

(async () => {
  try {
    await connectDB();

    const summary = await syncCanvasResourcesFromSite();
    console.log("Canvas links replaced from site catalog.");
    console.log(JSON.stringify(summary || {}, null, 2));

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("Failed to replace canvas links:", error.message);
    try {
      await mongoose.connection.close();
    } catch {
      // ignore close errors
    }
    process.exit(1);
  }
})();
