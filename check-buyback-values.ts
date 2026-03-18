// Script to check current avgBuybackValue in database
// Use this to verify if database values match expected values
import prisma from './src/config/database';

// Expected values (from update-co2-values.ts)
const expectedValues: Record<string, { co2ePerUnit: number; avgBuybackValue: number }> = {
  'Networking': { co2ePerUnit: 500, avgBuybackValue: 300 },
  'Laptop': { co2ePerUnit: 250, avgBuybackValue: 180 },
  'Server': { co2ePerUnit: 1200, avgBuybackValue: 400 },
  'Smart Phones': { co2ePerUnit: 70, avgBuybackValue: 119 },
  'Desktop': { co2ePerUnit: 350, avgBuybackValue: 81 },
  'Storage': { co2ePerUnit: 800, avgBuybackValue: 300 },
  'Tablets': { co2ePerUnit: 90, avgBuybackValue: 102 },
  'VOIP': { co2ePerUnit: 60, avgBuybackValue: 30 },
  'WEEE Waste': { co2ePerUnit: 100, avgBuybackValue: 10 },
};

async function checkBuybackValues() {
  console.log('🔍 Checking current database values...\n');

  try {
    // Get all categories
    const allCategories = await prisma.assetCategory.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        co2ePerUnit: true,
        avgBuybackValue: true,
      },
    });

    console.log('📊 Current Database Values:\n');
    console.log('─'.repeat(80));
    console.log(
      'Category'.padEnd(20) +
      'CO2e (kg)'.padEnd(15) +
      'Buyback (£)'.padEnd(20) +
      'Status'
    );
    console.log('─'.repeat(80));

    let hasIssues = false;

    for (const category of allCategories) {
      const expected = expectedValues[category.name];
      
      if (expected) {
        const co2eMatch = category.co2ePerUnit === expected.co2ePerUnit;
        const buybackMatch = category.avgBuybackValue === expected.avgBuybackValue;
        
        let status = '✅ OK';
        if (!co2eMatch || !buybackMatch) {
          status = '❌ MISMATCH';
          hasIssues = true;
        }

        console.log(
          category.name.padEnd(20) +
          category.co2ePerUnit.toString().padEnd(15) +
          category.avgBuybackValue.toString().padEnd(20) +
          status
        );

        if (!co2eMatch) {
          console.log(
            `  └─ Expected CO2e: ${expected.co2ePerUnit} kg (current: ${category.co2ePerUnit} kg)`
          );
        }
        if (!buybackMatch) {
          console.log(
            `  └─ Expected Buyback: £${expected.avgBuybackValue} (current: £${category.avgBuybackValue})`
          );
        }
      } else {
        console.log(
          category.name.padEnd(20) +
          category.co2ePerUnit.toString().padEnd(15) +
          category.avgBuybackValue.toString().padEnd(20) +
          '⚠️  No expected value defined'
        );
      }
    }

    console.log('─'.repeat(80));

    if (hasIssues) {
      console.log('\n❌ Issues found! Some values do not match expected values.');
      console.log('💡 Run update-co2-values.ts to fix: npm run update-co2-values');
      process.exit(1);
    } else {
      console.log('\n✅ All values match expected values!');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Error checking values:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

checkBuybackValues().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
