const axios = require("axios");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

/**
 * Startup migration utility to copy legacy AWS S3 files locally
 * and update their database references.
 */
async function migrateS3ToLocalServer() {
  console.log("[S3 Migration] Starting automated scan of database records...");
  
  try {
    const modelNames = mongoose.modelNames();
    let totalMigrated = 0;
    
    for (const modelName of modelNames) {
      const Model = mongoose.model(modelName);
      
      // Fetch all documents from this collection
      const docs = await Model.find({});
      
      for (const doc of docs) {
        let isModified = false;
        
        // Helper function to recursively traverse and migrate S3 URLs
        const traverseAndMigrate = async (obj) => {
          if (!obj || typeof obj !== "object") return;
          
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            
            if (typeof val === "string" && val.includes("amazonaws.com")) {
              try {
                console.log(`[S3 Migration] Found S3 URL in ${modelName} (${doc._id}) [${key}]: ${val}`);
                
                // 1. Download file from S3
                const response = await axios.get(val, { responseType: "arraybuffer", timeout: 15000 });
                const buffer = Buffer.from(response.data);
                
                // 2. Extract original filename and folder path
                const parsedUrl = new URL(val);
                const urlPath = decodeURIComponent(parsedUrl.pathname);
                const originalName = path.basename(urlPath);
                
                // Extract bucket folder structure, e.g. /projects/logos/ -> projects/logos
                const pathParts = urlPath.split("/").filter(Boolean);
                // Remove the filename from parts
                if (pathParts.length > 0) pathParts.pop();
                const folder = pathParts.join("/") || "uploads";
                
                // 3. Save locally
                const fileExtension = path.extname(originalName);
                const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${fileExtension}`;
                const destPath = path.join(__dirname, "../../uploads", folder, uniqueName);
                
                await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
                await fs.promises.writeFile(destPath, buffer);
                
                const localUrl = `/uploads/${folder}/${uniqueName}`;
                
                // 4. Update object reference
                obj[key] = localUrl;
                isModified = true;
                totalMigrated++;
                console.log(`[S3 Migration] Migrated to local server: ${localUrl}`);
              } catch (err) {
                console.error(`[S3 Migration] Failed to migrate ${val}:`, err.message);
              }
            } else if (typeof val === "object" && val !== null) {
              await traverseAndMigrate(val);
            }
          }
        };
        
        // Convert mongoose doc to plain object for traversal
        const rawObject = doc.toObject ? doc.toObject() : doc;
        await traverseAndMigrate(rawObject);
        
        if (isModified) {
          // Update the document directly in DB to bypass hooks
          await Model.findByIdAndUpdate(doc._id, rawObject);
        }
      }
    }
    
    console.log(`[S3 Migration] Complete. Migrated ${totalMigrated} S3 files to local server.`);
  } catch (err) {
    console.error("[S3 Migration] Error during migration run:", err);
  }
}

module.exports = {
  migrateS3ToLocalServer,
};
