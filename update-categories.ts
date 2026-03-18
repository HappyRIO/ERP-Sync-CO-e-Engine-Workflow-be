// Unified script to update all AssetCategory field values
// Updates: co2ePerUnit, avgWeight, avgBuybackValue, avgRRP, residualLow, buybackFloor, buybackCap
import prisma from './src/config/database';

// Complete category data - all fields
const categoryData: Record<string, {
  co2ePerUnit: number;
  avgWeight: number;
  avgBuybackValue: number;
  avgRRP: number;
  residualLow: number;
  buybackFloor: number;
  buybackCap: number;
}> = {
  'Networking': {
    co2ePerUnit: 500,
    avgWeight: 1.0,
    avgBuybackValue: 300, // RRP × residualLow = 2000 × 0.15
    avgRRP: 2000,
    residualLow: 0.15,
    buybackFloor: 25,
    buybackCap: 2000,
  },
  'Laptop': {
    co2ePerUnit: 250,
    avgWeight: 2.5,
    avgBuybackValue: 180, // RRP × residualLow = 1000 × 0.18
    avgRRP: 1000,
    residualLow: 0.18,
    buybackFloor: 35,
    buybackCap: 600,
  },
  'Server': {
    co2ePerUnit: 1200,
    avgWeight: 20.0,
    avgBuybackValue: 400, // RRP × residualLow = 5000 × 0.08
    avgRRP: 5000,
    residualLow: 0.08,
    buybackFloor: 60,
    buybackCap: 2500,
  },
  'Smart Phones': {
    co2ePerUnit: 70,
    avgWeight: 0.2,
    avgBuybackValue: 119, // RRP × residualLow = 700 × 0.17
    avgRRP: 700,
    residualLow: 0.17,
    buybackFloor: 30,
    buybackCap: 450,
  },
  'Desktop': {
    co2ePerUnit: 350,
    avgWeight: 8.0,
    avgBuybackValue: 81, // RRP × residualLow = 900 × 0.09
    avgRRP: 900,
    residualLow: 0.09,
    buybackFloor: 15,
    buybackCap: 250,
  },
  'Storage': {
    co2ePerUnit: 800,
    avgWeight: 2.0,
    avgBuybackValue: 300, // RRP × residualLow = 6000 × 0.05
    avgRRP: 6000,
    residualLow: 0.05,
    buybackFloor: 50,
    buybackCap: 3000,
  },
  'Tablets': {
    co2ePerUnit: 90,
    avgWeight: 0.5,
    avgBuybackValue: 102, // RRP × residualLow = 600 × 0.17
    avgRRP: 600,
    residualLow: 0.17,
    buybackFloor: 15,
    buybackCap: 400,
  },
  'VOIP': {
    co2ePerUnit: 60, // Estimated
    avgWeight: 0.5,
    avgBuybackValue: 30, // Estimated
    avgRRP: 150,
    residualLow: 0.2,
    buybackFloor: 5,
    buybackCap: 80,
  },
  'WEEE Waste': {
    co2ePerUnit: 100, // Estimated (recycling/avoided production)
    avgWeight: 2.0,
    avgBuybackValue: 10, // Estimated (often low for e-waste)
    avgRRP: 50,
    residualLow: 0.2,
    buybackFloor: 0,
    buybackCap: 25,
  },
};

async function updateCategories() {
  console.log('🔄 Updating all AssetCategory field values...\n');

  try {
    // Get all categories
    const allCategories = await prisma.assetCategory.findMany({
      orderBy: { name: 'asc' },
    });

    console.log('📊 Updating categories:\n');

    let updatedCount = 0;
    let totalFieldsUpdated = 0;

    for (const category of allCategories) {
      const data = categoryData[category.name];
      
      if (!data) {
        console.log(`   ⚠️  ${category.name}: No data defined (skipping)`);
        continue;
      }

      const updates: string[] = [];
      const updatesNeeded: any = {};

      // Check and update each field
      if (category.co2ePerUnit !== data.co2ePerUnit) {
        updatesNeeded.co2ePerUnit = data.co2ePerUnit;
        updates.push(`CO2e: ${category.co2ePerUnit} → ${data.co2ePerUnit}`);
      }

      if (category.avgWeight !== data.avgWeight) {
        updatesNeeded.avgWeight = data.avgWeight;
        updates.push(`Weight: ${category.avgWeight} → ${data.avgWeight}`);
      }

      if (Math.abs((category.avgBuybackValue || 0) - data.avgBuybackValue) > 0.01) {
        updatesNeeded.avgBuybackValue = data.avgBuybackValue;
        updates.push(`Buyback: ${category.avgBuybackValue} → ${data.avgBuybackValue}`);
      }

      if (category.avgRRP !== data.avgRRP) {
        updatesNeeded.avgRRP = data.avgRRP;
        updates.push(`RRP: ${category.avgRRP ?? 'null'} → ${data.avgRRP}`);
      }

      if (category.residualLow !== data.residualLow) {
        updatesNeeded.residualLow = data.residualLow;
        updates.push(`Residual: ${category.residualLow ?? 'null'} → ${data.residualLow}`);
      }

      if (category.buybackFloor !== data.buybackFloor) {
        updatesNeeded.buybackFloor = data.buybackFloor;
        updates.push(`Floor: ${category.buybackFloor ?? 'null'} → ${data.buybackFloor}`);
      }

      if (category.buybackCap !== data.buybackCap) {
        updatesNeeded.buybackCap = data.buybackCap;
        updates.push(`Cap: ${category.buybackCap ?? 'null'} → ${data.buybackCap}`);
      }

      if (Object.keys(updatesNeeded).length > 0) {
        await prisma.assetCategory.update({
          where: { id: category.id },
          data: updatesNeeded,
        });
        console.log(`   ✅ ${category.name}: ${updates.join(', ')}`);
        updatedCount++;
        totalFieldsUpdated += Object.keys(updatesNeeded).length;
      } else {
        console.log(`   ✓  ${category.name}: Already up to date`);
      }
    }

    // Ensure BuybackConfig exists
    const config = await prisma.buybackConfig.findUnique({
      where: { id: 'singleton' },
    });

    if (!config) {
      await prisma.buybackConfig.create({
        data: {
          id: 'singleton',
          volumeFactor10: 1.03,
          volumeFactor50: 1.06,
          volumeFactor200: 1.10,
          ageFactor: 1.0,
          conditionFactor: 1.0,
          marketFactor: 1.0,
        },
      });
      console.log('\n   ✅ Created BuybackConfig with default values');
    } else {
      console.log('\n   ✓  BuybackConfig already exists');
    }

    console.log(`\n✅ Update complete! Updated ${totalFieldsUpdated} field(s) across ${updatedCount} category/categories.`);
  } catch (error) {
    console.error('❌ Error updating categories:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateCategories().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
