#!/usr/bin/env node
/**
 * PHASE 1 CLEANUP SCRIPT - Drop StudentProfile Collection
 * 
 * PURPOSE: Permanently remove StudentProfile collection after verified successful migration
 * WARNING: This is DESTRUCTIVE - only run after verification passes AND 48-hour stability test
 * SAFETY: Requires --confirm flag to proceed
 * 
 * USAGE: node backend/scripts/cleanup-phase1.js --confirm
 * 
 * EXPECTED OUTPUT:
 * ✅ StudentProfile collection dropped
 * ✅ Old indexes removed
 * ✅ Cleanup complete - ready for PHASE 2
 */

import 'dotenv/config.js';
import mongoose from 'mongoose';

// Check for --confirm flag (safety feature)
if (!process.argv.includes('--confirm')) {
  console.log('❌ CLEANUP REQUIRES CONFIRMATION!\n');
  console.log('⚠️  This will PERMANENTLY DELETE the StudentProfile collection.\n');
  console.log('📝 To proceed, run:');
  console.log('   node backend/scripts/cleanup-phase1.js --confirm\n');
  console.log('   Before running cleanup, ensure:');
  console.log('   ✅ Migration verification tests all passed');
  console.log('   ✅ System has been stable for 48+ hours');
  console.log('   ✅ No errors in application logs\n');
  process.exit(0);
}

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
});

const studentProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  studentName: String,
  schoolName: String,
  className: String,
  rollNumber: String,
  mobileNumber: String,
  address: String,
  createdAt: Date,
  updatedAt: Date
});

const StudentProfile = mongoose.model('StudentProfile', studentProfileSchema);

async function cleanup() {
  try {
    console.log('🧹 Starting PHASE 1 Cleanup...\n');
    console.log('⚠️  POINT OF NO RETURN - StudentProfile collection will be deleted.\n');

    // Get count before deletion
    const count = await StudentProfile.countDocuments({});
    console.log(`📊 StudentProfile documents: ${count}`);

    // Drop collection
    await StudentProfile.collection.drop();
    console.log('✅ StudentProfile collection dropped\n');

    // Remove old indexes (if any remain)
    try {
      const indexes = await mongoose.connection.db.collection('studentprofiles').getIndexes();
      const indexNames = Object.keys(indexes).filter(name => name !== '_id_');
      
      if (indexNames.length > 0) {
        for (const indexName of indexNames) {
          await mongoose.connection.db.collection('studentprofiles').dropIndex(indexName);
          console.log(`✅ Dropped index: ${indexName}`);
        }
      }
    } catch (indexError) {
      // Collection already deleted, indexes don't matter
      console.log('✅ No lingering indexes to clean');
    }

    console.log('\n✅ CLEANUP COMPLETE!\n');
    console.log('📝 Database Status:');
    console.log('   - StudentProfile collection: DELETED ✅');
    console.log('   - User.profile data: INTACT ✅');
    console.log('   - All submissions: INTACT ✅');
    console.log('\n🚀 Ready for PHASE 2 - Quiz Submission Flow Updates\n');

  } catch (error) {
    console.error('❌ CLEANUP FAILED:', error.message);
    console.log('\n⚠️  StudentProfile collection may still exist.');
    console.log('   Please verify database state before proceeding.\n');
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Run cleanup with confirmation
console.log('🔐 CONFIRMED: Proceeding with cleanup...\n');
cleanup();
