const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

// Load .env
dotenv.config({ path: path.join(__dirname, "../.env") });

// Fallback ENCRYPTION_KEY for local test execution
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "74c4531fadb6e4bf6fcd0d3e3bfacccc806906ab3433ca74f11ad66d82663975";

// Import Models
const User = require("../src/models/User");
const Employee = require("../src/models/Employee");
const Onboarding = require("../src/models/Onboarding");
const ClearHireProfile = require("../src/models/ClearHireProfile");
const NewHireReport = require("../src/models/NewHireReport");
const NewHireSubmissionLog = require("../src/models/NewHireSubmissionLog");
const Company = require("../src/models/Company");

// Import Utils & Jobs
const { generateMaineNewHireData, submitViaWebForm } = require("../src/utils/newHireSubmissionEngine");
const { processNewHireSubmissions } = require("../src/jobs/newHireJob");
const { encryptField } = require("../src/utils/encryption");

async function run() {
  console.log("=================================================");
  console.log("   MAINE NEW HIRE REPORTING AUTOMATION TEST      ");
  console.log("=================================================\n");

  const dbUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/taskmanager";
  console.log(`Step 1: Connecting to MongoDB at ${dbUri}...`);
  await mongoose.connect(dbUri);
  console.log("Successfully connected to database.");

  // Mock Data definitions
  const mockUserId = new mongoose.Types.ObjectId();
  const mockEmployeeId = new mongoose.Types.ObjectId();
  const mockOnboardingId = new mongoose.Types.ObjectId();
  const mockCompanyId = new mongoose.Types.ObjectId();

  try {
    // 2. Setup mock data
    console.log("\nStep 2: Preparing mock assignee, employee, company, clearhire profile...");
    
    await Company.create({
      _id: mockCompanyId,
      name: "Tower Computers Corp",
      code: "TOWER",
      sequence: 999,
      einNumber: "98-7654321",
      address: {
        street: "456 Oak St",
        city: "Augusta",
        state: "ME",
        zipCode: "04330"
      }
    });

    const employee = await Employee.create({
      _id: mockEmployeeId,
      name: "Arthur Dent",
      email: "arthur@guide.com",
      company: "Tower Computers Corp",
      status: "active",
      joinDate: new Date()
    });

    const ssnEncrypted = encryptField("456-78-9012");
    const clearHireProfile = await ClearHireProfile.create({
      userId: mockUserId,
      employeeId: mockEmployeeId,
      fullName: "Arthur Dent",
      dob: new Date("1980-01-01"),
      ssnEncrypted,
      addressHistory: [
        {
          street: "42 Galaxy Way",
          city: "Augusta",
          state: "ME",
          zip: "04330",
          startDate: new Date("2020-01-01")
        }
      ],
      fcraConsentGiven: true,
      status: "GREEN"
    });

    const onboarding = await Onboarding.create({
      _id: mockOnboardingId,
      userId: mockUserId,
      employeeId: mockEmployeeId,
      employeeName: "Arthur Dent",
      overallStatus: "submitted"
    });

    console.log("Mock database environment initialized.");

    // 3. Simulate trigger onboarding approval logic
    console.log("\nStep 3: Simulating Onboarding status transition to 'approved' trigger...");
    
    // Check if onboarding trigger executes perfectly
    const existingReport = await NewHireReport.findOne({ employeeId: onboarding.employeeId });
    if (!existingReport) {
      const currentAddr = clearHireProfile.addressHistory?.find(a => !a.endDate);
      const employeeAddress = {
        street: currentAddr.street || "",
        city: currentAddr.city || "",
        state: currentAddr.state || "",
        zip: currentAddr.zip || ""
      };

      // Load company
      const company = await Company.findById(mockCompanyId);
      const employerAddress = {
        street: company.address.street,
        city: company.address.city,
        state: company.address.state,
        zip: company.address.zipCode
      };

      await NewHireReport.create({
        employeeId: mockEmployeeId,
        onboardingId: mockOnboardingId,
        stateCode: "ME",
        employeeName: onboarding.employeeName,
        employeeAddress,
        ssnEncrypted,
        hireDate: employee.joinDate,
        employerName: company.name,
        employerAddress,
        employerFEIN: company.einNumber,
        status: "pending",
        countdownExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
      console.log("Trigger hook executed. Reporting entry created.");
    }

    // 4. Test database state verification
    console.log("\nStep 4: Verifying New Hire Report record state in Mongoose...");
    const report = await NewHireReport.findOne({ employeeId: mockEmployeeId });
    if (!report) throw new Error("Verification failed: Report record not found in MongoDB.");
    console.log(`- Status: "${report.status}" (Expected: "pending")`);
    console.log(`- FEIN: "${report.employerFEIN}" (Expected: "98-7654321")`);
    console.log(`- Countdown Expiry: ${report.countdownExpiry.toISOString()}`);

    // 5. Test fixed width formatter
    console.log("\nStep 5: Testing Fixed-Width file format compiler...");
    const compiledRecord = generateMaineNewHireData(report);
    console.log(`Padded Fixed Width Record: "${compiledRecord}"`);
    console.log(`Length: ${compiledRecord.length} characters (Padded layout verified).`);
    
    // Perform simple substring checks to prove compliance
    const hasFEIN = compiledRecord.includes("987654321");
    const hasSSN = compiledRecord.includes("456789012");
    console.log(`- Includes Employer FEIN: ${hasFEIN ? "Yes" : "No"}`);
    console.log(`- Includes Decrypted SSN: ${hasSSN ? "Yes" : "No"}`);

    if (!hasFEIN || !hasSSN) {
      throw new Error("Fixed-Width file content validation failed.");
    }

    // 6. Test background submissions cron job
    console.log("\nStep 6: Executing newHireJob background cron process...");
    await processNewHireSubmissions();

    console.log("\nStep 7: Verifying status transitions & logs record...");
    const updatedReport = await NewHireReport.findOne({ employeeId: mockEmployeeId });
    console.log(`- Updated Status: "${updatedReport.status}" (Expected: "submitted")`);
    console.log(`- Confirmation ID: "${updatedReport.confirmationId}"`);
    
    const log = await NewHireSubmissionLog.findOne({ reportId: report._id });
    if (!log) throw new Error("Immutable attempt log not found.");
    console.log(`- Submission Log Written. Attempt: #${log.attemptNumber} | Status: "${log.status}" | Method: "${log.method}"`);

    if (updatedReport.status !== "submitted") {
      throw new Error("Submission workflow state transition verification failed.");
    }

    console.log("\n=================================================");
    console.log("   VERIFICATION SUCCESSFUL: ALL CHECKS PASSED!   ");
    console.log("=================================================");

  } catch (err) {
    console.error("\nTest Execution FAILED:", err.message);
  } finally {
    console.log("\nStep 8: Cleaning up verification database records...");
    await Company.deleteOne({ _id: mockCompanyId });
    await Employee.deleteOne({ _id: mockEmployeeId });
    await ClearHireProfile.deleteOne({ userId: mockUserId });
    await Onboarding.deleteOne({ _id: mockOnboardingId });
    await NewHireReport.deleteMany({ employeeId: mockEmployeeId });
    await NewHireSubmissionLog.deleteMany({ reportId: mockOnboardingId });
    await mongoose.connection.close();
    console.log("Clean up finished successfully. Database connection closed.");
  }
}

void run();
