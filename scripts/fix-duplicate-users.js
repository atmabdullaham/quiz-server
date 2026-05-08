import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform';

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

const User = mongoose.model('User', userSchema);

async function fixDuplicateUsers() {
  try {
    console.log('\n🔍 Connecting to MongoDB...');
    await mongoose.connect(mongodbUri);
    console.log('✅ Connected to MongoDB\n');

    const email = 'atmabdullaham@gmail.com';
    console.log(`🔍 Searching for duplicate users with email: ${email}\n`);

    // Find all users with this email
    const users = await User.find({ email }).sort({ createdAt: -1 });

    if (users.length === 0) {
      console.log('❌ No users found with this email\n');
      process.exit(0);
    }

    if (users.length === 1) {
      console.log('✅ Only one user found - no duplicates\n');
      console.log('Current user:');
      console.log(`  ID: ${users[0]._id}`);
      console.log(`  Email: ${users[0].email}`);
      console.log(`  Role: ${users[0].role}`);
      console.log(`  Created: ${users[0].createdAt}\n`);
      process.exit(0);
    }

    // Multiple users found
    console.log(`⚠️  Found ${users.length} users with this email!\n`);
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. ID: ${user._id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Firebase UID: ${user.firebaseUid}`);
      console.log(`   Created: ${user.createdAt}`);
      console.log();
    });

    // Find the one with admin role (if any)
    const adminUser = users.find(u => u.role === 'admin');
    const userUser = users.find(u => u.role === 'user');

    if (adminUser) {
      console.log(`✅ Found admin user with ID: ${adminUser._id}`);
      console.log(`⚠️  Deleting ${users.length - 1} duplicate/non-admin users...\n`);

      // Delete all except the admin one
      for (const user of users) {
        if (user._id.toString() !== adminUser._id.toString()) {
          await User.deleteOne({ _id: user._id });
          console.log(`🗑️  Deleted user: ${user._id} (role: ${user.role})`);
        }
      }

      console.log(`\n✅ Cleanup complete!`);
      console.log(`✅ Kept admin user: ${adminUser._id}`);
      console.log(`📌 User must log out and log back in to see admin dashboard\n`);
    } else if (userUser) {
      console.log(`❌ Found ${users.length} regular users but NO admin user`);
      console.log(`\n🔧 Fixing: Promoting user ${userUser._id} to admin and deleting duplicates...\n`);

      // Promote first user to admin
      const promoted = await User.findByIdAndUpdate(
        userUser._id,
        { role: 'admin' },
        { new: true }
      );

      // Delete others
      for (const user of users) {
        if (user._id.toString() !== userUser._id.toString()) {
          await User.deleteOne({ _id: user._id });
          console.log(`🗑️  Deleted duplicate: ${user._id}`);
        }
      }

      console.log(`\n✅ Fixed!`);
      console.log(`✅ Promoted user ${promoted._id} to admin`);
      console.log(`📌 User must log out and log back in to see admin dashboard\n`);
    }

    await mongoose.connection.close();
    console.log('✅ Connection closed\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixDuplicateUsers();
