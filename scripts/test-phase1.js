#!/usr/bin/env node
/**
 * PHASE 1 TEST SCRIPT - Verify StudentProfile to User.profile migration
 * 
 * PURPOSE: Validate that migration completed successfully with 6 verification tests
 * TESTS:
 *   1. Verify all StudentProfile docs have corresponding User.profile
 *   2. Verify no data loss in migration
 *   3. Verify User.studentStatistics initialized
 *   4. Verify indexes on new profile fields
 *   5. Verify no orphaned StudentProfiles
 *   6. Count totals for before/after
 * 
 * USAGE: node backend/scripts/test-phase1.js
 * 
 * EXPECTED OUTPUT:
 * ✅ TEST 1/6: All StudentProfile data migrated
 * ✅ TEST 2/6: No data loss detected
 * ✅ TEST 3/6: Statistics initialized
 * ✅ TEST 4/6: Indexes created
 * ✅ TEST 5/6: No orphaned profiles
 * ✅ TEST 6/6: Final counts verified
 */

import 'dotenv/config.js';
import mongoose from 'mongoose';

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
});

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  email: String,
  name: String,
  picture: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  profile: {
    studentName: String,
    schoolName: String,
    className: String,
    rollNumber: String,
    mobileNumber: String,
    address: String,
    createdAt: Date,
    updatedAt: { type: Date, default: Date.now }
  },
  studentStatistics: {
    totalQuizzesAttempted: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    quizzesWon: { type: Number, default: 0 },
    lastQuizTakenAt: Date,
    lastPointsUpdatedAt: Date
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
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

const User = mongoose.model('User', userSchema);
const StudentProfile = mongoose.model('StudentProfile', studentProfileSchema);

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ TEST ${testsPassed + testsFailed + 1}/6: ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ TEST ${testsPassed + testsFailed + 1}/6: ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function runTests() {
  try {
    console.log('🧪 Starting PHASE 1 Verification Tests...\n');

    // TEST 1: Verify all StudentProfile data migrated
    await test('All StudentProfile data migrated', async () => {
      const profiles = await StudentProfile.find({});
      const migratedCount = await User.find({ 'profile.studentName': { $exists: true } }).countDocuments();
      
      if (migratedCount < profiles.length) {
        throw new Error(`Only ${migratedCount}/${profiles.length} profiles migrated`);
      }
    });

    // TEST 2: Verify no data loss
    await test('No data loss detected', async () => {
      const profiles = await StudentProfile.find({});
      
      for (const profile of profiles) {
        const user = await User.findOne({ 'profile.studentName': profile.studentName });
        if (!user || !user.profile) {
          throw new Error(`Missing profile for ${profile.studentName}`);
        }
        
        // Check key fields
        if (user.profile.schoolName !== profile.schoolName) {
          throw new Error(`School name mismatch for ${profile.studentName}`);
        }
        if (user.profile.className !== profile.className) {
          throw new Error(`Class name mismatch for ${profile.studentName}`);
        }
      }
    });

    // TEST 3: Verify statistics initialized
    await test('Statistics initialized for all users', async () => {
      const usersWithoutStats = await User.find({
        $or: [
          { 'studentStatistics.totalQuizzesAttempted': { $exists: false } },
          { 'studentStatistics.totalPoints': { $exists: false } },
          { 'studentStatistics.quizzesWon': { $exists: false } }
        ]
      }).countDocuments();
      
      if (usersWithoutStats > 0) {
        throw new Error(`${usersWithoutStats} users missing statistics`);
      }
    });

    // TEST 4: Verify indexes created
    await test('Indexes created on profile fields', async () => {
      const indexes = await User.collection.getIndexes();
      const requiredIndexes = [
        'profile.mobileNumber_1',
        'profile.className_1',
        'profile.rollNumber_1'
      ];
      
      const indexNames = Object.keys(indexes);
      for (const required of requiredIndexes) {
        const found = indexNames.some(name => name.includes(required.split('_')[0]));
        if (!found) {
          console.log('   Available indexes:', indexNames);
          throw new Error(`Missing index: ${required}`);
        }
      }
    });

    // TEST 5: Verify no orphaned StudentProfiles
    await test('No orphaned StudentProfiles', async () => {
      const orphaned = await StudentProfile.find({
        userId: { $exists: false }
      }).countDocuments();
      
      if (orphaned > 0) {
        throw new Error(`Found ${orphaned} orphaned StudentProfiles`);
      }
    });

    // TEST 6: Verify final counts
    await test('Final counts verified', async () => {
      const totalUsers = await User.countDocuments({});
      const usersWithProfiles = await User.countDocuments({ 'profile.studentName': { $exists: true } });
      const totalStudentProfiles = await StudentProfile.countDocuments({});
      
      console.log(`\n   📊 Final Statistics:`);
      console.log(`      - Total Users: ${totalUsers}`);
      console.log(`      - Users with profiles: ${usersWithProfiles}`);
      console.log(`      - StudentProfile documents: ${totalStudentProfiles}`);
      
      if (usersWithProfiles !== totalStudentProfiles) {
        throw new Error(`Profile count mismatch: ${usersWithProfiles} vs ${totalStudentProfiles}`);
      }
    });

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ MIGRATION VERIFICATION COMPLETE!`);
    console.log(`   Tests Passed: ${testsPassed}/6`);
    console.log(`   Tests Failed: ${testsFailed}/6`);
    console.log(`${'='.repeat(50)}`);

    if (testsFailed === 0) {
      console.log(`\n✅ All tests passed! Migration successful.\n`);
      console.log('📝 Next Steps:');
      console.log('   1. Run production for 48 hours (stability test)');
      console.log('   2. Monitor for errors');
      console.log('   3. If stable, run cleanup:');
      console.log('      node backend/scripts/cleanup-phase1.js --confirm\n');
    } else {
      console.log(`\n❌ Some tests failed. Review migration before cleanup.\n`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ TEST SUITE ERROR:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Run tests
runTests();
