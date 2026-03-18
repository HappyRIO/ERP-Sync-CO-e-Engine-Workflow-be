// Seed script to populate initial data
import prisma from './src/config/database';

async function seed() {
  console.log('🌱 Seeding database...');

  // Create or update global asset categories (shared by all tenants)
  // Uses upsert so new categories (e.g. VOIP, WEEE Waste) can be added to existing DBs
  const categories = [
    {
      name: 'Networking',
      icon: '📡',
      co2ePerUnit: 100, // kg CO2e saved per unit reused
      avgWeight: 1.0, // kg
      avgBuybackValue: 45, // £
    },
    {
      name: 'Server',
      icon: '🖥️',
      co2ePerUnit: 500,
      avgWeight: 20.0,
      avgBuybackValue: 300,
    },
    {
      name: 'Storage',
      icon: '💾',
      co2ePerUnit: 200,
      avgWeight: 2.0,
      avgBuybackValue: 100,
    },
    {
      name: 'Laptop',
      icon: '💻',
      co2ePerUnit: 250,
      avgWeight: 2.5,
      avgBuybackValue: 150,
    },
    {
      name: 'Desktop',
      icon: '🖥️',
      co2ePerUnit: 300,
      avgWeight: 8.0,
      avgBuybackValue: 80,
    },
    {
      name: 'Smart Phones',
      icon: '📱',
      co2ePerUnit: 60,
      avgWeight: 0.2,
      avgBuybackValue: 30,
    },
    {
      name: 'Tablets',
      icon: '📱',
      co2ePerUnit: 80,
      avgWeight: 0.5,
      avgBuybackValue: 50,
    },
    {
      name: 'VOIP',
      icon: '📞',
      co2ePerUnit: 60, // Estimated: kg CO2e saved per unit reused (IP phones)
      avgWeight: 0.5,
      avgBuybackValue: 30, // Estimated £
    },
    {
      name: 'WEEE Waste',
      icon: '♻️',
      co2ePerUnit: 100, // Estimated: kg CO2e saved per unit (recycling/avoided production)
      avgWeight: 2.0,
      avgBuybackValue: 10, // Estimated £ (often low for e-waste)
    },
  ];

  let created = 0;
  for (const category of categories) {
    const existing = await prisma.assetCategory.findUnique({
      where: { name: category.name },
    });
    if (!existing) {
      await prisma.assetCategory.create({
        data: category,
      });
      created++;
    }
  }

  console.log(`✅ Asset categories: ${created} new category/categories created (${categories.length} total defined)`);

  await prisma.$disconnect();
  console.log('✅ Seeding complete!');
}

seed().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});

