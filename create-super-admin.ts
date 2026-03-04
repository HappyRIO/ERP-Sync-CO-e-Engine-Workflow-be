// Script to create super admin account for developer team
import prisma from './src/config/database';
import { hashPassword } from './src/utils/password';

async function createSuperAdmin() {
  console.log('🔐 Creating super admin account...\n');

  try {
    // Get or create a tenant for super admin (use existing tenant or create one)
    let tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { name: 'Reuse Connect ITAD Platform' },
          { slug: 'reuse' },
        ],
      },
    });

    if (!tenant) {
      console.log('⚠️  No tenant found. Creating default tenant...');
      tenant = await prisma.tenant.create({
        data: {
          name: 'Reuse Connect ITAD Platform',
          slug: 'reuse',
          primaryColor: '168, 70%, 35%',
          accentColor: '168, 60%, 45%',
          theme: 'auto',
        },
      });
      console.log('✅ Created tenant\n');
    }

    // Super admin credentials (change these!)
    const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'dev-admin@reuseconnect.com';
    const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'ChangeThisPassword123!';
    const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'Developer Admin';

    // Check if super admin already exists
    const existingSuperAdmin = await prisma.user.findUnique({
      where: { email: SUPER_ADMIN_EMAIL },
    });

    if (existingSuperAdmin) {
      if (existingSuperAdmin.isSuperAdmin) {
        // Update password if account already exists
        const hashedPassword = await hashPassword(SUPER_ADMIN_PASSWORD);
        await prisma.user.update({
          where: { id: existingSuperAdmin.id },
          data: {
            password: hashedPassword,
            status: 'active', // Ensure status is active
            name: SUPER_ADMIN_NAME, // Update name if changed
          },
        });
        console.log('✅ Super admin account already exists - password updated:');
        console.log(`   Email: ${SUPER_ADMIN_EMAIL}`);
        console.log(`   Name: ${SUPER_ADMIN_NAME}`);
        console.log(`   Status: active`);
        console.log(`   Password: ${SUPER_ADMIN_PASSWORD}`);
        console.log('\n⚠️  Password has been updated!\n');
        return;
      } else {
        // Update existing user to super admin
        const hashedPassword = await hashPassword(SUPER_ADMIN_PASSWORD);
        await prisma.user.update({
          where: { id: existingSuperAdmin.id },
          data: {
            isSuperAdmin: true,
            password: hashedPassword,
            role: 'admin',
            status: 'active',
          },
        });
        console.log('✅ Updated existing user to super admin:');
        console.log(`   Email: ${SUPER_ADMIN_EMAIL}`);
        console.log(`   Name: ${SUPER_ADMIN_NAME}`);
        console.log(`   Password: ${SUPER_ADMIN_PASSWORD}`);
        console.log('\n⚠️  Password has been updated!\n');
        return;
      }
    }

    // Create new super admin
    const hashedPassword = await hashPassword(SUPER_ADMIN_PASSWORD);

    const superAdmin = await prisma.user.create({
      data: {
        email: SUPER_ADMIN_EMAIL,
        name: SUPER_ADMIN_NAME,
        password: hashedPassword,
        role: 'admin',
        status: 'active',
        tenantId: tenant.id,
        isSuperAdmin: true,
      },
    });

    console.log('✅ Super admin account created successfully!');
    console.log(`   Email: ${SUPER_ADMIN_EMAIL}`);
    console.log(`   Name: ${SUPER_ADMIN_NAME}`);
    console.log(`   Password: ${SUPER_ADMIN_PASSWORD}`);
    console.log(`   User ID: ${superAdmin.id}`);
    console.log('\n⚠️  IMPORTANT: Change the password after first login!');
    console.log('⚠️  This account is hidden from all user listings.\n');
  } catch (error) {
    console.error('❌ Error creating super admin:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createSuperAdmin()
  .then(() => {
    console.log('✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Failed:', error);
    process.exit(1);
  });
