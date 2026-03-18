// Script to clean up database and seed with admin company, admin user, and asset categories
import prisma from './src/config/database';
import { hashPassword } from './src/utils/password';
import { deleteAllFromS3, isS3Enabled } from './src/utils/s3-storage';

async function cleanupDatabase() {
  console.log('🧹 Starting database cleanup...\n');

  try {
    // Find Reuse Connect ITAD Platform tenant
    const reuseTenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { name: 'Reuse Connect ITAD Platform' },
          { slug: 'reuse' },
        ],
      },
    });

    let reuseTenantId: string;
    
    if (!reuseTenant) {
      console.log('⚠️  Reuse Connect ITAD Platform tenant not found. Creating it...');
      const newTenant = await prisma.tenant.create({
        data: {
          name: 'Reuse Connect ITAD Platform',
          slug: 'reuse',
          primaryColor: '168, 70%, 35%',
          accentColor: '168, 60%, 45%',
          theme: 'auto',
        },
      });
      reuseTenantId = newTenant.id;
      console.log('✅ Created Reuse Connect ITAD Platform tenant\n');
    } else {
      reuseTenantId = reuseTenant.id;
      console.log(`✅ Found Reuse Connect ITAD Platform tenant: ${reuseTenant.name} (${reuseTenantId})\n`);
    }

    // Step 0: Delete all S3 files (if S3 is enabled)
    if (isS3Enabled()) {
      console.log('☁️  Deleting all S3 files...');
      try {
        const deletedS3Files = await deleteAllFromS3();
        console.log(`   ✅ Deleted ${deletedS3Files} files from S3\n`);
      } catch (error) {
        console.error(`   ⚠️  Failed to delete S3 files: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.log('   Continuing with database cleanup...\n');
      }
    } else {
      console.log('☁️  S3 storage is not enabled. Skipping S3 cleanup.\n');
    }

    // Step 1: Delete all bookings (this will cascade delete BookingAsset, BookingStatusHistory)
    console.log('📦 Deleting all bookings...');
    const deletedBookings = await prisma.booking.deleteMany({});
    console.log(`   ✅ Deleted ${deletedBookings.count} bookings\n`);

    // Step 2: Delete all jobs (this will cascade delete JobAsset, JobStatusHistory, Evidence, CO2Result, etc.)
    console.log('💼 Deleting all jobs...');
    const deletedJobs = await prisma.job.deleteMany({});
    console.log(`   ✅ Deleted ${deletedJobs.count} jobs\n`);

    // Step 3: Delete all driver profiles (before deleting users)
    console.log('🚗 Deleting all driver profiles...');
    const deletedDriverProfiles = await prisma.driverProfile.deleteMany({});
    console.log(`   ✅ Deleted ${deletedDriverProfiles.count} driver profiles\n`);

    // Step 4: Delete all sites
    console.log('📍 Deleting all sites...');
    const deletedSites = await prisma.site.deleteMany({});
    console.log(`   ✅ Deleted ${deletedSites.count} sites\n`);

    // Step 5: Delete all clients
    console.log('👥 Deleting all clients...');
    const deletedClients = await prisma.client.deleteMany({});
    console.log(`   ✅ Deleted ${deletedClients.count} clients\n`);

    // Step 6: Delete ALL documents (must be done before deleting users due to foreign key constraint)
    console.log('📄 Deleting all documents...');
    const deletedDocuments = await prisma.document.deleteMany({});
    console.log(`   ✅ Deleted ${deletedDocuments.count} documents\n`);

    // Step 7: Delete all invites (delete all invites, we'll keep only admins)
    console.log('✉️  Deleting all invites...');
    const deletedInvites = await prisma.invite.deleteMany({});
    console.log(`   ✅ Deleted ${deletedInvites.count} invites\n`);

    // Step 8: Delete all non-admin users (resellers, clients, drivers)
    // But keep admin users (they might be in any tenant, but we'll keep them)
    console.log('👤 Deleting non-admin users (resellers, clients, drivers)...');
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        role: { in: ['reseller', 'client', 'driver'] },
      },
    });
    console.log(`   ✅ Deleted ${deletedUsers.count} non-admin users\n`);

    // Step 9: Delete all vehicles (must be done before deleting admin users due to createdBy foreign key)
    console.log('🚗 Deleting all vehicles...');
    const deletedVehicles = await prisma.vehicle.deleteMany({});
    console.log(`   ✅ Deleted ${deletedVehicles.count} vehicles\n`);

    // Step 10: Delete all tenants except Reuse Connect ITAD Platform
    console.log('🏢 Deleting all tenants except Reuse Connect ITAD Platform...');
    const deletedTenants = await prisma.tenant.deleteMany({
      where: {
        id: { not: reuseTenantId },
      },
    });
    console.log(`   ✅ Deleted ${deletedTenants.count} tenants\n`);

    // Step 11: Delete all admin users (we'll recreate them)
    console.log('👤 Deleting all admin users...');
    const deletedAdmins = await prisma.user.deleteMany({
      where: {
        role: 'admin',
      },
    });
    console.log(`   ✅ Deleted ${deletedAdmins.count} admin users\n`);

    // Step 12: Delete all asset categories (we'll recreate them)
    console.log('📦 Deleting all asset categories...');
    const deletedCategories = await prisma.assetCategory.deleteMany({});
    console.log(`   ✅ Deleted ${deletedCategories.count} asset categories\n`);

    // Step 13: Ensure Reuse Connect ITAD Platform tenant exists and is properly configured
    console.log('🏢 Ensuring Reuse Connect ITAD Platform tenant exists...');
    const finalTenant = await prisma.tenant.upsert({
      where: { id: reuseTenantId },
      update: {
        name: 'Reuse Connect ITAD Platform',
        slug: 'reuse',
        primaryColor: '168, 70%, 35%',
        accentColor: '168, 60%, 45%',
        theme: 'auto',
      },
      create: {
        name: 'Reuse Connect ITAD Platform',
        slug: 'reuse',
        primaryColor: '168, 70%, 35%',
        accentColor: '168, 60%, 45%',
        theme: 'auto',
      },
    });
    console.log(`   ✅ Reuse Connect ITAD Platform tenant ready: ${finalTenant.name} (${finalTenant.id})\n`);

    // Step 14: Create admin user
    console.log('👤 Creating admin user...');
    const adminEmail = 'admin@reuse.com';
    const adminPassword = 'admin123';
    const adminName = 'Admin User';
    
    const hashedPassword = await hashPassword(adminPassword);
    
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        name: adminName,
        password: hashedPassword,
        role: 'admin',
        status: 'active',
        tenantId: finalTenant.id,
      },
      create: {
        email: adminEmail,
        name: adminName,
        password: hashedPassword,
        role: 'admin',
        status: 'active',
        tenantId: finalTenant.id,
      },
    });
    console.log(`   ✅ Admin user created/updated:`);
    console.log(`      ID: ${admin.id}`);
    console.log(`      Email: ${admin.email}`);
    console.log(`      Password: ${adminPassword}`);
    console.log(`      Name: ${admin.name}\n`);

    // Step 15: Create 7 asset categories with complete buyback data
    console.log('📦 Creating asset categories...');
    const categories = [
      {
        name: 'Networking',
        icon: '📡',
        co2ePerUnit: 500,
        avgWeight: 1.0,
        avgBuybackValue: 300, // RRP × residualLow = 2000 × 0.15
        avgRRP: 2000,
        residualLow: 0.15,
        buybackFloor: 25,
        buybackCap: 2000,
      },
      {
        name: 'Laptop',
        icon: '💻',
        co2ePerUnit: 250,
        avgWeight: 2.5,
        avgBuybackValue: 180, // RRP × residualLow = 1000 × 0.18
        avgRRP: 1000,
        residualLow: 0.18,
        buybackFloor: 35,
        buybackCap: 600,
      },
      {
        name: 'Server',
        icon: '🖥️',
        co2ePerUnit: 1200,
        avgWeight: 20.0,
        avgBuybackValue: 400, // RRP × residualLow = 5000 × 0.08
        avgRRP: 5000,
        residualLow: 0.08,
        buybackFloor: 60,
        buybackCap: 2500,
      },
      {
        name: 'Smart Phones',
        icon: '📱',
        co2ePerUnit: 70,
        avgWeight: 0.2,
        avgBuybackValue: 119, // RRP × residualLow = 700 × 0.17
        avgRRP: 700,
        residualLow: 0.17,
        buybackFloor: 30,
        buybackCap: 450,
      },
      {
        name: 'Desktop',
        icon: '🖥️',
        co2ePerUnit: 350,
        avgWeight: 8.0,
        avgBuybackValue: 81, // RRP × residualLow = 900 × 0.09
        avgRRP: 900,
        residualLow: 0.09,
        buybackFloor: 15,
        buybackCap: 250,
      },
      {
        name: 'Storage',
        icon: '💾',
        co2ePerUnit: 800,
        avgWeight: 2.0,
        avgBuybackValue: 300, // RRP × residualLow = 6000 × 0.05
        avgRRP: 6000,
        residualLow: 0.05,
        buybackFloor: 50,
        buybackCap: 3000,
      },
      {
        name: 'Tablets',
        icon: '📱',
        co2ePerUnit: 90,
        avgWeight: 0.5,
        avgBuybackValue: 102, // RRP × residualLow = 600 × 0.17
        avgRRP: 600,
        residualLow: 0.17,
        buybackFloor: 15,
        buybackCap: 400,
      },
      {
        name: 'VOIP',
        icon: '📞',
        co2ePerUnit: 60,
        avgWeight: 0.5,
        avgBuybackValue: 30,
        avgRRP: 150,
        residualLow: 0.2,
        buybackFloor: 5,
        buybackCap: 80,
      },
      {
        name: 'WEEE Waste',
        icon: '♻️',
        co2ePerUnit: 100,
        avgWeight: 2.0,
        avgBuybackValue: 10,
        avgRRP: 50,
        residualLow: 0.2,
        buybackFloor: 0,
        buybackCap: 25,
      },
    ];

    let createdCategories = 0;
    for (const category of categories) {
      await prisma.assetCategory.upsert({
        where: { name: category.name },
        update: category,
        create: category,
      });
      createdCategories++;
    }
    console.log(`   ✅ Created/updated ${createdCategories} asset categories\n`);

    // Summary
    console.log('📊 Cleanup & Seed Summary:');
    if (isS3Enabled()) {
      console.log(`   - S3 files deleted: (see above)`);
    }
    console.log(`   - Bookings deleted: ${deletedBookings.count}`);
    console.log(`   - Jobs deleted: ${deletedJobs.count}`);
    console.log(`   - Driver profiles deleted: ${deletedDriverProfiles.count}`);
    console.log(`   - Vehicles deleted: ${deletedVehicles.count}`);
    console.log(`   - Sites deleted: ${deletedSites.count}`);
    console.log(`   - Clients deleted: ${deletedClients.count}`);
    console.log(`   - Documents deleted: ${deletedDocuments.count}`);
    console.log(`   - Invites deleted: ${deletedInvites.count}`);
    console.log(`   - Non-admin users deleted: ${deletedUsers.count}`);
    console.log(`   - Admin users deleted: ${deletedAdmins.count}`);
    console.log(`   - Tenants deleted: ${deletedTenants.count}`);
    console.log(`   - Asset categories deleted: ${deletedCategories.count}`);
    console.log(`\n🌱 Seeded Data:`);
    console.log(`   - Admin company: Reuse Connect ITAD Platform`);
    console.log(`   - Admin user: ${adminEmail} / ${adminPassword}`);
    console.log(`   - Asset categories: ${createdCategories} items`);
    console.log('\n✅ Database cleanup and seeding completed successfully!\n');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run cleanup
cleanupDatabase().catch((error) => {
  console.error('❌ Failed to cleanup database:', error);
  process.exit(1);
});

