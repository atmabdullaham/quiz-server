import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform', {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
};

const fixIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    const submissionsCollection = db.collection('submissions');

    // Step 1: List all current indexes
    console.log('\n📋 Current indexes:');
    const currentIndexes = await submissionsCollection.listIndexes().toArray();
    console.log(JSON.stringify(currentIndexes, null, 2));

    // Step 2: Drop old index if it exists
    const oldIndexName = 'quizId_1_studentProfileId_1';
    const indexExists = currentIndexes.some(idx => idx.name === oldIndexName);
    
    if (indexExists) {
      console.log(`\n🗑️  Dropping old index: ${oldIndexName}`);
      await submissionsCollection.dropIndex(oldIndexName);
      console.log(`✅ Dropped old index: ${oldIndexName}`);
    } else {
      console.log(`\n⚠️  Old index not found: ${oldIndexName}`);
    }

    // Step 3: Drop other problematic indexes if they exist
    const indexesToCheck = [
      { name: 'quizId_1_mobileNumber_1', desc: 'quizId_1_mobileNumber_1' },
      { name: 'quizId_1', desc: 'quizId_1' },
      { name: 'userId_1', desc: 'userId_1' }
    ];
    
    for (const idx of indexesToCheck) {
      if (currentIndexes.some(i => i.name === idx.name)) {
        console.log(`🗑️  Dropping index: ${idx.name}`);
        await submissionsCollection.dropIndex(idx.name);
        console.log(`✅ Dropped index: ${idx.name}`);
      }
    }

    // Step 4: Create the correct unique index
    console.log('\n📌 Creating new index: (quizId, userId) with unique constraint');
    await submissionsCollection.createIndex(
      { quizId: 1, userId: 1 },
      { unique: true, name: 'quizId_1_userId_1' }
    );
    console.log('✅ Created new unique index on (quizId, userId)');

    // Step 5: Verify new indexes
    console.log('\n📋 Updated indexes:');
    const newIndexes = await submissionsCollection.listIndexes().toArray();
    console.log(JSON.stringify(newIndexes, null, 2));

    console.log('\n✅ Index fix completed successfully!');
  } catch (error) {
    console.error('\n❌ Error fixing indexes:', error.message);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    await fixIndexes();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    process.exit(0);
  }
};

main();
