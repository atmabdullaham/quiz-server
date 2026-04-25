#!/usr/bin/env node
/**
 * PHASE 1 MIGRATION SCRIPT - StudentProfile to User.profile
 * 
 * PURPOSE: Migrate all StudentProfile data into User.profile subdocument
 * STATUS: Migrates data; does NOT delete StudentProfile collection
 * 
 * USAGE: node backend/scripts/migrate-phase1.js
 * 
 * EXPECTED OUTPUT:
 * ✅ Migration Summary:
 *    - Total StudentProfile documents: N
 *    - Successfully migrated: N
 *    - Failed migrations: 0
 *    - Users updated with profile data
 *    - Statistics initialized for all users
 */

import 'dotenv/config.js';
import mongoose from 'mongoose';

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
});

// Define schemas
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

async function migrateData() {
  try {
    console.log('🔄 Starting PHASE 1 Migration...\n');

    // Get all StudentProfile documents
    const studentProfiles = await StudentProfile.find({});
    console.log(`📊 Found ${studentProfiles.length} StudentProfile documents\n`);

    let successCount = 0;
    let failureCount = 0;
    const failedIds = [];

    // Migrate each StudentProfile
    for (const profile of studentProfiles) {
      try {
        // Find corresponding User
        let user;
        
        if (profile.userId) {
          // Link via userId
          user = await User.findById(profile.userId);
        }

        if (!user) {
          console.log(`⚠️  WARNING: No User found for StudentProfile ${profile._id}`);
          failureCount++;
          failedIds.push(profile._id.toString());
          continue;
        }

        // Update User with profile data
        user.profile = {
          studentName: profile.studentName,
          schoolName: profile.schoolName,
          className: profile.className,
          rollNumber: profile.rollNumber || '',
          mobileNumber: profile.mobileNumber || '',
          address: profile.address || '',
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt || new Date()
        };

        // Initialize statistics if not present
        if (!user.studentStatistics) {
          user.studentStatistics = {
            totalQuizzesAttempted: 0,
            totalPoints: 0,
            quizzesWon: 0,
            lastQuizTakenAt: null,
            lastPointsUpdatedAt: null
          };
        }

        user.updatedAt = new Date();
        await user.save();
        
        successCount++;
        process.stdout.write('.');
      } catch (error) {
        console.error(`\n❌ Failed to migrate StudentProfile ${profile._id}:`, error.message);
        failureCount++;
        failedIds.push(profile._id.toString());
      }
    }

    console.log('\n\n✅ MIGRATION COMPLETE (PHASE 1)!\n');
    console.log('📈 Migration Summary:');
    console.log(`   - Total StudentProfile documents: ${studentProfiles.length}`);
    console.log(`   - Successfully migrated: ${successCount}`);
    console.log(`   - Failed migrations: ${failureCount}`);
    
    if (failedIds.length > 0) {
      console.log(`\n⚠️  Failed Profile IDs:\n   ${failedIds.join('\n   ')}`);
    }

    // PHASE 1.5: Initialize statistics for ANY users missing them
    console.log('\n🔄 PHASE 1.5: Initializing statistics for all users...');
    
    const allUsers = await User.find({});
    let statsInitCount = 0;
    
    for (const user of allUsers) {
      if (!user.studentStatistics || !user.studentStatistics.totalQuizzesAttempted) {
        user.studentStatistics = {
          totalQuizzesAttempted: 0,
          totalPoints: 0,
          quizzesWon: 0,
          lastQuizTakenAt: null,
          lastPointsUpdatedAt: null
        };
        await user.save();
        statsInitCount++;
        process.stdout.write('.');
      }
    }

    if (statsInitCount > 0) {
      console.log(`\n✅ Initialized statistics for ${statsInitCount} users`);
    } else {
      console.log(`\n✅ All users already have statistics`);
    }

    console.log('\n📝 Next Steps:');
    console.log('   1. Run: node backend/scripts/test-phase1.js');
    console.log('      (Verify migration success with 6 tests)');
    console.log('   2. After verification passes:');
    console.log('      node backend/scripts/cleanup-phase1.js --confirm');
    console.log('      (Drop StudentProfile collection permanently)\n');

  } catch (error) {
    console.error('❌ MIGRATION FAILED:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Run migration
migrateData();
