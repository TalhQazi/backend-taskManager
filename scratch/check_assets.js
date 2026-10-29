const mongoose = require('mongoose');
const Asset = require('../src/models/AssetLibraryAsset');

async function check() {
  try {
    const dbUri = "mongodb+srv://nathan_db_user:7VDyHTB29JdpXawX@task.avdytln.mongodb.net/?appName=Task";
    await mongoose.connect(dbUri);
    console.log('Connected to DB');
    const counts = await Asset.aggregate([
      { $group: { _id: '$mimeType', count: { $sum: 1 } } }
    ]);
    console.log('Mime Types:');
    console.log(JSON.stringify(counts, null, 2));
    
    const total = await Asset.countDocuments({});
    console.log('Total Assets in DB:', total);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
