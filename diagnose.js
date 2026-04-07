#!/usr/bin/env node

import axios from "axios";
import dns from "dns";
import mongoose from "mongoose";
import { promisify } from "util";

const resolveSrv = promisify(dns.resolveSrv);

console.log("\n🔍 Quiz Platform Diagnostic Tool\n");
console.log("=".repeat(50));

// Test 1: DNS Resolution
console.log("\n1️⃣  Testing DNS Resolution...");
try {
  const result = await resolveSrv("_mongodb._tcp.cluster0.tiuj62z.mongodb.net");
  console.log("   ✅ DNS resolution successful");
  console.log(`   Found ${result.length} SRV records`);
} catch (err) {
  console.log("   ❌ DNS resolution failed");
  console.log(`   Error: ${err.message}`);
  console.log("   💡 This means your network is blocking MongoDB Atlas DNS");
  console.log("   💡 Try: Use local MongoDB instead\n");
}

// Test 2: Local MongoDB
console.log("2️⃣  Testing Local MongoDB Connection...");
try {
  await mongoose.connect("mongodb://localhost:27017/quiz-platform", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 3000,
  });
  console.log("   ✅ Local MongoDB is running and accessible");
  await mongoose.connection.close();
} catch (err) {
  console.log("   ❌ Local MongoDB not running");
  console.log(`   Error: ${err.message}`);
  console.log("   💡 Start MongoDB: mongod (Windows) or docker run mongo\n");
}

// Test 3: Backend Server
console.log("3️⃣  Testing Backend Server...");
try {
  const response = await axios.get("http://localhost:5000/", {
    timeout: 3000,
  });
  console.log("   ✅ Backend server is running");
  console.log(`   Status: ${response.data.status}`);
} catch (err) {
  if (err.code === "ECONNREFUSED") {
    console.log("   ⚠️  Backend not running on port 5000");
    console.log("   💡 Start it: npm run dev");
  } else {
    console.log(`   Error: ${err.message}`);
  }
}

// Test 4: Check Environment Variables
console.log("\n4️⃣  Environment Variables...");
const mongoUri = process.env.MONGODB_URI;
if (mongoUri?.includes("mongodb+srv://")) {
  console.log("   📌 Using MongoDB Atlas (cloud)");
  console.log("   ⚠️  Atlas connection may fail due to network restrictions");
} else if (mongoUri?.includes("localhost")) {
  console.log("   📌 Using Local MongoDB");
} else {
  console.log("   ⚠️  MONGODB_URI not properly set");
}

// Summary
console.log("\n" + "=".repeat(50));
console.log("\n📋 Summary & Recommendations:\n");
console.log("1. Is Local MongoDB running? YES/NO");
console.log("   → If NO: Start MongoDB, then try backend again");
console.log("   → If YES: Backend should connect successfully");
console.log("\n2. Is DNS blocking MongoDB Atlas?");
console.log("   → Check test #1 result above");
console.log("   → Solution: Use local MongoDB for development");
console.log("\n💡 Quick Start:");
console.log("   mongod  (or docker equivalent) → npm run dev → npm start (frontend)");
console.log("\n");
